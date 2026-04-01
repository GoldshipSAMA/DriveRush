(() => {
  const INIT_FLAG = "__SF6_BUCKLER_SYNC_CONTENT_INIT__";
  if (globalThis[INIT_FLAG]) {
    return;
  }
  globalThis[INIT_FLAG] = true;

  const SYNC_KEY = "syncState";
  const PLAYERS_KEY = "players";
  const DEBUG_KEY = "parseDebug";

  const RESYNC_MAX_PAGES = 40;
  const BASE_DELAY_MS = 800;
  const JITTER_MS = 1200;

  const FETCH_RETRY_MAX = 3;
  const FETCH_BACKOFF_BASE_MS = 2000;

  const MATCH_DETAIL_CAP = 5000;
  const KNOWN_ID_CAP = 20000;

  const PROFILE_MODE_IDS = [1, 2, 3, 4, 5];
  const PROFILE_MAX_SEASONS = 20;
  const PROFILE_DELAY_BASE_MS = 180;
  const PROFILE_DELAY_JITTER_MS = 260;
  const RIVAL_FETCH_ATTEMPTS_FULL = 3;

  let running = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay() {
    return BASE_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
  }

  function randomProfileDelay() {
    return PROFILE_DELAY_BASE_MS + Math.floor(Math.random() * PROFILE_DELAY_JITTER_MS);
  }

  function backoffDelay(attempt) {
    const exp = Math.min(5, attempt);
    const jitter = Math.floor(Math.random() * 800);
    return FETCH_BACKOFF_BASE_MS * (2 ** exp) + jitter;
  }

  function getSidFromUrl() {
    const match = window.location.pathname.match(/\/profile\/(\d+)/i);
    return match ? match[1] : null;
  }

  function notifySilentSyncFinished(payload = {}) {
    try {
      chrome.runtime.sendMessage(
        {
          type: "SILENT_SYNC_FINISHED",
          ...payload
        },
        () => {}
      );
    } catch (_error) {}
  }

  function getLocaleFromUrl() {
    const match = window.location.pathname.match(/\/6\/buckler\/([^/]+)\//i);
    return match ? match[1] : "zh-hans";
  }

  function getBuildIdFromNextData() {
    const el = document.querySelector("#__NEXT_DATA__");
    if (!el || !el.textContent) {
      return null;
    }
    try {
      const parsed = JSON.parse(el.textContent);
      return parsed && parsed.buildId ? parsed.buildId : null;
    } catch (_error) {
      return null;
    }
  }

  function toNum(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function pickNumber(...values) {
    for (const value of values) {
      const num = toNum(value);
      if (num !== null) {
        return num;
      }
    }
    return null;
  }

  function toIsoFromUnix(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return "";
    }
    const ms = num < 2000000000 ? num * 1000 : num;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function countRoundWins(roundResults) {
    if (!Array.isArray(roundResults)) {
      return 0;
    }
    return roundResults.reduce((acc, value) => acc + (Number(value) > 0 ? 1 : 0), 0);
  }

  function normalizeResultFromRounds(myInfo, opponentInfo) {
    const myWins = countRoundWins(myInfo && myInfo.round_results);
    const opponentWins = countRoundWins(opponentInfo && opponentInfo.round_results);

    if (myWins > opponentWins) {
      return "win";
    }
    if (myWins < opponentWins) {
      return "loss";
    }
    if (myWins === opponentWins && myWins > 0) {
      return "draw";
    }
    return "unknown";
  }

  function safeKeys(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return [];
    }
    return Object.keys(obj);
  }

  function extractPlayFromNextHtml(html) {
    if (!html || typeof html !== "string") {
      return null;
    }
    const match = html.match(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (!match || !match[1]) {
      return null;
    }
    try {
      const nextData = JSON.parse(match[1]);
      const pageProps = nextData
        && nextData.props
        && nextData.props.pageProps
        && typeof nextData.props.pageProps === "object"
        ? nextData.props.pageProps
        : null;
      if (!pageProps || !pageProps.play || typeof pageProps.play !== "object") {
        return null;
      }
      return pageProps.play;
    } catch (_error) {
      return null;
    }
  }

  function hasMeaningfulBattleStats(stats) {
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
      return false;
    }
    const values = Object.values(stats);
    if (!values.length) {
      return false;
    }
    return values.some((value) => {
      const num = toNum(value);
      return num !== null && Math.abs(num) > 0;
    });
  }

  function extractReplayRows(payload) {
    const pageProps = payload && payload.pageProps ? payload.pageProps : {};
    const replayList = Array.isArray(pageProps.replay_list) ? pageProps.replay_list : [];

    return {
      rows: replayList,
      path: "pageProps.replay_list",
      totalPage: Number(pageProps.total_page || 0),
      debug: {
        rootKeys: safeKeys(payload),
        pagePropsKeys: safeKeys(pageProps),
        rowSampleKeys: replayList.length ? safeKeys(replayList[0]) : [],
        topCandidates: ["pageProps.replay_list"]
      }
    };
  }

  function resolveSides(row, sid) {
    const p1 = row.player1_info || {};
    const p2 = row.player2_info || {};
    const sidNum = toNum(sid);
    const p1Sid = toNum(p1 && p1.player && p1.player.short_id);
    const p2Sid = toNum(p2 && p2.player && p2.player.short_id);

    if (sidNum !== null && p1Sid === sidNum) {
      return { me: p1, opponent: p2 };
    }
    if (sidNum !== null && p2Sid === sidNum) {
      return { me: p2, opponent: p1 };
    }
    return { me: p1, opponent: p2 };
  }

  function normalizeReplayRow(row, sid, index, page) {
    const replayId = row.replay_id || `${page}-${index}-${Date.now()}`;
    const sides = resolveSides(row, sid);
    const me = sides.me || {};
    const opponent = sides.opponent || {};

    const myLeaguePoint = pickNumber(me.league_point, me.leaguePoint);
    const myMasterRating = pickNumber(me.master_rating, me.masterRating);
    const leaguePointDelta = pickNumber(
      row.league_point_diff,
      row.leaguePointDiff,
      row.lp_diff,
      me.league_point_diff,
      me.leaguePointDiff
    );
    const masterRatingDelta = pickNumber(
      row.master_rating_diff,
      row.masterRatingDiff,
      row.mr_diff,
      me.master_rating_diff,
      me.masterRatingDiff
    );

    return {
      id: String(replayId),
      result: normalizeResultFromRounds(me, opponent),
      rawResult: JSON.stringify({
        myRoundResults: Array.isArray(me.round_results) ? me.round_results : [],
        opponentRoundResults: Array.isArray(opponent.round_results) ? opponent.round_results : []
      }),
      mode: String(row.replay_battle_type_name || row.replay_battle_type || "unknown"),
      playedAt: toIsoFromUnix(row.uploaded_at || row.created_at || row.played_at),
      myCharacter: String(me.playing_character_name || me.character_name || ""),
      opponentCharacter: String(opponent.playing_character_name || opponent.character_name || ""),
      opponentName: String((opponent.player && opponent.player.fighter_id) || opponent.fighter_id || ""),
      myLeaguePoint,
      myMasterRating,
      leaguePointDelta,
      masterRatingDelta
    };
  }

  function inferScoreDeltas(matches) {
    for (let i = 0; i < matches.length; i += 1) {
      const current = matches[i];
      const older = i + 1 < matches.length ? matches[i + 1] : null;
      if (!older) {
        continue;
      }

      if (
        current.leaguePointDelta === null
        && current.myLeaguePoint !== null
        && older.myLeaguePoint !== null
      ) {
        current.leaguePointDelta = current.myLeaguePoint - older.myLeaguePoint;
      }

      if (
        current.masterRatingDelta === null
        && current.myMasterRating !== null
        && older.myMasterRating !== null
      ) {
        current.masterRatingDelta = current.myMasterRating - older.myMasterRating;
      }
    }
  }

  function summarizeMatches(matches) {
    let wins = 0;
    let losses = 0;
    let draws = 0;

    for (const match of matches) {
      if (match.result === "win") {
        wins += 1;
      } else if (match.result === "loss") {
        losses += 1;
      } else if (match.result === "draw") {
        draws += 1;
      }
    }

    const total = matches.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";
    return { wins, losses, draws, total, winRate };
  }

  function mergeMatches(newMatches, oldMatches, cap) {
    const merged = [];
    const seen = new Set();
    const ordered = [...newMatches, ...oldMatches];
    const normalizedCap = cap == null ? null : Number(cap);
    const limit = Number.isFinite(normalizedCap) && normalizedCap > 0
      ? normalizedCap
      : Number.POSITIVE_INFINITY;

    for (const match of ordered) {
      const id = match && match.id ? String(match.id) : "";
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      merged.push(match);
      if (merged.length >= limit) {
        break;
      }
    }
    return merged;
  }

  function buildKnownIds(newMatches, existingKnownIds, existingMatches, cap) {
    const result = [];
    const seen = new Set();
    const normalizedCap = cap == null ? null : Number(cap);
    const limit = Number.isFinite(normalizedCap) && normalizedCap > 0
      ? normalizedCap
      : Number.POSITIVE_INFINITY;

    const pushId = (id) => {
      if (!id) {
        return;
      }
      const key = String(id);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(key);
    };

    for (const match of newMatches) {
      pushId(match && match.id);
      if (result.length >= limit) {
        return result;
      }
    }

    for (const id of existingKnownIds || []) {
      pushId(id);
      if (result.length >= limit) {
        return result;
      }
    }

    for (const match of existingMatches || []) {
      pushId(match && match.id);
      if (result.length >= limit) {
        return result;
      }
    }

    return result;
  }

  function sortByCharacter(rows) {
    return [...rows].sort((a, b) => {
      const sa = toNum(a.character_sort);
      const sb = toNum(b.character_sort);
      if (sa !== null && sb !== null && sa !== sb) {
        return sa - sb;
      }
      return String(a.character_name || "").localeCompare(String(b.character_name || ""), "zh-Hans-CN");
    });
  }

  function normalizeCharacterWinRates(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return sortByCharacter(rows.map((row) => ({
      character_id: toNum(row.character_id),
      character_name: String(row.character_name || row.character_alpha || ""),
      character_alpha: String(row.character_alpha || row.character_name || ""),
      character_tool_name: String(row.character_tool_name || ""),
      character_sort: toNum(row.character_sort),
      battle_count: toNum(row.battle_count) || 0,
      win_count: toNum(row.win_count) || 0
    })));
  }

  function normalizeCharacterLeagueInfos(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return sortByCharacter(rows.map((row) => {
      const leagueInfo = row.league_info || {};
      return {
        character_id: toNum(row.character_id),
        is_played: Boolean(row.is_played),
        character_name: String(row.character_name || row.character_alpha || ""),
        character_alpha: String(row.character_alpha || row.character_name || ""),
        character_tool_name: String(row.character_tool_name || ""),
        character_sort: toNum(row.character_sort),
        league_info: {
          league_point: toNum(leagueInfo.league_point),
          league_rank: toNum(leagueInfo.league_rank),
          master_league: toNum(leagueInfo.master_league),
          master_rating: toNum(leagueInfo.master_rating),
          master_rating_ranking: toNum(leagueInfo.master_rating_ranking)
        }
      };
    }));
  }

  function sortByRivalCharacter(rows) {
    return [...rows].sort((a, b) => {
      const sa = toNum(a.rival_character_sort);
      const sb = toNum(b.rival_character_sort);
      if (sa !== null && sb !== null && sa !== sb) {
        return sa - sb;
      }
      return String(a.rival_character_name || "").localeCompare(
        String(b.rival_character_name || ""),
        "zh-Hans-CN"
      );
    });
  }

  function normalizeRivalCharacterWinRates(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return sortByRivalCharacter(rows.map((row) => ({
      battle_count: toNum(row.battle_count) || 0,
      rival_character_id: toNum(row.rival_character_id),
      win_count: toNum(row.win_count) || 0,
      rival_character_name: String(row.rival_character_name || row.rival_character_alpha || ""),
      rival_character_alpha: String(row.rival_character_alpha || row.rival_character_name || ""),
      rival_character_tool_name: String(row.rival_character_tool_name || ""),
      rival_character_sort: toNum(row.rival_character_sort)
    })));
  }

  function normalizeCharacterRivalWinRates(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    const pickRivalRows = (row) => {
      if (!row || typeof row !== "object") {
        return [];
      }
      const candidates = [
        row.rival_character_win_rates,
        row.rivalCharacterWinRates,
        row.rival_character_rates,
        row.rival_win_rates
      ];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          return candidate;
        }
      }
      return [];
    };
    return sortByCharacter(rows.map((row) => ({
      character_id: toNum(row.character_id),
      character_name: String(row.character_name || row.character_alpha || ""),
      character_alpha: String(row.character_alpha || row.character_name || ""),
      character_tool_name: String(row.character_tool_name || ""),
      character_sort: toNum(row.character_sort),
      rival_character_win_rates: normalizeRivalCharacterWinRates(pickRivalRows(row))
    })));
  }

  function extractRivalRowsFromResponse(response) {
    const queue = [response];
    const visited = new Set();
    let scanned = 0;

    while (queue.length && scanned < 80) {
      const node = queue.shift();
      scanned += 1;
      if (Array.isArray(node)) {
        return node;
      }
      if (!node || typeof node !== "object") {
        continue;
      }
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);

      const directCandidates = [
        node.character_win_rates_by_rival_character,
        node.characterWinRatesByRivalCharacter,
        node.character_win_rates_by_rival_characters,
        node.character_win_rates_by_character,
        node.characterWinRatesByCharacter,
        node.character_win_rates,
        node.characterWinRates
      ];
      for (const candidate of directCandidates) {
        if (Array.isArray(candidate)) {
          return candidate;
        }
      }

      const nestedCandidates = [
        node.response,
        node.data,
        node.payload,
        node.result,
        node.body,
        node.play
      ];
      for (const nested of nestedCandidates) {
        if (nested && typeof nested === "object") {
          queue.push(nested);
        }
      }
    }
    return [];
  }

  function summarizeRivalResponseShape(response) {
    if (!response || typeof response !== "object") {
      return "shape=non-object";
    }
    const topKeys = safeKeys(response).slice(0, 8).join("|") || "-";
    const topCandidates = [
      "character_win_rates_by_rival_character",
      "characterWinRatesByRivalCharacter",
      "character_win_rates_by_rival_characters",
      "character_win_rates_by_character",
      "characterWinRatesByCharacter",
      "character_win_rates",
      "characterWinRates"
    ];
    const lengths = topCandidates
      .map((key) => {
        const value = response[key];
        return `${key}:${Array.isArray(value) ? value.length : "-"}`;
      })
      .join(",");
    const nested = response.response && typeof response.response === "object"
      ? ` responseKeys=${safeKeys(response.response).slice(0, 6).join("|") || "-"}`
      : "";
    return `topKeys=${topKeys}; topLens=${lengths}${nested}`;
  }

  function enrichRivalRowsWithCharacterMeta(rivalRows, winRateRows) {
    const rows = Array.isArray(rivalRows) ? rivalRows : [];
    const wins = Array.isArray(winRateRows) ? winRateRows : [];
    if (!rows.length) {
      return [];
    }

    const byId = new Map();
    const byTool = new Map();
    wins.forEach((row) => {
      const id = toNum(row && row.character_id);
      if (id !== null && !byId.has(id)) {
        byId.set(id, row);
      }
      const tool = String((row && row.character_tool_name) || "");
      if (tool && !byTool.has(tool)) {
        byTool.set(tool, row);
      }
    });

    return rows.map((row) => {
      const characterId = toNum(row && row.character_id);
      const tool = String((row && row.character_tool_name) || "");
      const meta = (characterId !== null && byId.has(characterId))
        ? byId.get(characterId)
        : (tool && byTool.has(tool) ? byTool.get(tool) : null);

      const mergedCharacterId = characterId !== null
        ? characterId
        : toNum(meta && meta.character_id);
      const mergedTool = tool
        || String((meta && meta.character_tool_name) || "")
        || (mergedCharacterId !== null ? `cid_${mergedCharacterId}` : "");
      const mergedName = String((row && row.character_name) || "")
        || String((meta && meta.character_name) || "")
        || String((row && row.character_alpha) || "")
        || String((meta && meta.character_alpha) || "")
        || (mergedCharacterId !== null ? `角色${mergedCharacterId}` : "");
      const mergedAlpha = String((row && row.character_alpha) || "")
        || String((meta && meta.character_alpha) || "")
        || mergedName;
      const mergedSort = toNum(row && row.character_sort) !== null
        ? toNum(row && row.character_sort)
        : toNum(meta && meta.character_sort);

      return {
        ...row,
        character_id: mergedCharacterId,
        character_tool_name: mergedTool,
        character_name: mergedName,
        character_alpha: mergedAlpha,
        character_sort: mergedSort
      };
    });
  }

  function totalRivalBattles(rows) {
    if (!Array.isArray(rows)) {
      return 0;
    }
    let total = 0;
    rows.forEach((row) => {
      const rivals = Array.isArray(row && row.rival_character_win_rates)
        ? row.rival_character_win_rates
        : [];
      rivals.forEach((rival) => {
        total += toNum(rival && rival.battle_count) || 0;
      });
    });
    return total;
  }

  function normalizeFlatStatsObject(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }
    const output = {};
    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (value === null || value === undefined) {
        return;
      }
      if (typeof value === "number") {
        if (Number.isFinite(value)) {
          output[key] = value;
        }
        return;
      }
      if (typeof value === "boolean") {
        output[key] = value;
        return;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          output[key] = "";
          return;
        }
        const num = toNum(trimmed);
        output[key] = num !== null ? num : trimmed;
      }
    });
    return output;
  }

  function normalizeBattleStats(stats) {
    return normalizeFlatStatsObject(stats);
  }

  function normalizeBaseInfo(baseInfo) {
    return normalizeFlatStatsObject(baseInfo);
  }

  async function fetchWithRetry(url, requestInit = {}) {
    let lastResponse = null;
    let lastError = null;

    const headers = {
      accept: "application/json",
      ...(requestInit.headers || {})
    };
    const init = {
      method: requestInit.method || "GET",
      credentials: "include",
      ...requestInit,
      headers
    };

    for (let attempt = 0; attempt <= FETCH_RETRY_MAX; attempt += 1) {
      try {
        const response = await fetch(url, init);
        lastResponse = response;

        if (
          (response.status === 429 || response.status === 403 || response.status >= 500)
          && attempt < FETCH_RETRY_MAX
        ) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < FETCH_RETRY_MAX) {
          await sleep(backoffDelay(attempt));
          continue;
        }
      }
    }

    if (lastResponse) {
      return lastResponse;
    }
    throw lastError || new Error("Request failed.");
  }

  async function fetchJsonOrThrow(url, requestInit = {}, errorPrefix = "Request failed") {
    const response = await fetchWithRetry(url, requestInit);
    if (response.status === 429) {
      throw new Error(`${errorPrefix}: rate limited (429).`);
    }
    if (response.status === 403) {
      throw new Error(`${errorPrefix}: forbidden (403).`);
    }
    if (!response.ok) {
      throw new Error(`${errorPrefix}: ${response.status}.`);
    }
    return response.json();
  }

  async function fetchTextOrThrow(url, requestInit = {}, errorPrefix = "Request failed") {
    const response = await fetchWithRetry(url, requestInit);
    if (response.status === 429) {
      throw new Error(`${errorPrefix}: rate limited (429).`);
    }
    if (response.status === 403) {
      throw new Error(`${errorPrefix}: forbidden (403).`);
    }
    if (!response.ok) {
      throw new Error(`${errorPrefix}: ${response.status}.`);
    }
    return response.text();
  }

  async function fetchPlayActResponse(path, payload) {
    const url = `${window.location.origin}/6/buckler/api/profile/play/act/${path}`;
    const data = await fetchJsonOrThrow(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      },
      `Play API ${path} failed`
    );
    if (data && typeof data === "object" && data.response && typeof data.response === "object") {
      return data.response;
    }
    return data || {};
  }

  async function syncPlayProfileData({
    sid,
    locale,
    buildId,
    minimalRequests = false,
    previousPlayStats = null
  }) {
    const playUrl =
      `${window.location.origin}/6/buckler/_next/data/${buildId}/` +
      `${locale}/profile/${sid}/play.json?sid=${sid}`;

    const playJson = await fetchJsonOrThrow(playUrl, {}, "Play page request failed");
    const pageProps = playJson && playJson.pageProps ? playJson.pageProps : {};
    let play = pageProps.play || null;
    if (!play || typeof play !== "object") {
      throw new Error("Play data missing in pageProps.play.");
    }

    const jsonBattleStats = play && play.battle_stats && typeof play.battle_stats === "object"
      ? play.battle_stats
      : null;
    let playFromHtml = null;
    let htmlBattleStats = null;
    if (!hasMeaningfulBattleStats(jsonBattleStats)) {
      try {
        const playPageUrl = `${window.location.origin}/6/buckler/${locale}/profile/${sid}/play`;
        const playHtml = await fetchTextOrThrow(playPageUrl, {}, "Play html request failed");
        playFromHtml = extractPlayFromNextHtml(playHtml);
        htmlBattleStats = playFromHtml && playFromHtml.battle_stats && typeof playFromHtml.battle_stats === "object"
          ? playFromHtml.battle_stats
          : null;
      } catch (_error) {
        playFromHtml = null;
        htmlBattleStats = null;
      }
      if (hasMeaningfulBattleStats(htmlBattleStats)) {
        play = {
          ...play,
          ...playFromHtml,
          battle_stats: htmlBattleStats
        };
      }
    }

    const currentSeasonId = toNum(play.current_season_id);
    const seasonIdsRaw = Array.isArray(play.season_ids) ? play.season_ids : [];
    const seasonIds = [];
    for (const value of seasonIdsRaw) {
      const num = toNum(value);
      if (num !== null && !seasonIds.includes(num)) {
        seasonIds.push(num);
      }
    }
    if (currentSeasonId !== null && !seasonIds.includes(currentSeasonId)) {
      seasonIds.unshift(currentSeasonId);
    }
    const warnings = [];
    let targetSeasonIds = minimalRequests
      ? seasonIds.slice(0, PROFILE_MAX_SEASONS)
      : seasonIds;
    if (!minimalRequests && currentSeasonId !== null && currentSeasonId >= 0) {
      const fullSeasonSweep = [];
      for (let season = currentSeasonId; season >= 0; season -= 1) {
        fullSeasonSweep.push(season);
      }
      for (const season of seasonIds) {
        if (!fullSeasonSweep.includes(season)) {
          fullSeasonSweep.push(season);
        }
      }
      targetSeasonIds = fullSeasonSweep;
      warnings.push(`full sync season sweep enabled: S${currentSeasonId} -> S0`);
    }

    const seasons = {};
    const sidNum = Number(sid);
    const initialLeague = normalizeCharacterLeagueInfos(play.character_league_infos);
    const initialWinRate = normalizeCharacterWinRates(play.character_win_rates);
    const initialRivalWinRate = normalizeCharacterRivalWinRates(
      play.character_win_rates_by_rival_character
    );
    const battleStatsRaw = play && play.battle_stats && typeof play.battle_stats === "object"
      ? JSON.parse(JSON.stringify(play.battle_stats))
      : {};
    const battleStats = normalizeBattleStats(play.battle_stats);
    const baseInfo = normalizeBaseInfo(play.base_info);

    const requestMode = minimalRequests ? "minimal" : "full";

    await setParseDebug({
      playPagePropsKeys: safeKeys(pageProps),
      playKeys: safeKeys(play),
      currentSeasonId,
      seasonIds: targetSeasonIds,
      requestMode,
      battleStatsKeys: safeKeys(play.battle_stats),
      baseInfoKeys: safeKeys(play.base_info),
      battleStatsSource: hasMeaningfulBattleStats(jsonBattleStats)
        ? "play.json"
        : (hasMeaningfulBattleStats(htmlBattleStats) ? "play.html.__NEXT_DATA__" : "empty"),
      battleStatsSample: {
        gauge_rate_drive_guard: pickNumber(
          play && play.battle_stats && play.battle_stats.gauge_rate_drive_guard
        ),
        rank_match_play_count: pickNumber(
          play && play.battle_stats && play.battle_stats.rank_match_play_count
        )
      }
    });

    if (minimalRequests) {
      const previousSeasons =
        previousPlayStats
        && previousPlayStats.seasons
        && typeof previousPlayStats.seasons === "object"
        ? previousPlayStats.seasons
        : null;
      if (previousSeasons) {
        Object.keys(previousSeasons).forEach((key) => {
          seasons[key] = JSON.parse(JSON.stringify(previousSeasons[key]));
        });
      }

      const previousSeasonIds = Array.isArray(previousPlayStats && previousPlayStats.seasonIds)
        ? previousPlayStats.seasonIds
        : [];
      const mergedSeasonIds = [];
      const pushSeasonId = (value) => {
        const num = toNum(value);
        if (num === null || mergedSeasonIds.includes(num)) {
          return;
        }
        mergedSeasonIds.push(num);
      };
      if (currentSeasonId !== null) {
        pushSeasonId(currentSeasonId);
      }
      for (const id of previousSeasonIds) {
        pushSeasonId(id);
      }
      for (const id of targetSeasonIds) {
        pushSeasonId(id);
      }
      let outputSeasonIds = mergedSeasonIds.slice(0, PROFILE_MAX_SEASONS);
      if (!previousSeasons && currentSeasonId !== null) {
        outputSeasonIds = [currentSeasonId];
      }
      const targetSeasonId =
        currentSeasonId !== null
          ? currentSeasonId
          : (outputSeasonIds.length ? outputSeasonIds[0] : null);

      if (targetSeasonId !== null) {
        const targetKey = String(targetSeasonId);
        const previousTarget = seasons[targetKey] && typeof seasons[targetKey] === "object"
          ? seasons[targetKey]
          : null;
        const seasonData = {
          seasonId: targetSeasonId,
          leagueInfos: Array.isArray(previousTarget && previousTarget.leagueInfos)
            ? [...previousTarget.leagueInfos]
            : [],
          winRatesByMode: previousTarget && previousTarget.winRatesByMode
            ? { ...previousTarget.winRatesByMode }
            : {},
          rivalWinRatesByMode: previousTarget && previousTarget.rivalWinRatesByMode
            ? { ...previousTarget.rivalWinRatesByMode }
            : {}
        };

        await setSyncState({
          running: true,
          sid,
          locale,
          phase: "profile",
          profileSeason: targetSeasonId,
          profileMode: "league",
          profileProgress: "1/1"
        });

        if (initialLeague.length) {
          seasonData.leagueInfos = initialLeague;
        } else {
          try {
            const leagueResponse = await fetchPlayActResponse("leagueinfo", {
              targetShortId: sidNum,
              targetSeasonId: targetSeasonId,
              locale,
              peak: false
            });
            seasonData.leagueInfos = normalizeCharacterLeagueInfos(leagueResponse.character_league_infos);
          } catch (error) {
            const message = error instanceof Error ? error.message : "leagueinfo failed";
            warnings.push(`S${targetSeasonId} LP/MR: ${message}`);
          }
        }

        await sleep(randomProfileDelay());

        for (const modeId of PROFILE_MODE_IDS) {
          await setSyncState({
            running: true,
            sid,
            locale,
            phase: "profile",
            profileSeason: targetSeasonId,
            profileMode: modeId,
            profileProgress: "1/1"
          });

          if (modeId === 1 && (initialWinRate.length || initialRivalWinRate.length)) {
            seasonData.winRatesByMode[String(modeId)] = initialWinRate;
            seasonData.rivalWinRatesByMode[String(modeId)] = initialRivalWinRate;
            continue;
          }

          try {
            const winRateResponse = await fetchPlayActResponse("characterwinrate", {
              targetShortId: sidNum,
              targetSeasonId: targetSeasonId,
              targetModeId: modeId,
              lang: locale
            });
            seasonData.winRatesByMode[String(modeId)] = normalizeCharacterWinRates(
              winRateResponse.character_win_rates
            );
            const rivalSource = Array.isArray(winRateResponse.character_win_rates_by_rival_character)
              ? winRateResponse.character_win_rates_by_rival_character
              : winRateResponse.character_win_rates;
            seasonData.rivalWinRatesByMode[String(modeId)] = normalizeCharacterRivalWinRates(
              rivalSource
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "characterwinrate failed";
            warnings.push(`S${targetSeasonId} M${modeId}: ${message}`);
          }

          await sleep(randomProfileDelay());
        }

        seasons[targetKey] = seasonData;
      }

      return {
        locale,
        fetchedAt: new Date().toISOString(),
        currentSeasonId,
        seasonIds: outputSeasonIds,
        seasons,
        battleStatsRaw,
        battleStats,
        baseInfo,
        requestMode,
        warnings: warnings.slice(0, 30)
      };
    }

    for (let i = 0; i < targetSeasonIds.length; i += 1) {
      const seasonId = targetSeasonIds[i];
      const seasonKey = String(seasonId);
      const isCurrent = currentSeasonId !== null && seasonId === currentSeasonId;

      const seasonData = {
        seasonId,
        leagueInfos: [],
        winRatesByMode: {},
        rivalWinRatesByMode: {}
      };

      await setSyncState({
        running: true,
        sid,
        locale,
        phase: "profile",
        profileSeason: seasonId,
        profileMode: "league",
        profileProgress: `${i + 1}/${targetSeasonIds.length}`
      });

      if (isCurrent && initialLeague.length) {
        seasonData.leagueInfos = initialLeague;
      } else {
        try {
          const leagueResponse = await fetchPlayActResponse("leagueinfo", {
            targetShortId: sidNum,
            targetSeasonId: seasonId,
            locale,
            peak: false
          });
          seasonData.leagueInfos = normalizeCharacterLeagueInfos(leagueResponse.character_league_infos);
        } catch (error) {
          const message = error instanceof Error ? error.message : "leagueinfo failed";
          warnings.push(`S${seasonId} LP/MR: ${message}`);
          seasonData.leagueInfos = [];
        }
      }

      await sleep(randomProfileDelay());

      for (const modeId of PROFILE_MODE_IDS) {
        await setSyncState({
          running: true,
          sid,
          locale,
          phase: "profile",
          profileSeason: seasonId,
          profileMode: modeId,
          profileProgress: `${i + 1}/${targetSeasonIds.length}`
        });

        if (isCurrent && modeId === 1 && (initialWinRate.length || initialRivalWinRate.length)) {
          seasonData.winRatesByMode[String(modeId)] = initialWinRate;
          seasonData.rivalWinRatesByMode[String(modeId)] = initialRivalWinRate;
          continue;
        }

        let rivalRowsFromWinRate = [];
        try {
          const winRateResponse = await fetchPlayActResponse("characterwinrate", {
            targetShortId: sidNum,
            targetSeasonId: seasonId,
            targetModeId: modeId,
            lang: locale
          });
          seasonData.winRatesByMode[String(modeId)] = normalizeCharacterWinRates(
            winRateResponse.character_win_rates
          );
          const rivalSource = extractRivalRowsFromResponse(winRateResponse);
          rivalRowsFromWinRate = normalizeCharacterRivalWinRates(rivalSource);
        } catch (error) {
          const message = error instanceof Error ? error.message : "characterwinrate failed";
          warnings.push(`S${seasonId} M${modeId}: ${message}`);
          seasonData.winRatesByMode[String(modeId)] = [];
        }

        try {
          const attempts = minimalRequests ? 1 : RIVAL_FETCH_ATTEMPTS_FULL;
          let bestRivalRows = [];
          let bestBattleTotal = -1;
          const rivalAttemptSummaries = [];

          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const rivalResponse = await fetchPlayActResponse("characterwinratebyrivalcharacter", {
              targetShortId: sidNum,
              targetSeasonId: seasonId,
              targetModeId: modeId,
              lang: locale
            });
            const rivalRowsRaw = extractRivalRowsFromResponse(rivalResponse);
            let rivalRows = normalizeCharacterRivalWinRates(rivalRowsRaw);
            rivalRows = enrichRivalRowsWithCharacterMeta(
              rivalRows,
              seasonData.winRatesByMode[String(modeId)]
            );

            const battleTotal = totalRivalBattles(rivalRows);
            const rawCount = Array.isArray(rivalRowsRaw) ? rivalRowsRaw.length : 0;
            const shape = summarizeRivalResponseShape(rivalResponse);
            rivalAttemptSummaries.push(
              `a${attempt}:raw=${rawCount},rows=${rivalRows.length},battle=${battleTotal},${shape}`
            );
            if (
              battleTotal > bestBattleTotal
              || (battleTotal === bestBattleTotal && rivalRows.length > bestRivalRows.length)
            ) {
              bestRivalRows = rivalRows;
              bestBattleTotal = battleTotal;
            }

            if (attempt < attempts) {
              await sleep(randomProfileDelay());
            }
          }

          let rivalRows = bestRivalRows;
          if (!rivalRows.length && rivalRowsFromWinRate.length) {
            warnings.push(
              `S${seasonId} M${modeId} rival: fallback to characterwinrate rows=${rivalRowsFromWinRate.length}; attempts=${rivalAttemptSummaries.join(" || ")}`
            );
            rivalRows = rivalRowsFromWinRate;
          }
          if (!rivalRows.length && (seasonData.winRatesByMode[String(modeId)] || []).length) {
            warnings.push(
              `S${seasonId} M${modeId} rival: empty while winrateRows=${seasonData.winRatesByMode[String(modeId)].length}; attempts=${rivalAttemptSummaries.join(" || ")}`
            );
          } else if (!rivalRows.length) {
            warnings.push(
              `S${seasonId} M${modeId} rival: no rows; attempts=${rivalAttemptSummaries.join(" || ")}`
            );
          }
          seasonData.rivalWinRatesByMode[String(modeId)] = rivalRows;
        } catch (error) {
          const message = error instanceof Error ? error.message : "characterwinratebyrivalcharacter failed";
          warnings.push(`S${seasonId} M${modeId} rival: ${message}`);
          seasonData.rivalWinRatesByMode[String(modeId)] = rivalRowsFromWinRate;
        }

        await sleep(randomProfileDelay());
      }

      seasons[seasonKey] = seasonData;
    }

    return {
      locale,
      fetchedAt: new Date().toISOString(),
      currentSeasonId,
      seasonIds: targetSeasonIds,
      seasons,
      battleStatsRaw,
      battleStats,
      baseInfo,
      requestMode,
      warnings: warnings.slice(0, 30)
    };
  }

  function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function setStorage(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  }

  function setStorageStrict(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(`Storage write failed: ${err.message || "unknown error"}`));
          return;
        }
        resolve();
      });
    });
  }

  async function setSyncState(patch) {
    const current = await getStorage([SYNC_KEY]);
    const base = current[SYNC_KEY] || {};
    await setStorage({
      [SYNC_KEY]: {
        ...base,
        ...patch,
        updatedAt: new Date().toISOString()
      }
    });
  }

  async function setParseDebug(patch) {
    const current = await getStorage([DEBUG_KEY]);
    const base = current[DEBUG_KEY] || {};
    await setStorage({
      [DEBUG_KEY]: {
        ...base,
        ...patch,
        updatedAt: new Date().toISOString()
      }
    });
  }

  async function runSync(options = {}) {
    if (running) {
      return;
    }
    running = true;

    const forceFull = Boolean(options && options.forceFull);

    const sid = getSidFromUrl();
    const locale = getLocaleFromUrl();
    const buildId = getBuildIdFromNextData();

    if (!sid) {
      await setSyncState({
        running: false,
        error: "Cannot detect sid from current page."
      });
      notifySilentSyncFinished({
        ok: false,
        error: "Cannot detect sid from current page."
      });
      running = false;
      return;
    }

    if (!buildId) {
      await setSyncState({
        running: false,
        sid,
        locale,
        error: "Cannot read buildId. Refresh page and retry."
      });
      notifySilentSyncFinished({
        ok: false,
        sid,
        locale,
        error: "Cannot read buildId. Refresh page and retry."
      });
      running = false;
      return;
    }

    await setSyncState({
      running: true,
      sid,
      locale,
      page: 0,
      fetched: 0,
      parsePath: "",
      phase: "battlelog",
      error: null,
      startedAt: new Date().toISOString()
    });

    const currentStore = await getStorage([PLAYERS_KEY]);
    const players = currentStore[PLAYERS_KEY] || {};
    const existingPlayer = players[sid] || {};
    const existingMatches = Array.isArray(existingPlayer.matches) ? existingPlayer.matches : [];
    const existingKnownIds = Array.isArray(existingPlayer.knownReplayIds)
      ? existingPlayer.knownReplayIds
      : [];
    const isResync = !forceFull && Boolean(
      existingMatches.length
      || existingKnownIds.length
      || existingPlayer.lastSyncedAt
      || existingPlayer.playStats
    );
    const requestMode = isResync ? "minimal" : "full";

    const knownIdSet = new Set();
    if (isResync) {
      for (const id of existingKnownIds) {
        if (id) {
          knownIdSet.add(String(id));
        }
      }
      for (const item of existingMatches) {
        if (item && item.id) {
          knownIdSet.add(String(item.id));
        }
      }
    }

    const dedup = new Map();
    let page = 1;
    let dynamicMaxPages = isResync ? RESYNC_MAX_PAGES : Number.POSITIVE_INFINITY;
    let hitKnownReplay = false;

    try {
      for (; page <= dynamicMaxPages; page += 1) {
        const url =
          `${window.location.origin}/6/buckler/_next/data/${buildId}/` +
          `${locale}/profile/${sid}/battlelog.json?page=${page}&sid=${sid}`;

        const response = await fetchWithRetry(url);

        if (response.status === 429) {
          throw new Error("Rate limited (429). Retry later.");
        }
        if (response.status === 403) {
          throw new Error("Forbidden (403). Check login status.");
        }
        if (!response.ok) {
          if (page === 1) {
            throw new Error(`Request failed (${response.status}).`);
          }
          break;
        }

        const json = await response.json();
        const extraction = extractReplayRows(json);
        const rows = extraction.rows;

        if (page === 1) {
          if (extraction.totalPage > 0) {
            dynamicMaxPages = isResync
              ? Math.min(RESYNC_MAX_PAGES, extraction.totalPage)
              : extraction.totalPage;
          }
          await setParseDebug({
            sid,
            locale,
            page,
            parsePath: extraction.path || "",
            totalPage: extraction.totalPage,
            requestMode: requestMode,
            pageCap: Number.isFinite(dynamicMaxPages) ? dynamicMaxPages : null,
            ...extraction.debug
          });
        }

        if (!rows.length) {
          if (page === 1) {
            await setSyncState({
              running: false,
              sid,
              locale,
              page: 0,
              fetched: 0,
              parsePath: extraction.path || "",
              error: "No rows found in pageProps.replay_list."
            });
            notifySilentSyncFinished({
              ok: false,
              sid,
              locale,
              error: "No rows found in pageProps.replay_list."
            });
            running = false;
            return;
          }
          break;
        }

        rows.forEach((row, index) => {
          const normalized = normalizeReplayRow(row, sid, index, page);
          const replayId = String(normalized.id);
          if (isResync && knownIdSet.has(replayId)) {
            hitKnownReplay = true;
            return;
          }
          dedup.set(replayId, normalized);
        });

        await setSyncState({
          running: true,
          sid,
          locale,
          phase: "battlelog",
          page,
          fetched: dedup.size,
          parsePath: extraction.path || "",
          stopOnKnown: hitKnownReplay,
          requestMode: requestMode,
          pageCap: Number.isFinite(dynamicMaxPages) ? dynamicMaxPages : null,
          error: null
        });

        if (hitKnownReplay) {
          break;
        }

        await sleep(randomDelay());
      }

      const newMatches = Array.from(dedup.values()).sort((a, b) =>
        String(b.playedAt).localeCompare(String(a.playedAt))
      );
      const mergedMatches = mergeMatches(newMatches, existingMatches, isResync ? MATCH_DETAIL_CAP : null);
      inferScoreDeltas(mergedMatches);

      const summary = summarizeMatches(mergedMatches);
      const mergedKnownIds = buildKnownIds(
        newMatches,
        existingKnownIds,
        existingMatches,
        isResync ? KNOWN_ID_CAP : null
      );

      let playStats = existingPlayer.playStats || null;
      let playSyncError = null;

      try {
        playStats = await syncPlayProfileData({
          sid,
          locale,
          buildId,
          minimalRequests: requestMode === "minimal",
          previousPlayStats: existingPlayer.playStats || null
        });
      } catch (error) {
        playSyncError = error instanceof Error ? error.message : "Play profile sync failed.";
      }

      const playWarning = playSyncError
        || (playStats && Array.isArray(playStats.warnings) && playStats.warnings.length
          ? playStats.warnings[0]
          : null);

      players[sid] = {
        sid,
        locale,
        sourceUrl: window.location.href,
        buildId,
        lastSyncedAt: new Date().toISOString(),
        totalMatches: summary.total,
        wins: summary.wins,
        losses: summary.losses,
        draws: summary.draws,
        winRate: Number(summary.winRate),
        newAdded: newMatches.length,
        knownReplayIds: mergedKnownIds,
        playStats,
        requestMode: requestMode,
        playSyncError,
        matches: mergedMatches
      };

      await setStorageStrict({ [PLAYERS_KEY]: players });
      await setSyncState({
        running: false,
        sid,
        locale,
        phase: "done",
        page: page - 1,
        fetched: summary.total,
        newAdded: newMatches.length,
        stopReason: hitKnownReplay ? "hit-known-replay" : "end-of-pages",
        parsePath: "pageProps.replay_list",
        requestMode: requestMode,
        pageCap: Number.isFinite(dynamicMaxPages) ? dynamicMaxPages : null,
        warning: playWarning,
        error: null,
        completedAt: new Date().toISOString()
      });
      notifySilentSyncFinished({
        ok: true,
        sid,
        locale,
        reason: hitKnownReplay ? "hit-known-replay" : "end-of-pages",
        requestMode
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";
      await setSyncState({
        running: false,
        sid,
        locale,
        page: page - 1,
        fetched: dedup.size,
        error: message,
        failedAt: new Date().toISOString()
      });
      notifySilentSyncFinished({
        ok: false,
        sid,
        locale,
        error: message,
        requestMode
      });
    }

    running = false;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "START_SYNC") {
      return false;
    }
    runSync({ forceFull: Boolean(message.forceFull) }).catch(() => {});
    sendResponse({ ok: true, started: true });
    return false;
  });
})();
