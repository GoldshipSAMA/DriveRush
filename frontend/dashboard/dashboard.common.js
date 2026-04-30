function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "扩展通信失败" });
        return;
      }
      resolve(response || { ok: false, error: "无响应" });
    });
  });
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatInt(value) {
  const num = toNum(value);
  return num === null ? "-" : num.toLocaleString("zh-CN");
}

function formatPercent(value, digits = 1) {
  const num = toNum(value);
  return num === null ? "-" : `${num.toFixed(digits)}%`;
}

function formatRatioPercent(value, digits = 2) {
  const num = toNum(value);
  if (num === null) {
    return "-";
  }
  const percent = Math.abs(num) <= 1 ? num * 100 : num;
  return `${percent.toFixed(digits)}%`;
}

function formatSeconds(value) {
  const num = toNum(value);
  return num === null ? "-" : `${num.toLocaleString("zh-CN")} 秒`;
}

function formatDelta(value) {
  const num = toNum(value);
  if (num === null || num === 0) {
    return "-";
  }
  return num > 0 ? `+${num}` : `${num}`;
}

function formatDate(iso) {
  if (!iso) {
    return "-";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function pickAchievementValue(source, keyOrKeys) {
  if (Array.isArray(keyOrKeys)) {
    for (const key of keyOrKeys) {
      if (hasOwn(source, key)) {
        return { key, value: source[key], exists: true };
      }
    }
    return { key: keyOrKeys[0] || "", value: null, exists: false };
  }
  if (hasOwn(source, keyOrKeys)) {
    return { key: keyOrKeys, value: source[keyOrKeys], exists: true };
  }
  return { key: keyOrKeys, value: null, exists: false };
}

function formatAchievementMetric(value, formatType) {
  if (formatType === "ratioPercent") {
    return formatRatioPercent(value, 2);
  }
  if (formatType === "seconds") {
    return formatSeconds(value);
  }
  if (formatType === "count") {
    return formatInt(value);
  }
  if (formatType === "text") {
    if (value === null || value === undefined || value === "") {
      return "-";
    }
    return String(value);
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  const num = toNum(value);
  if (num !== null) {
    return Number.isInteger(num) ? formatInt(num) : String(num);
  }
  return String(value);
}

function buildAchievementRows(playStats) {
  const battleStats = playStats && typeof playStats === "object"
    ? (
      (playStats.battleStats && typeof playStats.battleStats === "object" && playStats.battleStats)
      || (playStats.battleStatsRaw && typeof playStats.battleStatsRaw === "object" && playStats.battleStatsRaw)
      || (playStats.battle_stats && typeof playStats.battle_stats === "object" && playStats.battle_stats)
      || (playStats.play && playStats.play.battle_stats && typeof playStats.play.battle_stats === "object" && playStats.play.battle_stats)
      || {}
    )
    : {};
  const baseInfo = playStats && typeof playStats === "object"
    ? (
      (playStats.baseInfo && typeof playStats.baseInfo === "object" && playStats.baseInfo)
      || (playStats.base_info && typeof playStats.base_info === "object" && playStats.base_info)
      || (playStats.play && playStats.play.base_info && typeof playStats.play.base_info === "object" && playStats.play.base_info)
      || {}
    )
    : {};
  const source = { ...baseInfo, ...battleStats };
  const rows = [];
  const groups = [];
  const used = new Set();
  let presentCount = 0;

  ACHIEVEMENT_FIELD_GROUPS.forEach((group) => {
    let first = true;
    const groupItems = [];
    group.items.forEach((item) => {
      const picked = pickAchievementValue(source, item.key);
      const value = picked.value;
      const display = formatAchievementMetric(value, item.format);
      if (picked.exists) {
        presentCount += 1;
      }
      if (Array.isArray(item.key)) {
        item.key.forEach((k) => used.add(k));
      } else {
        used.add(item.key);
      }
      rows.push([
        first ? group.group : "",
        item.label,
        display
      ]);
      groupItems.push({
        label: item.label,
        key: picked.key,
        value,
        exists: picked.exists,
        display
      });
      first = false;
    });
    groups.push({
      group: group.group,
      items: groupItems
    });
  });

  const extraKeys = Object.keys(source).filter((key) => !used.has(key)).sort();
  const extraRows = [];
  if (extraKeys.length) {
    extraKeys.forEach((key, index) => {
      const row = [
        index === 0 ? "其他字段" : "",
        key,
        formatAchievementMetric(source[key], "auto")
      ];
      rows.push(row);
      extraRows.push({
        key,
        display: row[2]
      });
    });
  }

  return {
    rows,
    groups,
    extraRows,
    presentCount,
    totalCount: rows.length,
    metricCount: ACHIEVEMENT_FIELD_GROUPS.reduce((acc, group) => acc + group.items.length, 0)
  };
}

function setPills(container, list) {
  container.innerHTML = "";
  list.forEach((text) => {
    const span = document.createElement("span");
    span.className = "stat-pill";
    span.textContent = text;
    container.appendChild(span);
  });
}

function setActiveByData(buttons, attr, value) {
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset[attr] === value);
  });
}

function getPlayer() {
  if (!state.selectedSid) {
    return null;
  }
  return state.players[state.selectedSid] || null;
}

function pickSid(players, syncState) {
  if (syncState && syncState.sid && players[syncState.sid]) {
    return String(syncState.sid);
  }
  const items = Object.values(players || {});
  if (!items.length) {
    return null;
  }
  items.sort((a, b) => String(b.lastSyncedAt || "").localeCompare(String(a.lastSyncedAt || "")));
  return items[0] && items[0].sid ? String(items[0].sid) : null;
}

function getMatches(player) {
  const rows = Array.isArray(player && player.matches) ? player.matches : [];
  return [...rows].sort((a, b) => String(b.playedAt || "").localeCompare(String(a.playedAt || "")));
}

function summarize(matches) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  matches.forEach((m) => {
    if (m.result === "win") {
      wins += 1;
    } else if (m.result === "loss") {
      losses += 1;
    } else if (m.result === "draw") {
      draws += 1;
    }
  });
  const total = matches.length;
  const winRate = total ? (wins / total) * 100 : 0;
  return { wins, losses, draws, total, winRate };
}

function getMetricValueForMetric(match, metric) {
  const before = metric === "mr" ? toNum(match.myMasterRating) : toNum(match.myLeaguePoint);
  const delta = getMetricDeltaForMetric(match, metric);
  if (before === null) {
    return null;
  }
  return before + (delta || 0);
}

function getMetricDeltaForMetric(match, metric) {
  return metric === "mr" ? toNum(match.masterRatingDelta) : toNum(match.leaguePointDelta);
}

function getMetricBeforeValueForMetric(match, metric) {
  return metric === "mr" ? toNum(match.myMasterRating) : toNum(match.myLeaguePoint);
}

function getMetricValue(match) {
  return getMetricValueForMetric(match, state.metric);
}

function getMetricDelta(match) {
  return getMetricDeltaForMetric(match, state.metric);
}

function hasMetricData(matches, metric) {
  return (Array.isArray(matches) ? matches : []).some((match) => getMetricValueForMetric(match, metric) !== null);
}

function updateViewSwitch() {
  setActiveByData(refs.sideTabs, "view", state.currentView);
  const showBattleSurface = state.currentView === "overview" || state.currentView === "battlelog";
  if (refs.viewBattlelog) {
    refs.viewBattlelog.classList.toggle("is-hidden", !showBattleSurface);
  }
  if (refs.viewProfile) {
    refs.viewProfile.classList.toggle("is-hidden", state.currentView !== "profile");
  }
  if (refs.viewFramedata) {
    refs.viewFramedata.classList.toggle("is-hidden", state.currentView !== "framedata");
  }
  if (refs.root) {
    refs.root.classList.toggle("is-overview-focus", state.currentView === "overview");
    refs.root.classList.toggle("is-battlelog-focus", state.currentView === "battlelog");
  }
}

function setSyncStatus() {
  const sync = state.syncState || {};
  const backup = state.backupState || {};
  if (sync.running) {
    const phase = String(sync.phase || "battlelog");
    const fetched = Number(sync.fetched || 0);
    const requestMode = String(sync.requestMode || "").toLowerCase();
    const modeLabel = requestMode === "full" ? "全量" : (requestMode === "minimal" ? "增量" : "同步");

    if (phase === "battlelog") {
      const page = Number(sync.page || 0);
      const pageCapRaw = Number(sync.pageCap);
      const hasTotal = Number.isFinite(pageCapRaw) && pageCapRaw > 0;
      const pageText = hasTotal ? `${page} / ${pageCapRaw}` : `${page}`;
      refs.syncStatus.textContent = `${modeLabel}进行中：战绩抓取第 ${pageText} 页，新增 ${fetched} 条`;
      return;
    }

    if (phase === "profile") {
      const season = sync.profileSeason != null ? String(sync.profileSeason) : "-";
      const progress = String(sync.profileProgress || "-");
      refs.syncStatus.textContent = `${modeLabel}进行中：资料抓取 S${season}（${progress}），新增 ${fetched} 条`;
      return;
    }

    refs.syncStatus.textContent = `${modeLabel}进行中：${phase}，新增 ${fetched} 条`;
    return;
  }
  if (sync.error) {
    refs.syncStatus.textContent = `同步失败：${sync.error}`;
    return;
  }
  if (sync.completedAt) {
    const isFullCompleted = String(sync.requestMode || "").toLowerCase() === "full";
    const completedLabel = isFullCompleted
      ? `同步完成：${sync.completedAt}（已完成全量，下次静默导入将执行增量）`
      : `同步完成：${sync.completedAt}`;
    if (backup && backup.ok && backup.lastBackupAt) {
      refs.syncStatus.textContent = `${completedLabel}，已自动备份到本地（${backup.lastBackupAt}）`;
      return;
    }
    if (backup && backup.ok === false && backup.error) {
      refs.syncStatus.textContent = `${completedLabel}，但本地备份失败（${backup.error}）`;
      return;
    }
    refs.syncStatus.textContent = completedLabel;
    return;
  }
  refs.syncStatus.textContent = "等待同步";
}

function renderDebug() {
  if (!refs.debugBox) {
    return;
  }
  refs.debugBox.textContent = JSON.stringify(
    {
      syncState: state.syncState || {},
      parseDebug: state.parseDebug || {},
      backupState: state.backupState || {}
    },
    null,
    2
  );
}

function buildCharacterOptions(matches) {
  const map = new Map();
  matches.forEach((m) => {
    const name = String(m.myCharacter || "").trim();
    if (!name) {
      return;
    }
    const item = map.get(name) || { key: name, label: name, count: 0 };
    item.count += 1;
    map.set(name, item);
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function renderCharacterSidebar(options) {
  if (!refs.battleCharacterList) {
    return;
  }
  refs.battleCharacterList.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("span");
    empty.className = "stat-pill";
    empty.textContent = "暂无角色数据";
    refs.battleCharacterList.appendChild(empty);
    return;
  }

  if (state.currentCharacter && !options.some((o) => o.key === state.currentCharacter)) {
    state.currentCharacter = "";
  }

  const allBtn = document.createElement("button");
  allBtn.className = `character-filter-btn${!state.currentCharacter ? " active" : ""}`;
  allBtn.textContent = "全部角色";
  allBtn.type = "button";
  allBtn.addEventListener("click", () => {
    state.currentCharacter = "";
    state.page = 1;
    renderBattlelog();
  });
  refs.battleCharacterList.appendChild(allBtn);

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = `character-filter-btn${opt.key === state.currentCharacter ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = `${opt.label} · ${opt.count}`;
    btn.addEventListener("click", () => {
      state.currentCharacter = opt.key;
      state.page = 1;
      renderBattlelog();
    });
    refs.battleCharacterList.appendChild(btn);
  });
}
