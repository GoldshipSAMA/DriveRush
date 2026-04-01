function getAvailableSeasonIds(playStats) {
  const raw = [];
  const seasonIds = Array.isArray(playStats && playStats.seasonIds) ? playStats.seasonIds : [];
  seasonIds.forEach((id) => raw.push(id));

  const seasons = playStats && playStats.seasons && typeof playStats.seasons === "object"
    ? playStats.seasons
    : {};
  Object.keys(seasons).forEach((key) => raw.push(key));

  const uniq = [];
  raw.forEach((value) => {
    const num = toNum(value);
    if (num === null || !Number.isFinite(num)) {
      return;
    }
    const intNum = Math.trunc(num);
    if (!uniq.includes(intNum)) {
      uniq.push(intNum);
    }
  });

  uniq.sort((a, b) => b - a);
  return uniq;
}

function ensureProfileFilters(playStats) {
  const seasonIds = getAvailableSeasonIds(playStats);
  const seasonKeys = seasonIds.map((id) => String(id));
  if (!seasonKeys.length) {
    state.profileSeason = "";
  } else if (!seasonKeys.includes(String(state.profileSeason))) {
    state.profileSeason = String(playStats.currentSeasonId || seasonKeys[0]);
  }

  if (!["1", "2", "3", "4", "5"].includes(String(state.profileMode))) {
    state.profileMode = "1";
  }
}

function getSeasonData(playStats) {
  if (!playStats || !playStats.seasons) {
    return null;
  }
  return playStats.seasons[String(state.profileSeason)] || null;
}

function getProfileRows(playStats) {
  const season = getSeasonData(playStats);
  const winRows = Array.isArray(season && season.winRatesByMode && season.winRatesByMode[state.profileMode])
    ? season.winRatesByMode[state.profileMode]
    : [];
  const leagueRows = Array.isArray(season && season.leagueInfos) ? season.leagueInfos : [];
  const rivalRows = Array.isArray(season && season.rivalWinRatesByMode && season.rivalWinRatesByMode[state.profileMode])
    ? season.rivalWinRatesByMode[state.profileMode]
    : [];
  return { winRows, leagueRows, rivalRows };
}

function renderProfileTable(headers, rows) {
  refs.profileHeadRow.innerHTML = "";
  headers.forEach((header) => {
    const th = document.createElement("th");
    if (header && typeof header === "object") {
      const label = document.createElement("span");
      label.textContent = String(header.label || "");
      th.appendChild(label);

      if (header.sortKey) {
        th.classList.add("sortable-th");
        const arrows = document.createElement("span");
        arrows.className = "sort-arrows";

        const up = document.createElement("button");
        up.type = "button";
        up.className = "sort-btn";
        up.textContent = "\u25B2";
        if (state.profileBattleSortBy === header.sortKey && state.profileBattleSortOrder === "asc") {
          up.classList.add("active");
        }
        up.addEventListener("click", () => {
          state.profileBattleSortBy = header.sortKey;
          state.profileBattleSortOrder = "asc";
          renderProfile();
        });

        const down = document.createElement("button");
        down.type = "button";
        down.className = "sort-btn";
        down.textContent = "\u25BC";
        if (state.profileBattleSortBy === header.sortKey && state.profileBattleSortOrder === "desc") {
          down.classList.add("active");
        }
        down.addEventListener("click", () => {
          state.profileBattleSortBy = header.sortKey;
          state.profileBattleSortOrder = "desc";
          renderProfile();
        });

        arrows.appendChild(up);
        arrows.appendChild(down);
        th.appendChild(arrows);
      }
    } else {
      th.textContent = String(header);
    }
    refs.profileHeadRow.appendChild(th);
  });

  refs.profileBody.innerHTML = "";
  rows.forEach((cells) => {
    const tr = document.createElement("tr");
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = String(text);
      tr.appendChild(td);
    });
    refs.profileBody.appendChild(tr);
  });
}

function renderAchievementBoard(achievement) {
  if (!refs.profileAchievementsBoard) {
    return;
  }
  refs.profileAchievementsBoard.innerHTML = "";
  const groups = Array.isArray(achievement && achievement.groups) ? achievement.groups : [];
  const extraRows = Array.isArray(achievement && achievement.extraRows) ? achievement.extraRows : [];
  let renderedCount = 0;

  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "achievement-group";

    const title = document.createElement("h3");
    title.className = "achievement-group-title";
    title.textContent = String(group.group || "-");
    section.appendChild(title);

    const list = document.createElement("div");
    list.className = "achievement-group-list";

    const items = Array.isArray(group.items) ? group.items : [];
    items.forEach((item) => {
      const row = document.createElement("article");
      row.className = "achievement-item";
      if (!item.exists) {
        row.classList.add("is-missing");
      }

      const label = document.createElement("p");
      label.className = "achievement-item-label";
      label.textContent = String(item.label || "-");
      row.appendChild(label);

      const value = document.createElement("p");
      value.className = "achievement-item-value";
      value.textContent = String(item.display == null ? "-" : item.display);
      row.appendChild(value);

      list.appendChild(row);
      renderedCount += 1;
    });

    section.appendChild(list);
    refs.profileAchievementsBoard.appendChild(section);
  });

  if (extraRows.length) {
    const section = document.createElement("section");
    section.className = "achievement-group";

    const title = document.createElement("h3");
    title.className = "achievement-group-title";
    title.textContent = "其他字段";
    section.appendChild(title);

    const list = document.createElement("div");
    list.className = "achievement-group-list";

    extraRows.slice(0, 24).forEach((item) => {
      const row = document.createElement("article");
      row.className = "achievement-item achievement-item-extra";

      const label = document.createElement("p");
      label.className = "achievement-item-label";
      label.textContent = String(item.key || "-");
      row.appendChild(label);

      const value = document.createElement("p");
      value.className = "achievement-item-value";
      value.textContent = String(item.display == null ? "-" : item.display);
      row.appendChild(value);

      list.appendChild(row);
      renderedCount += 1;
    });

    section.appendChild(list);
    refs.profileAchievementsBoard.appendChild(section);
  }

  if (!renderedCount) {
    const empty = document.createElement("p");
    empty.className = "character-empty";
    empty.textContent = "暂无格斗成就数据";
    refs.profileAchievementsBoard.appendChild(empty);
  }
}

function getAllRivalSummary(characterRow) {
  const rivals = Array.isArray(characterRow && characterRow.rival_character_win_rates)
    ? characterRow.rival_character_win_rates
    : [];
  const allRow = rivals.find((r) => String(r.rival_character_tool_name || "") === "all");
  if (allRow) {
    return {
      battle: toNum(allRow.battle_count) || 0,
      win: toNum(allRow.win_count) || 0
    };
  }
  const filtered = rivals.filter((r) => String(r.rival_character_tool_name || "") !== "all");
  return {
    battle: filtered.reduce((acc, r) => acc + (toNum(r.battle_count) || 0), 0),
    win: filtered.reduce((acc, r) => acc + (toNum(r.win_count) || 0), 0)
  };
}

function getBattleCharacterOptions(rivalRows) {
  const options = [];
  if (Array.isArray(rivalRows) && rivalRows.length) {
    rivalRows.forEach((row) => {
      const tool = String(row.character_tool_name || "");
      if (!tool || tool === "all") {
        return;
      }
      const summary = getAllRivalSummary(row);
      const battle = summary.battle;
      const win = summary.win;
      if (battle <= 0) {
        return;
      }
      options.push({
        tool,
        name: String(row.character_name || row.character_alpha || tool),
        battle,
        win
      });
    });
  }

  options.sort((a, b) => {
    if (b.battle !== a.battle) {
      return b.battle - a.battle;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
  return options;
}

function renderProfileCharacterSelect(options) {
  const show = state.profileTab === "battles";
  refs.profileCharacterWrap.classList.toggle("is-hidden", !show);
  if (!show) {
    return;
  }

  refs.profileCharacterSelect.innerHTML = "";
  if (!options.length) {
    const op = document.createElement("option");
    op.value = "";
    op.textContent = "暂无角色数据";
    refs.profileCharacterSelect.appendChild(op);
    state.profileCharacterTool = "";
    return;
  }

  if (!options.some((o) => o.tool === state.profileCharacterTool)) {
    state.profileCharacterTool = options[0].tool;
  }

  options.forEach((o) => {
    const op = document.createElement("option");
    op.value = o.tool;
    op.textContent = `${o.name} (${o.battle})`;
    refs.profileCharacterSelect.appendChild(op);
  });
  refs.profileCharacterSelect.value = state.profileCharacterTool;
}

function getSelectedRivalRows(rivalRows, selectedTool) {
  if (!Array.isArray(rivalRows) || !selectedTool) {
    return [];
  }
  const selected = rivalRows.find((row) => String(row.character_tool_name || "") === selectedTool);
  if (!selected || !Array.isArray(selected.rival_character_win_rates)) {
    return [];
  }
  return selected.rival_character_win_rates
    .filter((r) => (toNum(r.battle_count) || 0) > 0 && String(r.rival_character_tool_name || "") !== "all")
    .sort((a, b) => {
      const ba = toNum(a.battle_count) || 0;
      const bb = toNum(b.battle_count) || 0;
      if (ba !== bb) {
        return bb - ba;
      }
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

function setBattleSortControlVisibility(visible) {
  if (refs.profileBattleSortWrap) {
    refs.profileBattleSortWrap.classList.add("is-hidden");
  }
  if (refs.profileBattleOrderWrap) {
    refs.profileBattleOrderWrap.classList.add("is-hidden");
  }
}

function sortBattleRows(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const sign = state.profileBattleSortOrder === "asc" ? 1 : -1;
  const sortKey = state.profileBattleSortBy || "battle";
  list.sort((a, b) => {
    let diff = (toNum(a[sortKey]) || 0) - (toNum(b[sortKey]) || 0);
    if (diff === 0 && sortKey !== "battle") {
      diff = (toNum(a.battle) || 0) - (toNum(b.battle) || 0);
    }
    if (diff === 0 && sortKey !== "winRate") {
      diff = (toNum(a.winRate) || 0) - (toNum(b.winRate) || 0);
    }
    if (diff === 0) {
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
    }
    return diff * sign;
  });
  return list;
}

function renderProfile() {
  setActiveByData(refs.profileSideBtns, "profileTab", state.profileTab);
  const meta = PROFILE_TAB_META[state.profileTab] || PROFILE_TAB_META.winrate;
  refs.profileSectionTitle.textContent = meta.title;
  refs.profileModeSelect.disabled = Boolean(meta.modeDisabled);
  refs.profileSeasonSelect.disabled = Boolean(meta.seasonDisabled);

  const player = getPlayer();
  const playStats = player && player.playStats ? player.playStats : null;
  const isAchievementsTab = state.profileTab === "achievements";
  if (refs.profileTable) {
    refs.profileTable.classList.toggle("is-hidden", isAchievementsTab);
  }
  if (refs.profileAchievementsBoard) {
    refs.profileAchievementsBoard.classList.toggle("is-hidden", !isAchievementsTab);
    if (!isAchievementsTab) {
      refs.profileAchievementsBoard.innerHTML = "";
    }
  }
  if (!playStats) {
    refs.profileSeasonSelect.innerHTML = "";
    refs.profileCharacterWrap.classList.add("is-hidden");
    setBattleSortControlVisibility(false);
    refs.profileHint.textContent = "暂无基本资料数据，请先同步。";
    setPills(refs.profileStats, []);
    if (isAchievementsTab && refs.profileAchievementsBoard) {
      refs.profileAchievementsBoard.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "character-empty";
      empty.textContent = "暂无格斗成就数据，请先同步。";
      refs.profileAchievementsBoard.appendChild(empty);
      return;
    }
    renderProfileTable(["提示"], [["暂无数据"]]);
    return;
  }

  ensureProfileFilters(playStats);

  refs.profileSeasonSelect.innerHTML = "";
  const seasonIds = getAvailableSeasonIds(playStats);
  seasonIds.forEach((id) => {
    const op = document.createElement("option");
    op.value = String(id);
    op.textContent = `S${id}`;
    refs.profileSeasonSelect.appendChild(op);
  });
  refs.profileSeasonSelect.value = String(state.profileSeason);
  refs.profileModeSelect.value = String(state.profileMode);

  const { winRows, leagueRows, rivalRows } = getProfileRows(playStats);
  const playedWinRows = (Array.isArray(winRows) ? winRows : []).filter(
    (r) => (toNum(r.battle_count) || 0) > 0
  );
  const playedLeagueRows = (Array.isArray(leagueRows) ? leagueRows : []).filter((r) => {
    if (r && r.is_played === true) {
      return true;
    }
    const lp = toNum(r && r.league_info && r.league_info.league_point);
    const mr = toNum(r && r.league_info && r.league_info.master_rating);
    return (lp !== null && lp > 0) || mr !== null;
  });
  const leagueDisplayRows = playedLeagueRows.filter(
    (r) => toNum(r && r.league_info && r.league_info.league_point) !== -1
  );
  const masterDisplayRows = playedLeagueRows.filter((r) => {
    const mr = toNum(r && r.league_info && r.league_info.master_rating);
    return mr !== null && mr !== 0;
  });
  let battleCharacterOptions = getBattleCharacterOptions(rivalRows);
  renderProfileCharacterSelect(battleCharacterOptions);
  setBattleSortControlVisibility(state.profileTab === "battles");

  let headers = [];
  let rows = [];
  let hint = `赛季 S${state.profileSeason}，模式 ${MODE_LABELS[state.profileMode] || "全部"}`;
  if (state.profileTab === "achievements") {
    hint = "趋势（最近100场战斗）是全局统计，不区分赛季和模式";
  }

  if (state.profileTab === "achievements") {
    const achievement = buildAchievementRows(playStats);
    renderAchievementBoard(achievement);
    setPills(refs.profileStats, [
      "趋势窗口：最近100场",
      `已匹配字段：${achievement.presentCount}`,
      `固定指标：${achievement.metricCount}`,
      `总展示项：${achievement.totalCount}`
    ]);
    refs.profileHint.textContent = "参照 Buckler「格斗成就」结构重排，趋势统计不区分赛季和模式";
    return;
  }

  if (state.profileTab === "winrate") {
    headers = ["角色", "对战", "胜利", "败北", "胜率"];
    rows = [...playedWinRows]
      .sort((a, b) => (toNum(b.battle_count) || 0) - (toNum(a.battle_count) || 0))
      .map((r) => {
        const battle = toNum(r.battle_count) || 0;
        const win = toNum(r.win_count) || 0;
        const loss = Math.max(0, battle - win);
        const rate = battle ? (win / battle) * 100 : 0;
        return [String(r.character_name || "-"), battle, win, loss, formatPercent(rate, 2)];
      });
    const totalBattle = playedWinRows.reduce(
      (acc, r) => acc + (toNum(r.battle_count) || 0),
      0
    );
    const totalWin = playedWinRows.reduce(
      (acc, r) => acc + (toNum(r.win_count) || 0),
      0
    );
    setPills(refs.profileStats, [
      `角色数：${playedWinRows.length}`,
      `总对战：${totalBattle}`,
      `总胜率：${formatPercent(totalBattle ? (totalWin / totalBattle) * 100 : 0, 2)}`
    ]);
  } else if (state.profileTab === "battles") {
    headers = [
      { label: "对手角色" },
      { label: "对战", sortKey: "battle" },
      { label: "胜利", sortKey: "win" },
      { label: "败北", sortKey: "loss" },
      { label: "胜率", sortKey: "winRate" }
    ];
    if (!battleCharacterOptions.length) {
      hint = `赛季 S${state.profileSeason}，模式 ${MODE_LABELS[state.profileMode] || "全部"}：暂无对位数据。`;
      setPills(refs.profileStats, ["角色数：0"]);
      rows = [];
    } else {
      const selectedTool = state.profileCharacterTool;
      const selectedInfo = battleCharacterOptions.find((o) => o.tool === selectedTool) || battleCharacterOptions[0];
      const selectedRivals = getSelectedRivalRows(rivalRows, selectedInfo.tool);
      rows = selectedRivals.map((r) => {
        const battle = toNum(r.battle_count) || 0;
        const win = toNum(r.win_count) || 0;
        const loss = Math.max(0, battle - win);
        const rate = battle ? (win / battle) * 100 : 0;
        return [String(r.rival_character_name || "-"), battle, win, loss, formatPercent(rate, 2)];
      });
      const sortableRows = rows.map((r) => ({
        name: String(r[0] || "-"),
        battle: toNum(r[1]) || 0,
        win: toNum(r[2]) || 0,
        loss: toNum(r[3]) || 0,
        winRate: toNum(String(r[4] || "").replace("%", "")) || 0
      }));
      rows = sortBattleRows(sortableRows).map((r) => [
        r.name,
        r.battle,
        r.win,
        r.loss,
        formatPercent(r.winRate, 2)
      ]);

      hint = `赛季 S${state.profileSeason}，模式 ${MODE_LABELS[state.profileMode] || "全部"}：我方角色 ${selectedInfo.name}`;
      if (!selectedRivals.length) {
        hint += "（该赛季该模式缺少对位明细）";
      }
      setPills(refs.profileStats, [
        `我方角色：${selectedInfo.name}`,
        `总对战：${selectedInfo.battle}`,
        `总胜率：${formatPercent(selectedInfo.battle ? (selectedInfo.win / selectedInfo.battle) * 100 : 0, 2)}`,
        `对位角色数：${rows.length}`
      ]);
    }
  } else if (state.profileTab === "league") {
    headers = ["角色", "LP", "段位编号"];
    rows = [...leagueDisplayRows]
      .sort(
        (a, b) =>
          (toNum(b.league_info && b.league_info.league_point) || 0)
          - (toNum(a.league_info && a.league_info.league_point) || 0)
      )
      .map((r) => [
        String(r.character_name || "-"),
        formatInt(r.league_info && r.league_info.league_point),
        formatInt(r.league_info && r.league_info.league_rank)
      ]);
    hint = `赛季 S${state.profileSeason}（段位积分不区分模式）`;
    setPills(refs.profileStats, [`角色数：${leagueDisplayRows.length}`]);
  } else if (state.profileTab === "master") {
    headers = ["角色", "MR", "MR排名", "Master级别"];
    rows = [...masterDisplayRows]
      .sort(
        (a, b) =>
          (toNum(b.league_info && b.league_info.master_rating) || 0)
          - (toNum(a.league_info && a.league_info.master_rating) || 0)
      )
      .map((r) => [
        String(r.character_name || "-"),
        formatInt(r.league_info && r.league_info.master_rating),
        formatInt(r.league_info && r.league_info.master_rating_ranking),
        formatInt(r.league_info && r.league_info.master_league)
      ]);
    const withMr = masterDisplayRows.length;
    hint = `赛季 S${state.profileSeason}（Master积分不区分模式）`;
    setPills(refs.profileStats, [`有MR角色：${withMr}`]);
  } else {
    headers = ["项目", "数值"];
    const totalBattle = (Array.isArray(winRows) ? winRows : []).reduce(
      (acc, r) => acc + (toNum(r.battle_count) || 0),
      0
    );
    const totalWin = (Array.isArray(winRows) ? winRows : []).reduce(
      (acc, r) => acc + (toNum(r.win_count) || 0),
      0
    );
    const maxBattle = (Array.isArray(winRows) ? [...winRows] : []).sort(
      (a, b) => (toNum(b.battle_count) || 0) - (toNum(a.battle_count) || 0)
    )[0];
    const bestLp = (Array.isArray(leagueRows) ? [...leagueRows] : []).sort(
      (a, b) =>
        (toNum(b.league_info && b.league_info.league_point) || 0)
        - (toNum(a.league_info && a.league_info.league_point) || 0)
    )[0];
    const bestMr = (Array.isArray(leagueRows) ? [...leagueRows] : []).sort(
      (a, b) =>
        (toNum(b.league_info && b.league_info.master_rating) || 0)
        - (toNum(a.league_info && a.league_info.master_rating) || 0)
    )[0];
    rows = [
      ["总对战", formatInt(totalBattle)],
      ["总胜利", formatInt(totalWin)],
      ["总败北", formatInt(Math.max(0, totalBattle - totalWin))],
      ["综合胜率", formatPercent(totalBattle ? (totalWin / totalBattle) * 100 : 0, 2)],
      [
        "最多使用角色",
        maxBattle ? `${maxBattle.character_name} (${formatInt(maxBattle.battle_count)})` : "-"
      ],
      [
        "最高LP角色",
        bestLp ? `${bestLp.character_name} (${formatInt(bestLp.league_info && bestLp.league_info.league_point)})` : "-"
      ],
      [
        "最高MR角色",
        bestMr ? `${bestMr.character_name} (${formatInt(bestMr.league_info && bestMr.league_info.master_rating)})` : "-"
      ]
    ];
    setPills(refs.profileStats, [`角色数：${winRows.length}`]);
  }

  refs.profileHint.textContent = hint;
  renderProfileTable(headers, rows.length ? rows : [["暂无数据"]]);
}

