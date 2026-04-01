const DASHBOARD_URL = "dashboard/dashboard.html";
const BUCKLER_PATH = "/6/buckler/";
const PLAYERS_KEY = "players";
const SYNC_KEY = "syncState";
const DEBUG_KEY = "parseDebug";
const BACKUP_STATE_KEY = "localBackupState";
const CLOUD_AUTH_KEY = "cloudAuth";
const CLOUD_API_BASE_KEY = "cloudApiBase";
const CLOUD_BOOTSTRAP_KEY = "cloudBootstrap";
const DEFAULT_CLOUD_API_BASE = "http://localhost:3000/api";
const SILENT_SYNC_TIMEOUT_MS = 120000;
const AUTO_BACKUP_FILENAME = "sf6-buckler/sf6-buckler-latest.json";

const silentSyncTabs = new Set();
let lastBackupToken = "";

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function getStorageStrict(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(`Read storage failed: ${err.message || "unknown error"}`));
        return;
      }
      resolve(items || {});
    });
  });
}

function getCloudUserKey(auth) {
  const user = auth && auth.user && typeof auth.user === "object" ? auth.user : null;
  if (!user) {
    return "";
  }
  if (user.id != null && String(user.id).trim()) {
    return `id:${String(user.id).trim()}`;
  }
  if (user.email != null && String(user.email).trim()) {
    return `email:${String(user.email).trim().toLowerCase()}`;
  }
  return "";
}

async function getBootstrapMap() {
  const data = await getStorage([CLOUD_BOOTSTRAP_KEY]);
  const map = data && data[CLOUD_BOOTSTRAP_KEY] && typeof data[CLOUD_BOOTSTRAP_KEY] === "object"
    ? data[CLOUD_BOOTSTRAP_KEY]
    : {};
  return map;
}

async function setLocalBootstrapState(auth, fullSyncRequired, reason = "", updatedAt = "") {
  const key = getCloudUserKey(auth);
  if (!key) {
    return;
  }
  const map = await getBootstrapMap();
  map[key] = {
    fullSyncRequired: Boolean(fullSyncRequired),
    reason: String(reason || ""),
    updatedAt: updatedAt || new Date().toISOString()
  };
  await setStorage({
    [CLOUD_BOOTSTRAP_KEY]: map
  });
}

async function getFullSyncRequiredForAuth(auth) {
  const key = getCloudUserKey(auth);
  if (!key) {
    return false;
  }
  const map = await getBootstrapMap();
  const item = map[key] && typeof map[key] === "object" ? map[key] : {};
  return Boolean(item.fullSyncRequired);
}

async function setFullSyncRequiredForAuth(auth, fullSyncRequired, reason = "") {
  await setLocalBootstrapState(auth, fullSyncRequired, reason);
  if (auth && auth.loggedIn && auth.token) {
    await pushCloudBootstrapState(auth, fullSyncRequired, reason);
  }
}

async function shouldForceFullSyncForCloud() {
  const auth = await getCloudAuth();
  if (!auth.loggedIn || !auth.token) {
    return false;
  }
  return getFullSyncRequiredForAuth(auth);
}

function trimSlash(text) {
  const value = String(text || "").trim();
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function getCloudApiBase() {
  const data = await getStorage([CLOUD_API_BASE_KEY]);
  const configured = data && data[CLOUD_API_BASE_KEY] ? String(data[CLOUD_API_BASE_KEY]) : "";
  return trimSlash(configured || DEFAULT_CLOUD_API_BASE);
}

async function getCloudAuth() {
  const data = await getStorage([CLOUD_AUTH_KEY]);
  const auth = data && data[CLOUD_AUTH_KEY] && typeof data[CLOUD_AUTH_KEY] === "object"
    ? data[CLOUD_AUTH_KEY]
    : {};
  return {
    loggedIn: Boolean(auth.loggedIn && auth.token),
    token: auth.token ? String(auth.token) : "",
    user: auth.user && typeof auth.user === "object" ? auth.user : null,
    apiBase: auth.apiBase ? String(auth.apiBase) : "",
    updatedAt: auth.updatedAt || ""
  };
}

async function setCloudAuth(auth) {
  await setStorage({
    [CLOUD_AUTH_KEY]: auth
  });
}

function extractApiErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (payload.data && typeof payload.data === "object") {
    if (typeof payload.data.error === "string" && payload.data.error.trim()) {
      return payload.data.error.trim();
    }
    if (typeof payload.data.message === "string" && payload.data.message.trim()) {
      return payload.data.message.trim();
    }
  }
  return fallback;
}

async function callCloudApi(path, { method = "GET", body = null, token = "" } = {}) {
  const base = await getCloudApiBase();
  const url = `${base}${path}`;
  const headers = {
    "content-type": "application/json"
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const fallback = `云端接口错误（${response.status}）`;
    throw new Error(extractApiErrorMessage(payload, fallback));
  }

  return {
    base,
    payload: payload && typeof payload === "object" ? payload : {}
  };
}

async function fetchCloudBootstrapState(auth) {
  if (!auth || !auth.loggedIn || !auth.token) {
    return null;
  }
  try {
    const apiResult = await callCloudApi("/sync/bootstrap", {
      method: "GET",
      token: auth.token
    });
    const payload = apiResult.payload || {};
    return {
      fullSyncRequired: Boolean(payload.fullSyncRequired),
      reason: payload.reason ? String(payload.reason) : "",
      updatedAt: payload.updatedAt ? String(payload.updatedAt) : ""
    };
  } catch (_error) {
    return null;
  }
}

async function pushCloudBootstrapState(auth, fullSyncRequired, reason = "") {
  if (!auth || !auth.loggedIn || !auth.token) {
    return false;
  }
  try {
    await callCloudApi("/sync/bootstrap", {
      method: "POST",
      token: auth.token,
      body: {
        fullSyncRequired: Boolean(fullSyncRequired),
        reason: String(reason || "")
      }
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function cloudLogin(email, password, isRegister = false) {
  const account = String(email || "").trim();
  const pass = String(password || "");
  if (!account || !pass) {
    return { ok: false, error: "请输入邮箱和密码" };
  }

  try {
    const apiResult = await callCloudApi(isRegister ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: { email: account, password: pass }
    });
    const payload = apiResult.payload || {};
    const token = payload.token || payload.accessToken || (payload.data && payload.data.token) || "";
    const user = payload.user || (payload.data && payload.data.user) || { email: account };
    if (!token) {
      return { ok: false, error: "登录成功但未返回 token" };
    }

    await setCloudAuth({
      loggedIn: true,
      token: String(token),
      user,
      apiBase: apiResult.base,
      updatedAt: new Date().toISOString()
    });

    const authContext = {
      loggedIn: true,
      token: String(token),
      user
    };
    let fullSyncRequired = false;
    if (typeof user.fullSyncRequired === "boolean") {
      fullSyncRequired = user.fullSyncRequired;
      await setLocalBootstrapState(
        authContext,
        fullSyncRequired,
        user.fullSyncReason || "",
        user.fullSyncUpdatedAt || ""
      );
    } else {
      const remoteBootstrap = await fetchCloudBootstrapState(authContext);
      if (remoteBootstrap) {
        fullSyncRequired = Boolean(remoteBootstrap.fullSyncRequired);
        await setLocalBootstrapState(
          authContext,
          fullSyncRequired,
          remoteBootstrap.reason || "",
          remoteBootstrap.updatedAt || ""
        );
      } else {
        fullSyncRequired = await getFullSyncRequiredForAuth(authContext);
      }
    }

    return {
      ok: true,
      loggedIn: true,
      user,
      apiBase: apiResult.base,
      fullSyncRequired
    };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : "云端登录失败" };
  }
}

async function cloudLogout() {
  await setCloudAuth({
    loggedIn: false,
    token: "",
    user: null,
    apiBase: await getCloudApiBase(),
    updatedAt: new Date().toISOString()
  });
  return { ok: true, loggedIn: false };
}

async function getCloudAuthState() {
  const auth = await getCloudAuth();
  let fullSyncRequired = await getFullSyncRequiredForAuth(auth);
  if (auth.loggedIn && auth.token) {
    const remoteBootstrap = await fetchCloudBootstrapState(auth);
    if (remoteBootstrap) {
      fullSyncRequired = Boolean(remoteBootstrap.fullSyncRequired);
      await setLocalBootstrapState(
        auth,
        fullSyncRequired,
        remoteBootstrap.reason || "",
        remoteBootstrap.updatedAt || ""
      );
    }
  }
  return {
    ok: true,
    loggedIn: auth.loggedIn,
    user: auth.user,
    apiBase: auth.apiBase || await getCloudApiBase(),
    updatedAt: auth.updatedAt || "",
    fullSyncRequired
  };
}

async function requestCloudSync() {
  const auth = await getCloudAuth();
  if (!auth.loggedIn || !auth.token) {
    return { ok: false, needLogin: true, error: "未登录，无法同步到云端数据库" };
  }

  const data = await getStorage([PLAYERS_KEY, SYNC_KEY, DEBUG_KEY]);
  const players = data[PLAYERS_KEY] || {};
  const playerCount = Object.keys(players).length;
  if (!playerCount) {
    return { ok: false, error: "没有可同步的数据，请先本地同步" };
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    players,
    syncState: data[SYNC_KEY] || {},
    parseDebug: data[DEBUG_KEY] || {}
  };

  try {
    const apiResult = await callCloudApi("/sync/import", {
      method: "POST",
      token: auth.token,
      body: payload
    });
    const syncState = data[SYNC_KEY] || {};
    if (String(syncState.requestMode || "").toLowerCase() === "full") {
      await setFullSyncRequiredForAuth(auth, false, "full-sync-uploaded");
    }
    return {
      ok: true,
      syncedPlayers: playerCount,
      apiBase: apiResult.base
    };
  } catch (error) {
    const message = error && error.message ? error.message : "云端同步失败";
    if (/401|403|token|unauthoriz|login|expired/i.test(message)) {
      await cloudLogout();
      return { ok: false, needLogin: true, error: message };
    }
    return { ok: false, error: message };
  }
}

function normalizeImportedData(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const players = payload.players && typeof payload.players === "object"
    ? payload.players
    : {};
  const syncState = payload.syncState && typeof payload.syncState === "object"
    ? payload.syncState
    : {};
  const parseDebug = payload.parseDebug && typeof payload.parseDebug === "object"
    ? payload.parseDebug
    : {};
  return { players, syncState, parseDebug };
}

async function requestCloudPull() {
  const auth = await getCloudAuth();
  if (!auth.loggedIn || !auth.token) {
    return { ok: false, needLogin: true, error: "未登录，无法从云端导入" };
  }

  try {
    const localData = await getStorage([PLAYERS_KEY]);
    const localPlayers = localData[PLAYERS_KEY] || {};
    const localPlayerCount = Object.keys(localPlayers).length;

    const apiResult = await callCloudApi("/sync/export", {
      method: "GET",
      token: auth.token
    });
    const normalized = normalizeImportedData(apiResult.payload || {});
    const playerCount = Object.keys(normalized.players).length;
    if (!playerCount) {
      const needFullSync = localPlayerCount > 0;
      await setFullSyncRequiredForAuth(
        auth,
        needFullSync,
        needFullSync ? "cloud-empty-local-exists" : "cloud-empty-local-empty"
      );
      return { ok: true, importedPlayers: 0, apiBase: apiResult.base, fullSyncRequired: needFullSync };
    }

    await setStorage({
      [PLAYERS_KEY]: normalized.players,
      [SYNC_KEY]: {
        ...(normalized.syncState || {}),
        running: false,
        error: null,
        importedFromCloudAt: new Date().toISOString()
      },
      [DEBUG_KEY]: normalized.parseDebug || {}
    });

    await setFullSyncRequiredForAuth(auth, false, "cloud-has-data");

    return { ok: true, importedPlayers: playerCount, apiBase: apiResult.base, fullSyncRequired: false };
  } catch (error) {
    const message = error && error.message ? error.message : "云端导入失败";
    if (/401|403|token|unauthoriz|login|expired/i.test(message)) {
      await cloudLogout();
      return { ok: false, needLogin: true, error: message };
    }
    return { ok: false, error: message };
  }
}

function openDashboardTab() {
  return chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_URL) });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length ? tabs[0] : null);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickLatestPlayerContext(players, syncState) {
  const playerMap = players && typeof players === "object" ? players : {};
  const state = syncState && typeof syncState === "object" ? syncState : {};

  const sidFromState = state.sid != null ? String(state.sid).trim() : "";
  if (sidFromState) {
    const fromState = playerMap[sidFromState] && typeof playerMap[sidFromState] === "object"
      ? playerMap[sidFromState]
      : {};
    return {
      sid: sidFromState,
      locale: String(fromState.locale || state.locale || "zh-hans")
    };
  }

  let best = null;
  let bestTime = 0;

  for (const [sidKey, rawPlayer] of Object.entries(playerMap)) {
    if (!sidKey) {
      continue;
    }
    const player = rawPlayer && typeof rawPlayer === "object" ? rawPlayer : {};
    const time = Math.max(
      toTimestamp(player.lastSyncedAt),
      toTimestamp(player.updatedAt),
      toTimestamp(player.completedAt)
    );
    if (!best || time > bestTime) {
      best = {
        sid: String(player.sid || sidKey),
        locale: String(player.locale || "zh-hans")
      };
      bestTime = time;
    }
  }

  if (!best) {
    return null;
  }
  return best.sid ? best : null;
}

function waitForTabComplete(tabId, timeoutMs = SILENT_SYNC_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
      }
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo && changeInfo.status === 'complete') {
        finish({ ok: true, tab: tab || null });
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId !== tabId) {
        return;
      }
      finish({ ok: false, error: 'Silent sync tab was closed.' });
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.get(tabId, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        finish({ ok: false, error: err.message || 'Failed to read tab state.' });
        return;
      }
      if (tab && tab.status === 'complete') {
        finish({ ok: true, tab });
      }
    });

    timer = setTimeout(() => {
      finish({ ok: false, error: 'Page load timed out. Please retry.' });
    }, timeoutMs);
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ['content/content.js']
      },
      () => {
        const err = chrome.runtime.lastError;
        if (!err) {
          resolve({ ok: true });
          return;
        }

        const message = String(err.message || '');
        if (
          /Cannot access contents of the page/i.test(message)
          || /The tab was closed/i.test(message)
          || /No tab with id/i.test(message)
        ) {
          resolve({ ok: false, error: 'Inject content script failed: ' + message });
          return;
        }

        // If script is already injected or transient race, we can continue.
        resolve({ ok: true });
      }
    );
  });
}

function sendStartSyncMessage(tabId, forceFull) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      resolve({ ok: false, error: 'Sync message timeout.' });
    }, 10000);

    chrome.tabs.sendMessage(
      tabId,
      {
        type: 'START_SYNC',
        forceFull: Boolean(forceFull)
      },
      (response) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);

        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message || 'Send sync message failed.' });
          return;
        }
        resolve(response && typeof response === 'object' ? response : { ok: true, started: true });
      }
    );
  });
}

async function sendSyncMessage(tabId, { forceFull = false } = {}) {
  const maxAttempts = 3;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendStartSyncMessage(tabId, forceFull);
    if (result && result.ok) {
      return result;
    }

    const message = result && result.error ? String(result.error) : 'Send sync message failed.';
    lastError = message;

    const recoverable = /Receiving end does not exist|Could not establish connection/i.test(message);
    if (!recoverable || attempt === maxAttempts) {
      break;
    }

    const injectResult = await injectContentScript(tabId);
    if (!injectResult.ok) {
      return injectResult;
    }
    await delay(300);
  }

  return { ok: false, error: 'Send sync message failed: ' + (lastError || 'unknown error') };
}

function isBucklerProfileUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  return url.includes("streetfighter.com") && url.includes(BUCKLER_PATH) && url.includes("/profile/");
}


function parseBucklerContextFromUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  const match = url.match(/\/6\/buckler\/([^/]+)\/profile\/(\d+)/i);
  if (!match) {
    return null;
  }
  return {
    locale: String(match[1] || "zh-hans"),
    sid: String(match[2] || "")
  };
}

async function getAnyBucklerTabContext() {
  const tabs = await new Promise((resolve) => chrome.tabs.query({}, resolve));
  const list = Array.isArray(tabs) ? tabs : [];
  for (const tab of list) {
    const context = parseBucklerContextFromUrl(tab && tab.url ? tab.url : "");
    if (context && context.sid) {
      return context;
    }
  }
  return null;
}

function pickContextFromPlayers(players, syncState) {
  const context = pickLatestPlayerContext(players, syncState);
  return context && context.sid ? context : null;
}

async function pickContextFromCloudExport(auth) {
  if (!auth || !auth.loggedIn || !auth.token) {
    return null;
  }
  try {
    const result = await callCloudApi("/sync/export", {
      method: "GET",
      token: auth.token
    });
    const normalized = normalizeImportedData(result.payload || {});
    return pickContextFromPlayers(normalized.players || {}, normalized.syncState || {});
  } catch (_error) {
    return null;
  }
}

async function requestSilentSync(forceFull = false) {
  try {
    const storage = await getStorage([PLAYERS_KEY, SYNC_KEY]);
    const players = storage[PLAYERS_KEY] || {};
    const syncState = storage[SYNC_KEY] || {};

    let context = pickContextFromPlayers(players, syncState);
    if (!context || !context.sid) {
      const auth = await getCloudAuth();
      context = await pickContextFromCloudExport(auth);
    }
    if (!context || !context.sid) {
      context = await getAnyBucklerTabContext();
    }

    if (!context || !context.sid) {
      return {
        ok: false,
        error: 'No available Buckler context found. Open a Buckler profile or battlelog page once, then retry.'
      };
    }

    const sid = String(context.sid);
    const locale = String(context.locale || 'zh-hans');
    const url = `https://www.streetfighter.com/6/buckler/${locale}/profile/${sid}/battlelog?sid=${sid}`;

    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      if (!tab || !tab.id) {
        return { ok: false, error: 'Failed to create silent sync tab.' };
      }

      silentSyncTabs.add(tab.id);

      const waitResult = await waitForTabComplete(tab.id);
      if (!waitResult.ok) {
        silentSyncTabs.delete(tab.id);
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_error) {}
        return waitResult;
      }

      const injectResult = await injectContentScript(tab.id);
      if (!injectResult.ok) {
        silentSyncTabs.delete(tab.id);
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_error) {}
        return injectResult;
      }

      const cloudForceFull = await shouldForceFullSyncForCloud();
      const effectiveForceFull = Boolean(forceFull || cloudForceFull);
      const syncResult = await sendSyncMessage(tab.id, { forceFull: effectiveForceFull });
      if (!syncResult.ok) {
        silentSyncTabs.delete(tab.id);
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_error) {}
        return syncResult;
      }

      return {
        ok: true,
        started: true,
        silent: true,
        sid,
        locale,
        forceFull: effectiveForceFull
      };
    } catch (error) {
      if (tab && tab.id) {
        silentSyncTabs.delete(tab.id);
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_removeError) {}
      }
      const message = error instanceof Error ? error.message : 'Silent sync execution failed.';
      return { ok: false, error: message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Silent sync initialization failed.';
    return { ok: false, error: message };
  }
}

function closeSilentSyncTab(tabId) {
  if (!tabId || !silentSyncTabs.has(tabId)) {
    return;
  }
  silentSyncTabs.delete(tabId);
  chrome.tabs.remove(tabId, () => {});
}

function downloadJsonToLocal(payload, filename) {
  const content = JSON.stringify(payload, null, 2);
  let downloadUrl = "";
  let revokeObjectUrl = false;

  try {
    if (
      typeof URL !== "undefined"
      && typeof URL.createObjectURL === "function"
      && typeof Blob !== "undefined"
    ) {
      const blob = new Blob([content], { type: "application/json" });
      downloadUrl = URL.createObjectURL(blob);
      revokeObjectUrl = true;
    }
  } catch (_error) {
    downloadUrl = "";
    revokeObjectUrl = false;
  }

  if (!downloadUrl) {
    downloadUrl = `data:application/json;charset=utf-8,${encodeURIComponent(content)}`;
  }

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename,
        conflictAction: "overwrite",
        saveAs: false
      },
      (downloadId) => {
        if (revokeObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(downloadUrl);
        }
        if (chrome.runtime.lastError || !downloadId) {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "download failed"));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

async function updateBackupState(patch) {
  const current = await getStorage([BACKUP_STATE_KEY]);
  const base = current[BACKUP_STATE_KEY] || {};
  await setStorage({
    [BACKUP_STATE_KEY]: {
      ...base,
      ...patch,
      updatedAt: new Date().toISOString()
    }
  });
}

function buildBackupToken(syncState, players) {
  const playerCount = players ? Object.keys(players).length : 0;
  const playerVersion = Object.keys(players || {})
    .sort()
    .map((sid) => {
      const player = players[sid] && typeof players[sid] === "object" ? players[sid] : {};
      const playStats = player.playStats && typeof player.playStats === "object" ? player.playStats : {};
      return [
        sid,
        player.requestMode || "",
        playStats.requestMode || "",
        playStats.fetchedAt || "",
        player.lastSyncedAt || ""
      ].join(":");
    })
    .join(",");
  return [
    syncState && syncState.completedAt ? syncState.completedAt : "",
    syncState && syncState.sid ? syncState.sid : "",
    syncState && syncState.requestMode ? syncState.requestMode : "",
    syncState && syncState.newAdded ? syncState.newAdded : 0,
    playerCount,
    playerVersion
  ].join("|");
}

function summarizePlayStats(playStats) {
  const seasons = playStats
    && playStats.seasons
    && typeof playStats.seasons === "object"
    ? playStats.seasons
    : {};
  const seasonKeys = Object.keys(seasons);

  let winRateModes = 0;
  let winRateRows = 0;
  let rivalModes = 0;
  let rivalCharacters = 0;
  let rivalRows = 0;
  let rivalBattleTotal = 0;

  seasonKeys.forEach((seasonKey) => {
    const season = seasons[seasonKey] && typeof seasons[seasonKey] === "object" ? seasons[seasonKey] : {};
    const winRatesByMode = season.winRatesByMode && typeof season.winRatesByMode === "object"
      ? season.winRatesByMode
      : {};
    const rivalByMode = season.rivalWinRatesByMode && typeof season.rivalWinRatesByMode === "object"
      ? season.rivalWinRatesByMode
      : {};

    Object.values(winRatesByMode).forEach((rows) => {
      if (!Array.isArray(rows)) {
        return;
      }
      winRateModes += 1;
      winRateRows += rows.length;
    });

    Object.values(rivalByMode).forEach((myRows) => {
      if (!Array.isArray(myRows)) {
        return;
      }
      rivalModes += 1;
      rivalCharacters += myRows.length;
      myRows.forEach((myRow) => {
        const rivals = Array.isArray(myRow && myRow.rival_character_win_rates)
          ? myRow.rival_character_win_rates
          : [];
        rivalRows += rivals.length;
        rivals.forEach((rival) => {
          rivalBattleTotal += Number(rival && rival.battle_count) || 0;
        });
      });
    });
  });

  return {
    fetchedAt: playStats && playStats.fetchedAt ? String(playStats.fetchedAt) : "",
    requestMode: playStats && playStats.requestMode ? String(playStats.requestMode) : "",
    currentSeasonId: playStats && playStats.currentSeasonId != null ? Number(playStats.currentSeasonId) : null,
    seasonCount: seasonKeys.length,
    winRateModes,
    winRateRows,
    rivalModes,
    rivalCharacters,
    rivalRows,
    rivalBattleTotal
  };
}

function buildBackupPayload(trigger, data) {
  const players = data && data[PLAYERS_KEY] && typeof data[PLAYERS_KEY] === "object"
    ? data[PLAYERS_KEY]
    : {};
  const syncState = data && data[SYNC_KEY] && typeof data[SYNC_KEY] === "object"
    ? data[SYNC_KEY]
    : {};
  const parseDebug = data && data[DEBUG_KEY] && typeof data[DEBUG_KEY] === "object"
    ? data[DEBUG_KEY]
    : {};

  const playerSummaries = {};
  Object.keys(players).forEach((sid) => {
    const player = players[sid] && typeof players[sid] === "object" ? players[sid] : {};
    playerSummaries[sid] = {
      requestMode: player.requestMode ? String(player.requestMode) : "",
      totalMatches: Number(player.totalMatches || 0),
      knownReplayIds: Array.isArray(player.knownReplayIds) ? player.knownReplayIds.length : 0,
      playStats: summarizePlayStats(player.playStats && typeof player.playStats === "object" ? player.playStats : {})
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    trigger,
    players,
    syncState,
    parseDebug,
    integrity: {
      playerCount: Object.keys(players).length,
      players: playerSummaries
    }
  };
}

async function backupSyncedData(trigger = "sync-finished") {
  const data = await getStorageStrict([PLAYERS_KEY, SYNC_KEY, DEBUG_KEY]);
  const payload = buildBackupPayload(trigger, data);
  const players = payload.players || {};
  const syncState = payload.syncState || {};

  if (!Object.keys(players).length) {
    throw new Error("no players data to backup");
  }

  const token = buildBackupToken(syncState, players);
  if (token && token === lastBackupToken) {
    return {
      skipped: true,
      reason: "duplicate",
      filename: AUTO_BACKUP_FILENAME
    };
  }

  const downloadId = await downloadJsonToLocal(payload, AUTO_BACKUP_FILENAME);
  lastBackupToken = token || `${Date.now()}`;

  await updateBackupState({
    ok: true,
    trigger,
    downloadId,
    filename: AUTO_BACKUP_FILENAME,
    lastBackupAt: new Date().toISOString(),
    playerCount: payload.integrity.playerCount,
    error: null
  });

  return {
    ok: true,
    downloadId,
    filename: AUTO_BACKUP_FILENAME
  };
}

async function requestSyncOnActiveTab(forceFull = false) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return { ok: false, error: 'No active tab found.' };
  }
  if (!isBucklerProfileUrl(tab.url || '')) {
    return {
      ok: false,
      error: 'Open a Buckler profile or battlelog page first, then sync.'
    };
  }
  const injectResult = await injectContentScript(tab.id);
  if (!injectResult.ok) {
    return injectResult;
  }
  const cloudForceFull = await shouldForceFullSyncForCloud();
  const effectiveForceFull = Boolean(forceFull || cloudForceFull);
  const result = await sendSyncMessage(tab.id, { forceFull: effectiveForceFull });
  return {
    ...result,
    forceFull: effectiveForceFull
  };
}


async function maybeAutoCloudSyncAfterFullSync(message) {
  const requestMode = message && message.requestMode ? String(message.requestMode).toLowerCase() : "";
  if (requestMode !== "full") {
    return { ok: true, skipped: true, reason: "not-full-sync" };
  }

  const auth = await getCloudAuth();
  if (!auth.loggedIn || !auth.token) {
    return { ok: true, skipped: true, reason: "not-logged-in" };
  }

  const result = await requestCloudSync();
  if (!result || !result.ok) {
    return {
      ok: false,
      skipped: false,
      error: (result && result.error) || "cloud sync failed"
    };
  }

  await setFullSyncRequiredForAuth(auth, false, "full-sync-uploaded");

  return {
    ok: true,
    skipped: false,
    syncedPlayers: Number(result.syncedPlayers || 0),
    apiBase: result.apiBase || ""
  };
}

async function markFullSyncSatisfiedIfNeeded(message) {
  const requestMode = message && message.requestMode ? String(message.requestMode).toLowerCase() : "";
  if (requestMode !== "full") {
    return { ok: true, skipped: true, reason: "not-full-sync" };
  }

  const auth = await getCloudAuth();
  if (!auth.loggedIn || !auth.token) {
    return { ok: true, skipped: true, reason: "not-logged-in" };
  }

  await setFullSyncRequiredForAuth(auth, false, "full-sync-completed-local");
  return { ok: true, skipped: false, reason: "full-sync-completed-local" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "OPEN_DASHBOARD") {
    openDashboardTab()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: (error && error.message) || "Open dashboard failed." }));
    return true;
  }

  if (message.type === "REQUEST_SYNC_ACTIVE_TAB") {
    requestSyncOnActiveTab()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: (error && error.message) || "Sync request failed." }));
    return true;
  }

  if (message.type === "REQUEST_SYNC_ACTIVE_TAB_FULL") {
    requestSyncOnActiveTab(true)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: (error && error.message) || "Full sync request failed." }));
    return true;
  }

  if (message.type === "REQUEST_SYNC_SILENT") {
    requestSilentSync(false)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: (error && error.message) || "Silent sync request failed." }));
    return true;
  }

  if (message.type === "REQUEST_SYNC_SILENT_FULL") {
    requestSilentSync(true)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: (error && error.message) || "Silent full sync request failed." }));
    return true;
  }

  if (message.type === "SILENT_SYNC_FINISHED") {
    const tabId = _sender && _sender.tab && _sender.tab.id ? _sender.tab.id : null;
    closeSilentSyncTab(tabId);

    if (message && message.ok) {
      backupSyncedData("sync-finished")
        .then(async (backupResult) => {
          const bootstrapResult = await markFullSyncSatisfiedIfNeeded(message);
          const cloudResult = await maybeAutoCloudSyncAfterFullSync(message);
          sendResponse({ ok: true, backup: backupResult, bootstrap: bootstrapResult, cloud: cloudResult });
        })
        .catch(async (error) => {
          const msg = error instanceof Error ? error.message : "backup failed";
          await updateBackupState({
            ok: false,
            trigger: "sync-finished",
            error: msg,
            lastBackupAt: new Date().toISOString()
          });
          sendResponse({ ok: true, backup: { ok: false, error: msg } });
        });
      return true;
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "GET_ACTIVE_TAB_HINT") {
    getActiveTab()
      .then((tab) => {
        const url = tab && tab.url ? tab.url : "";
        sendResponse({
          ok: true,
          isTargetPage: isBucklerProfileUrl(url),
          url
        });
      })
      .catch(() => sendResponse({ ok: false, isTargetPage: false, url: "" }));
    return true;
  }

  if (message.type === "CLOUD_LOGIN") {
    cloudLogin(message.email, message.password, false)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "云端登录失败" }));
    return true;
  }

  if (message.type === "CLOUD_REGISTER") {
    cloudLogin(message.email, message.password, true)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "云端注册失败" }));
    return true;
  }

  if (message.type === "CLOUD_LOGOUT") {
    cloudLogout()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "退出登录失败" }));
    return true;
  }

  if (message.type === "GET_CLOUD_AUTH_STATE") {
    getCloudAuthState()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, loggedIn: false, user: null }));
    return true;
  }

  if (message.type === "REQUEST_CLOUD_SYNC") {
    requestCloudSync()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "云端同步失败" }));
    return true;
  }

  if (message.type === "REQUEST_CLOUD_PULL") {
    requestCloudPull()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "云端导入失败" }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (silentSyncTabs.has(tabId)) {
    silentSyncTabs.delete(tabId);
  }
});
