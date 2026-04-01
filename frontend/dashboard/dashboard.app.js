function renderCurrentView() {
  updateViewSwitch();
  if (state.currentView === "profile") {
    renderProfile();
  } else if (state.currentView === "battlelog") {
    renderBattlelog();
  } else if (state.currentView === "framedata") {
    renderFramedata();
  }
}

function handleChartHover(event) {
  if (!state.chartPoints.length) {
    refs.chartTooltip.style.display = "none";
    return;
  }
  const rect = refs.scoreChart.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const nearest = state.chartPoints.reduce((acc, p) => {
    const dx = p.x - mouseX;
    const dy = p.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return !acc || dist < acc.dist ? { point: p, dist } : acc;
  }, null);
  if (!nearest || nearest.dist > 12) {
    refs.chartTooltip.style.display = "none";
    return;
  }

  const p = nearest.point;
  refs.chartTooltip.style.display = "block";

  const metricLabel = state.metric === "mr" ? "MR" : "LP";
  const match = p.match || {};
  const scoreText = `${metricLabel}: ${formatInt(p.value)}`;
  const deltaText = `加减分: ${formatDelta(getMetricDelta(match))}`;
  const timeText = `时间: ${formatDate(match.playedAt || "")}`;
  const roleText = `角色: ${String(match.myCharacter || "-")} vs ${String(match.opponentCharacter || "-")}`;
  refs.chartTooltip.textContent = [scoreText, deltaText, timeText, roleText].join("\n");

  const tooltipWidth = refs.chartTooltip.offsetWidth || 220;
  const tooltipHeight = refs.chartTooltip.offsetHeight || 72;
  const left = Math.min(
    Math.max(8, refs.chartWrap.clientWidth - tooltipWidth - 8),
    Math.max(8, p.x + 12)
  );
  const top = Math.min(
    Math.max(8, refs.chartWrap.clientHeight - tooltipHeight - 8),
    Math.max(8, p.y + 6)
  );
  refs.chartTooltip.style.left = `${left}px`;
  refs.chartTooltip.style.top = `${top}px`;
}

function formatCloudUserLabel(user) {
  if (!user || typeof user !== "object") {
    return "已登录";
  }
  const email = user.email ? String(user.email) : "";
  const name = user.username ? String(user.username) : (user.name ? String(user.name) : "");
  if (name && email) {
    return `${name} (${email})`;
  }
  return name || email || "已登录";
}

function renderCloudAuthState() {
  const auth = state.cloudAuth && typeof state.cloudAuth === "object" ? state.cloudAuth : {};
  const loggedIn = Boolean(auth.loggedIn);
  const fullSyncRequired = Boolean(auth.fullSyncRequired);
  const apiBase = auth.apiBase ? `，服务：${auth.apiBase}` : "";

  if (refs.cloudAuthStatus) {
    refs.cloudAuthStatus.textContent = loggedIn
      ? (fullSyncRequired
        ? `已登录，请先执行一次全量同步后再进入增量同步${apiBase}`
        : `已登录，可同步到云端数据库${apiBase}`)
      : "未登录，仅可本地使用（不可同步到数据库）";
  }
  if (refs.cloudAuthUser) {
    refs.cloudAuthUser.classList.toggle("is-hidden", !loggedIn);
    refs.cloudAuthUser.textContent = loggedIn ? `当前账号：${formatCloudUserLabel(auth.user)}` : "";
  }
  if (refs.cloudLoginForm) {
    refs.cloudLoginForm.classList.toggle("is-hidden", loggedIn);
  }
  if (refs.cloudLogoutBtn) {
    refs.cloudLogoutBtn.classList.toggle("is-hidden", !loggedIn);
  }
  if (refs.cloudSyncBtn) {
    refs.cloudSyncBtn.disabled = !loggedIn;
    refs.cloudSyncBtn.title = loggedIn ? "" : "请先登录后再同步到云端";
  }
}

function setCloudAuthActionLoading(loading) {
  if (refs.cloudLoginBtn) {
    refs.cloudLoginBtn.disabled = loading;
  }
  if (refs.cloudRegisterBtn) {
    refs.cloudRegisterBtn.disabled = loading;
  }
  if (refs.cloudLogoutBtn) {
    refs.cloudLogoutBtn.disabled = loading;
  }
  if (refs.cloudSyncBtn) {
    const loggedIn = Boolean(state.cloudAuth && state.cloudAuth.loggedIn);
    refs.cloudSyncBtn.disabled = loading || !loggedIn;
  }
}

async function refreshCloudAuthStateFromBackground() {
  const result = await sendMessage({ type: "GET_CLOUD_AUTH_STATE" });
  if (!result || !result.ok) {
    renderCloudAuthState();
    return;
  }
  state.cloudAuth = {
    loggedIn: Boolean(result.loggedIn),
    user: result.user || null,
    apiBase: result.apiBase || "",
    fullSyncRequired: Boolean(result.fullSyncRequired)
  };
  renderCloudAuthState();
}

async function triggerCloudSync() {
  if (!state.cloudAuth || !state.cloudAuth.loggedIn) {
    refs.syncStatus.textContent = "未登录，不能同步到云端数据库";
    renderCloudAuthState();
    return;
  }

  setCloudAuthActionLoading(true);
  refs.syncStatus.textContent = "正在同步到云端数据库...";
  const result = await sendMessage({ type: "REQUEST_CLOUD_SYNC" });
  setCloudAuthActionLoading(false);

  if (!result || !result.ok) {
    refs.syncStatus.textContent = `云端同步失败：${(result && result.error) || "未知错误"}`;
    if (result && result.needLogin) {
      await refreshCloudAuthStateFromBackground();
    }
    return;
  }

  const syncedPlayers = Number(result.syncedPlayers || 0);
  refs.syncStatus.textContent = `云端同步完成：已提交 ${syncedPlayers} 个账号数据`;
  await refreshCloudAuthStateFromBackground();
}

async function handleCloudLogin(isRegister = false) {
  const email = refs.cloudEmailInput ? refs.cloudEmailInput.value.trim() : "";
  const password = refs.cloudPasswordInput ? refs.cloudPasswordInput.value : "";
  if (!email || !password) {
    refs.syncStatus.textContent = "请输入邮箱和密码";
    return;
  }

  setCloudAuthActionLoading(true);
  refs.syncStatus.textContent = isRegister ? "正在注册并登录..." : "正在登录...";
  const result = await sendMessage({
    type: isRegister ? "CLOUD_REGISTER" : "CLOUD_LOGIN",
    email,
    password
  });
  setCloudAuthActionLoading(false);

  if (!result || !result.ok) {
    refs.syncStatus.textContent = `${isRegister ? "注册" : "登录"}失败：${(result && result.error) || "未知错误"}`;
    return;
  }

  if (refs.cloudPasswordInput) {
    refs.cloudPasswordInput.value = "";
  }
  refs.syncStatus.textContent = `${isRegister ? "注册并登录" : "登录"}成功，正在拉取云端数据...`;
  const pullResult = await sendMessage({ type: "REQUEST_CLOUD_PULL" });
  if (!pullResult || !pullResult.ok) {
    refs.syncStatus.textContent = `登录成功，但云端导入失败：${(pullResult && pullResult.error) || "未知错误"}`;
    await refreshCloudAuthStateFromBackground();
    return;
  }

  const importedPlayers = Number(pullResult.importedPlayers || 0);
  const needFullSync = Boolean(pullResult.fullSyncRequired);
  refs.syncStatus.textContent = importedPlayers > 0
    ? `登录成功，已从云端导入 ${importedPlayers} 个账号数据`
    : (needFullSync
      ? "登录成功，云端暂无完整数据。请先执行一次全量同步（将自动上传云端），后续再用增量同步。"
      : "登录成功，云端暂无可导入数据");
  await loadState();
  await refreshCloudAuthStateFromBackground();
}

async function handleCloudLogout() {
  setCloudAuthActionLoading(true);
  const result = await sendMessage({ type: "CLOUD_LOGOUT" });
  setCloudAuthActionLoading(false);
  if (!result || !result.ok) {
    refs.syncStatus.textContent = `退出登录失败：${(result && result.error) || "未知错误"}`;
    return;
  }
  refs.syncStatus.textContent = "已退出登录";
  await refreshCloudAuthStateFromBackground();
}

async function autoPullCloudDataIfNeeded() {
  const loggedIn = Boolean(state.cloudAuth && state.cloudAuth.loggedIn);
  if (!loggedIn) {
    return;
  }
  const result = await sendMessage({ type: "REQUEST_CLOUD_PULL" });
  if (!result || !result.ok) {
    return;
  }
  const importedPlayers = Number(result.importedPlayers || 0);
  await loadState();
  refs.syncStatus.textContent = importedPlayers > 0
    ? `已自动从云端导入 ${importedPlayers} 个账号数据`
    : "已从云端校准本地数据";
}

async function loadState() {
  const data = await getStorage([PLAYERS_KEY, SYNC_KEY, DEBUG_KEY, BACKUP_STATE_KEY, CLOUD_AUTH_KEY]);
  state.players = data[PLAYERS_KEY] || {};
  state.syncState = data[SYNC_KEY] || {};
  state.parseDebug = data[DEBUG_KEY] || {};
  state.backupState = data[BACKUP_STATE_KEY] || {};
  state.cloudAuth = data[CLOUD_AUTH_KEY] || { loggedIn: false, user: null, apiBase: "", fullSyncRequired: false };

  const sid = pickSid(state.players, state.syncState);
  if (sid !== state.selectedSid) {
    state.selectedSid = sid;
    state.currentCharacter = "";
    state.profileCharacterTool = "";
    state.page = 1;
  }

  setSyncStatus();
  renderCloudAuthState();
  renderDebug();
  renderCurrentView();
}

async function triggerSync() {
  const forceFullHint = Boolean(state.cloudAuth && state.cloudAuth.loggedIn && state.cloudAuth.fullSyncRequired);
  refs.syncStatus.textContent = forceFullHint ? "正在请求同步（本次将自动执行全量）..." : "正在请求同步...";
  const result = await sendMessage({ type: "REQUEST_SYNC_ACTIVE_TAB" });
  if (!result.ok) {
    refs.syncStatus.textContent = `同步失败：${result.error || "未知错误"}`;
    return;
  }
  refs.syncStatus.textContent = result.forceFull
    ? "同步已启动（全量模式），完成后若已登录会自动上传云端..."
    : "同步已启动，等待数据更新...";
  await loadState();
}

async function triggerFullSync() {
  refs.syncStatus.textContent = "正在请求全量同步...";
  const result = await sendMessage({ type: "REQUEST_SYNC_SILENT_FULL" });
  if (!result || !result.ok) {
    refs.syncStatus.textContent = `全量同步失败：${(result && result.error) || "未知错误"}`;
    return;
  }
  refs.syncStatus.textContent = "全量同步已启动：先写入本地；若已登录，完成后自动上传云端数据库。";
  await loadState();
}

async function triggerSilentSync() {
  refs.syncStatus.textContent = "正在启动静默导入...";
  const result = await sendMessage({ type: "REQUEST_SYNC_SILENT" });
  if (!result.ok) {
    refs.syncStatus.textContent = `静默导入失败：${result.error || "未知错误"}`;
    return;
  }
  refs.syncStatus.textContent = result.forceFull
    ? "静默导入已启动（全量模式），完成后若已登录会自动上传云端..."
    : "静默导入已启动，正在后台同步...";
  await loadState();
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

async function importBackupFile(file) {
  if (!file) {
    refs.syncStatus.textContent = "未选择备份文件";
    return;
  }

  let text = "";
  try {
    text = await file.text();
  } catch (_error) {
    refs.syncStatus.textContent = "读取备份文件失败";
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    refs.syncStatus.textContent = "备份文件不是有效 JSON";
    return;
  }

  const normalized = normalizeImportedData(parsed);
  const playerCount = Object.keys(normalized.players).length;
  if (!playerCount) {
    refs.syncStatus.textContent = "备份文件中没有玩家数据";
    return;
  }

  await setStorage({
    [PLAYERS_KEY]: normalized.players,
    [SYNC_KEY]: {
      ...(normalized.syncState || {}),
      running: false,
      error: null,
      importedAt: new Date().toISOString()
    },
    [DEBUG_KEY]: normalized.parseDebug || {}
  });

  refs.syncStatus.textContent = `导入完成：已恢复 ${playerCount} 个账号数据`;
  await loadState();
}

async function exportToLocalJson() {
  const data = await getStorage([PLAYERS_KEY, SYNC_KEY, DEBUG_KEY]);
  const payload = {
    exportedAt: new Date().toISOString(),
    players: data[PLAYERS_KEY] || state.players || {},
    syncState: data[SYNC_KEY] || state.syncState || {},
    parseDebug: data[DEBUG_KEY] || state.parseDebug || {}
  };
  const filename = `sf6-buckler-local-${formatFileTime()}.json`;
  downloadJsonFile(payload, filename);
  refs.syncStatus.textContent = `已导出本地数据：${filename}`;
}

function bindEvents() {
  if (refs.fullSyncBtn) {
    refs.fullSyncBtn.addEventListener("click", triggerFullSync);
  }
  if (refs.silentSyncBtn) {
    refs.silentSyncBtn.addEventListener("click", triggerSilentSync);
  }
  if (refs.cloudSyncBtn) {
    refs.cloudSyncBtn.addEventListener("click", () => {
      triggerCloudSync().catch(() => {
        refs.syncStatus.textContent = "云端同步失败";
      });
    });
  }
  if (refs.cloudLoginForm) {
    refs.cloudLoginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleCloudLogin(false).catch(() => {
        refs.syncStatus.textContent = "登录失败";
      });
    });
  }
  if (refs.cloudRegisterBtn) {
    refs.cloudRegisterBtn.addEventListener("click", () => {
      handleCloudLogin(true).catch(() => {
        refs.syncStatus.textContent = "注册失败";
      });
    });
  }
  if (refs.cloudLogoutBtn) {
    refs.cloudLogoutBtn.addEventListener("click", () => {
      handleCloudLogout().catch(() => {
        refs.syncStatus.textContent = "退出登录失败";
      });
    });
  }
  if (refs.importBackupBtn && refs.importBackupInput) {
    refs.importBackupBtn.addEventListener("click", () => {
      refs.importBackupInput.value = "";
      refs.importBackupInput.click();
    });
    refs.importBackupInput.addEventListener("change", () => {
      const file = refs.importBackupInput.files && refs.importBackupInput.files[0];
      importBackupFile(file).catch(() => {
        refs.syncStatus.textContent = "导入本地备份失败";
      });
    });
  }
  refs.refreshBtn.addEventListener("click", async () => {
    const loggedIn = Boolean(state.cloudAuth && state.cloudAuth.loggedIn);
    if (!loggedIn) {
      await loadState();
      return;
    }
    refs.syncStatus.textContent = "正在从云端刷新数据...";
    const result = await sendMessage({ type: "REQUEST_CLOUD_PULL" });
    if (!result || !result.ok) {
      refs.syncStatus.textContent = `云端刷新失败：${(result && result.error) || "未知错误"}`;
      await loadState();
      return;
    }
    await loadState();
    const importedPlayers = Number(result.importedPlayers || 0);
    refs.syncStatus.textContent = importedPlayers > 0
      ? `云端刷新完成：导入 ${importedPlayers} 个账号数据`
      : "云端刷新完成：本地已与云端一致";
  });
  if (false && refs.exportBtn) {
    refs.exportBtn.addEventListener("click", () => {
      exportToLocalJson().catch(() => {
        refs.syncStatus.textContent = "导出本地数据失败";
      });
    });
  }

  refs.sideTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentView = btn.dataset.view || "battlelog";
      renderCurrentView();
    });
  });

  if (refs.framedataModeClassicBtn && refs.framedataModeModernBtn) {
    refs.framedataModeClassicBtn.addEventListener("click", () => {
      if (state.framedataMode === "classic") {
        return;
      }
      state.framedataMode = "classic";
      renderFramedata();
    });
    refs.framedataModeModernBtn.addEventListener("click", () => {
      if (state.framedataMode === "modern") {
        return;
      }
      state.framedataMode = "modern";
      renderFramedata();
    });
  }

  if (refs.metricSelect) {
    refs.metricSelect.addEventListener("change", () => {
      state.metric = refs.metricSelect.value === "lp" ? "lp" : "mr";
      renderBattlelog();
    });
  }
  if (refs.rangeSelect) {
    refs.rangeSelect.addEventListener("change", () => {
      const value = Number(refs.rangeSelect.value);
      const allowed = new Set([0, 1, 3, 7, 30]);
      state.rangeDays = allowed.has(value) ? value : 7;
      renderBattlelog();
    });
  }
  if (refs.detailRangeSelect) {
    refs.detailRangeSelect.addEventListener("change", () => {
      const value = Number(refs.detailRangeSelect.value);
      const allowed = new Set([0, 1, 3, 7, 30]);
      state.detailRangeDays = allowed.has(value) ? value : 0;
      state.page = 1;
      renderBattlelog();
    });
  }

  refs.pageSizeSelect.addEventListener("change", () => {
    state.pageSize = Number(refs.pageSizeSelect.value) || 20;
    state.page = 1;
    renderBattlelog();
  });
  refs.prevPageBtn.addEventListener("click", () => {
    state.page -= 1;
    renderBattlelog();
  });
  refs.nextPageBtn.addEventListener("click", () => {
    state.page += 1;
    renderBattlelog();
  });

  refs.profileSideBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.profileTab = btn.dataset.profileTab || "winrate";
      renderProfile();
    });
  });
  refs.profileSeasonSelect.addEventListener("change", () => {
    state.profileSeason = refs.profileSeasonSelect.value || "";
    state.profileCharacterTool = "";
    renderProfile();
  });
  refs.profileModeSelect.addEventListener("change", () => {
    state.profileMode = refs.profileModeSelect.value || "1";
    state.profileCharacterTool = "";
    renderProfile();
  });
  refs.profileCharacterSelect.addEventListener("change", () => {
    state.profileCharacterTool = refs.profileCharacterSelect.value || "";
    renderProfile();
  });
  refs.profileBattleSortSelect.addEventListener("change", () => {
    state.profileBattleSortBy = refs.profileBattleSortSelect.value || "battle";
    renderProfile();
  });
  refs.profileBattleOrderSelect.addEventListener("change", () => {
    state.profileBattleSortOrder = refs.profileBattleOrderSelect.value || "desc";
    renderProfile();
  });

  refs.scoreChart.addEventListener("mousemove", handleChartHover);
  refs.scoreChart.addEventListener("mouseleave", () => {
    refs.chartTooltip.style.display = "none";
  });

  window.addEventListener("resize", () => {
    if (state.currentView === "battlelog") {
      renderBattlelog();
    }
    if (state.currentView === "framedata") {
      renderFramedata();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (
      changes[PLAYERS_KEY]
      || changes[SYNC_KEY]
      || changes[DEBUG_KEY]
      || changes[BACKUP_STATE_KEY]
      || changes[CLOUD_AUTH_KEY]
    ) {
      loadState().catch(() => {});
    }
  });
}

function init() {
  bindEvents();
  loadState()
    .then(() => refreshCloudAuthStateFromBackground())
    .then(() => autoPullCloudDataIfNeeded())
    .catch(() => {
    refs.syncStatus.textContent = "加载本地数据失败";
    });
}

init();






