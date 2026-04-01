function clearObject(target) {
  Object.keys(target || {}).forEach((key) => {
    delete target[key];
  });
}

function getFramedataCharacterLabel(key, fallback = "") {
  const characterKey = String(key || "").trim().toLowerCase();
  const preferred = FRAMEDATA_DISPLAY_LABELS && FRAMEDATA_DISPLAY_LABELS[characterKey];
  if (preferred) {
    return preferred;
  }
  const text = fallback == null ? "" : String(fallback).trim();
  return text || characterKey.toUpperCase();
}

const FD_WEAK = "\u5f31";
const FD_MEDIUM = "\u4e2d";
const FD_HEAVY = "\u5f37";
const FD_ATTACK = "\u653b\u6483";
const FD_ATTACK_TWO = "\u653b\u6483\u4e8c\u3064";
const FD_THROW = "\u6295";

function escapeFramedataRegexText(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeFramedataText(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function normalizeFramedataNotes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeFramedataText(item))
      .filter((item) => item)
      .join(" / ") || "-";
  }
  return normalizeFramedataText(value, "-");
}

function normalizeFramedataRow(row) {
  const source = row && typeof row === "object" ? row : {};
  return {
    section: normalizeFramedataText(source.section),
    officialId: normalizeFramedataText(source.officialId),
    moveName: normalizeFramedataText(source.moveName, "-"),
    moveNameJa: normalizeFramedataText(source.moveNameJa),
    command: normalizeFramedataText(source.command),
    commandModern: normalizeFramedataText(source.commandModern),
    startup: normalizeFramedataText(source.startup, "-"),
    active: normalizeFramedataText(source.active, "-"),
    recovery: normalizeFramedataText(source.recovery, "-"),
    onHit: normalizeFramedataText(source.onHit, "-"),
    onBlock: normalizeFramedataText(source.onBlock, "-"),
    cancel: normalizeFramedataText(source.cancel, "-"),
    damage: normalizeFramedataText(source.damage, "-"),
    property: normalizeFramedataText(source.property, "-"),
    notes: normalizeFramedataNotes(source.notes)
  };
}

function mergeFramedataDataset(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const rowsByCharacter = source.rows && typeof source.rows === "object" ? source.rows : {};
  const labelsByCharacter = source.labels && typeof source.labels === "object" ? source.labels : {};
  const listedCharacters = Array.isArray(source.characters) ? source.characters : [];

  const keys = Array.from(new Set([
    ...Object.keys(rowsByCharacter),
    ...Object.keys(labelsByCharacter),
    ...listedCharacters
  ]))
    .map((key) => String(key || "").trim().toLowerCase())
    .filter((key) => key);

  clearObject(FRAMEDATA_SOURCE);
  clearObject(FRAMEDATA_CHAR_LABELS);
  clearObject(FRAMEDATA_LOCAL_ROWS);
  state.framedataCache = {};

  keys.forEach((key) => {
    const rawRows = Array.isArray(rowsByCharacter[key]) ? rowsByCharacter[key] : [];
    FRAMEDATA_LOCAL_ROWS[key] = rawRows.map((row) => normalizeFramedataRow(row));
    FRAMEDATA_SOURCE[`character/frame/${key}`] = {};

    const rawLabel = labelsByCharacter[key];
    FRAMEDATA_CHAR_LABELS[key] = getFramedataCharacterLabel(key, rawLabel);
  });

  state.framedataDatasetUpdatedAt = typeof source.generatedAt === "string" ? source.generatedAt : "";
  return keys.length;
}

async function ensureFramedataDatasetLoaded() {
  if (state.framedataDatasetLoaded || state.framedataDatasetLoading) {
    return;
  }

  state.framedataDatasetLoading = true;
  state.framedataDatasetError = "";

  try {
    const response = await fetch(FRAMEDATA_DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const count = mergeFramedataDataset(payload);
    state.framedataDatasetLoaded = count > 0;
    if (!state.framedataDatasetLoaded) {
      state.framedataDatasetError = "\u672c\u5730\u5e27\u6570\u5e93\u4e3a\u7a7a";
    }
  } catch (error) {
    state.framedataDatasetLoaded = false;
    state.framedataDatasetError = error && error.message ? error.message : "\u8bfb\u53d6\u5931\u8d25";
  } finally {
    state.framedataDatasetLoading = false;
  }
}

function getFramedataCharacterKey(path) {
  const text = String(path || "").trim();
  if (!text) {
    return "";
  }
  const parts = text.split("/");
  return String(parts[parts.length - 1] || "").toLowerCase();
}

function buildFramedataCharacterOptions() {
  const keySet = new Set();
  Object.keys(FRAMEDATA_LOCAL_ROWS || {}).forEach((key) => keySet.add(String(key || "").toLowerCase()));
  Object.keys(FRAMEDATA_SOURCE || {}).forEach((path) => {
    const key = getFramedataCharacterKey(path);
    if (key) {
      keySet.add(key);
    }
  });

  return Array.from(keySet)
    .map((key) => {
      const path = Object.keys(FRAMEDATA_SOURCE).find((item) => getFramedataCharacterKey(item) === key)
        || `character/frame/${key}`;
      const moves = FRAMEDATA_SOURCE[path] || {};
      const localRows = Array.isArray(FRAMEDATA_LOCAL_ROWS && FRAMEDATA_LOCAL_ROWS[key])
        ? FRAMEDATA_LOCAL_ROWS[key]
        : [];
      const moveCount = localRows.length || Object.keys(moves || {}).length;
      return {
        key,
        label: getFramedataCharacterLabel(key, FRAMEDATA_CHAR_LABELS[key]),
        count: moveCount,
        path,
        moves
      };
    })
    .filter((item) => item.key)
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

function cleanupFramedataMoveName(name) {
  return String(name || "")
    .replace(/^\[t\]/, "")
    .trim();
}

function buildFallbackFramedataRows(moves) {
  return Object.entries(moves || {}).map(([jpName, enName]) => ({
    section: "",
    moveName: enName || cleanupFramedataMoveName(jpName),
    moveNameJa: cleanupFramedataMoveName(jpName),
    command: "",
    commandModern: "",
    startup: "-",
    active: "-",
    recovery: "-",
    onHit: "-",
    onBlock: "-",
    cancel: "-",
    damage: "-",
    property: "-",
    notes: cleanupFramedataMoveName(jpName)
  }));
}

function getFramedataModeAvailability(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const hasModeData = list.some((row) => row.command || row.commandModern);
  return {
    hasModeData,
    hasClassic: hasModeData && list.some((row) => row.command),
    hasModern: hasModeData && list.some((row) => row.commandModern)
  };
}

function getFramedataRowsForMode(rows, mode) {
  const list = Array.isArray(rows) ? rows : [];
  const availability = getFramedataModeAvailability(list);
  if (!availability.hasModeData) {
    return list;
  }
  if (mode === "modern") {
    return list.filter((row) => row.commandModern);
  }
  return availability.hasClassic ? list.filter((row) => row.command) : list;
}

function getFramedataCommandForMode(row, mode) {
  if (!row || typeof row !== "object") {
    return "";
  }
  return mode === "modern"
    ? normalizeFramedataText(row.commandModern)
    : normalizeFramedataText(row.command);
}

function toFramedataDisplayRows(rows, mode) {
  const displayRows = [];
  let currentSection = "";
  (Array.isArray(rows) ? rows : []).forEach((row, idx) => {
    const nextSection = row && row.section ? String(row.section) : "";
    if (nextSection && nextSection !== currentSection) {
      currentSection = nextSection;
      displayRows.push([{ type: "section", title: nextSection }]);
    }
    displayRows.push([
      idx + 1,
      {
        type: "move",
        moveName: row.moveName || "-",
        moveNameJa: row.moveNameJa || "",
        command: getFramedataCommandForMode(row, mode)
      },
      row.startup || "-",
      row.active || "-",
      row.recovery || "-",
      row.onHit || "-",
      row.onBlock || "-",
      row.damage || "-",
      row.property || "-"
    ]);
  });
  return displayRows;
}

function ensureFramedataLoaded(characterKey) {
  if (!characterKey) {
    return;
  }
  if (state.framedataCache[characterKey]) {
    return;
  }

  const localRows = Array.isArray(FRAMEDATA_LOCAL_ROWS && FRAMEDATA_LOCAL_ROWS[characterKey])
    ? FRAMEDATA_LOCAL_ROWS[characterKey]
    : [];
  const cacheEntry = {
    url: "local",
    rows: localRows,
    error: localRows.length ? "" : "\u672c\u5730\u65e0\u5e27\u6570\u6570\u636e",
    fetchedAt: "local",
    overrideLoading: false,
    overrideLoaded: false,
    overrideError: ""
  };
  state.framedataCache[characterKey] = cacheEntry;

  const overrideUrl = FRAMEDATA_OVERRIDE_URLS[characterKey];
  if (!overrideUrl) {
    return;
  }

  cacheEntry.overrideLoading = true;
  fetch(overrideUrl, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      const overrideRows = Array.isArray(payload && payload.rows)
        ? payload.rows.map((row) => normalizeFramedataRow(row))
        : [];
      if (!overrideRows.length) {
        throw new Error("\u8986\u76d6\u6570\u636e\u4e3a\u7a7a");
      }
      FRAMEDATA_LOCAL_ROWS[characterKey] = overrideRows;
      if (payload && payload.label) {
        FRAMEDATA_CHAR_LABELS[characterKey] = getFramedataCharacterLabel(characterKey, payload.label);
      }
      cacheEntry.url = overrideUrl;
      cacheEntry.rows = overrideRows;
      cacheEntry.error = "";
      cacheEntry.fetchedAt = payload && payload.generatedAt ? String(payload.generatedAt) : "local";
      cacheEntry.overrideLoading = false;
      cacheEntry.overrideLoaded = true;
      cacheEntry.overrideError = "";
      if (state.currentView === "framedata" && state.framedataCharacter === characterKey) {
        renderFramedata();
      }
    })
    .catch((error) => {
      cacheEntry.overrideLoading = false;
      cacheEntry.overrideLoaded = false;
      cacheEntry.overrideError = error && error.message ? error.message : "\u8bfb\u53d6\u5931\u8d25";
      if (state.currentView === "framedata" && state.framedataCharacter === characterKey) {
        renderFramedata();
      }
    });
}

function renderFramedataCharacterSidebar(options) {
  refs.characterList.innerHTML = "";
  if (!options.length) {
    const p = document.createElement("p");
    p.className = "character-empty";
    p.textContent = "\u6682\u65e0\u89d2\u8272\u5e27\u6570\u6570\u636e";
    refs.characterList.appendChild(p);
    return;
  }

  if (!options.some((o) => o.key === state.framedataCharacter)) {
    state.framedataCharacter = options[0].key;
  }

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = `character-btn${opt.key === state.framedataCharacter ? " active" : ""}`;
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      state.framedataCharacter = opt.key;
      renderFramedata();
    });
    refs.characterList.appendChild(btn);
  });
}

const FRAMEDATA_DIRECTION_ICON_MAP = {
  1: "key-dl.png",
  2: "key-d.png",
  3: "key-dr.png",
  4: "key-l.png",
  5: "key-nutral.png",
  6: "key-r.png",
  7: "key-ul.png",
  8: "key-u.png",
  9: "key-ur.png",
  N: "key-nutral.png"
};

const FRAMEDATA_BUTTON_ICON_MAP = {
  LP: "icon_punch_l.png",
  MP: "icon_punch_m.png",
  HP: "icon_punch_h.png",
  LK: "icon_kick_l.png",
  MK: "icon_kick_m.png",
  HK: "icon_kick_h.png",
  AUTO: "modern_auto.png",
  SP: "modern_sp.png",
  DI: "modern_dl.png",
  DP: "modern_dp.png",
  [FD_WEAK]: "modern_l.png",
  [FD_MEDIUM]: "modern_m.png",
  [FD_HEAVY]: "modern_h.png",
  [FD_ATTACK]: "key-all.png",
  [FD_THROW]: "icon_throw.png"
};

function buildFramedataIconUrl(fileName) {
  return `${FRAMEDATA_ICON_BASE_URL}/${fileName}`;
}

function appendFramedataCommandText(container, text) {
  const span = document.createElement("span");
  span.className = "framedata-command-text";
  span.textContent = text;
  container.appendChild(span);
}

function appendFramedataCommandIcon(container, fileName, altText) {
  const img = document.createElement("img");
  img.className = "framedata-command-icon";
  img.src = buildFramedataIconUrl(fileName);
  img.alt = altText || "";
  img.title = altText || "";
  container.appendChild(img);
}

function appendFramedataCommandIcons(container, tokens) {
  tokens.forEach((token) => {
    if (!token) {
      return;
    }
    appendFramedataCommandIcon(container, token.fileName, token.altText);
  });
}

function normalizeFramedataCommandText(text) {
  const strengthPattern = new RegExp(`(${escapeFramedataRegexText(FD_WEAK)}|${escapeFramedataRegexText(FD_MEDIUM)}|${escapeFramedataRegexText(FD_HEAVY)})SP`, "g");
  const spStrengthPattern = new RegExp(`SP(${escapeFramedataRegexText(FD_WEAK)}|${escapeFramedataRegexText(FD_MEDIUM)}|${escapeFramedataRegexText(FD_HEAVY)})`, "g");
  return String(text || "")
    .replace(/\uFF0B/g, "+")
    .replace(/\uFF1E/g, ">")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")")
    .replace(strengthPattern, "$1 SP")
    .replace(spStrengthPattern, "SP $1")
    .replace(/5656\s*\+\s*6/g, "66")
    .replace(/5454\s*\+\s*4/g, "44")
    .replace(/21424\s*\|\s*24214|21425\s*\|\s*24214|21426\s*\|\s*24214/g, "214214")
    .replace(/23626\s*\|\s*26236/g, "236236")
    .replace(/\|/g, " | ")
    .replace(/([+>/()])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFramedataCommandTokens(text) {
  const normalized = normalizeFramedataCommandText(text);
  if (!normalized) {
    return [];
  }
  const tokenPattern = new RegExp(
    `AUTO|DI|DP|SP|LPMPHP|LKMKHK|LPLK|HPHK|MPMK|LP|MP|HP|LK|MK|HK|${escapeFramedataRegexText(FD_ATTACK_TWO)}|${escapeFramedataRegexText(FD_ATTACK)}|${escapeFramedataRegexText(FD_THROW)}|${escapeFramedataRegexText(FD_WEAK)}|${escapeFramedataRegexText(FD_MEDIUM)}|${escapeFramedataRegexText(FD_HEAVY)}|or|[1-9N]|[+>/|()]|[^ ]+`,
    "g"
  );
  return normalized.match(tokenPattern) || [];
}

function appendFramedataCommandToken(container, token) {
  switch (token) {
    case "LPMPHP":
      appendFramedataCommandIcons(container, [
        { fileName: "icon_punch.png", altText: "PPP" },
        { fileName: "icon_punch.png", altText: "PPP" }
      ]);
      return;
    case "LKMKHK":
      appendFramedataCommandIcons(container, [
        { fileName: "icon_kick.png", altText: "KKK" },
        { fileName: "icon_kick.png", altText: "KKK" }
      ]);
      return;
    case "LPLK":
      appendFramedataCommandIcons(container, [
        { fileName: "icon_punch_l.png", altText: "LP" },
        { fileName: "icon_kick_l.png", altText: "LK" }
      ]);
      return;
    case "MPMK":
      appendFramedataCommandIcons(container, [
        { fileName: "icon_punch_m.png", altText: "MP" },
        { fileName: "icon_kick_m.png", altText: "MK" }
      ]);
      return;
    case "HPHK":
      appendFramedataCommandIcons(container, [
        { fileName: "icon_punch_h.png", altText: "HP" },
        { fileName: "icon_kick_h.png", altText: "HK" }
      ]);
      return;
    case FD_ATTACK_TWO:
      appendFramedataCommandIcons(container, [
        { fileName: "key-all.png", altText: FD_ATTACK },
        { fileName: "key-all.png", altText: FD_ATTACK }
      ]);
      return;
    case "+":
      appendFramedataCommandIcon(container, "key-plus.png", "+");
      return;
    case ">":
      appendFramedataCommandIcon(container, "arrow_3.png", ">");
      return;
    case "or":
      appendFramedataCommandIcon(container, "key-or.png", "or");
      return;
    case "|":
    case "/":
    case "(":
    case ")":
      appendFramedataCommandText(container, token);
      return;
    default:
      break;
  }

  if (FRAMEDATA_DIRECTION_ICON_MAP[token]) {
    appendFramedataCommandIcon(container, FRAMEDATA_DIRECTION_ICON_MAP[token], token);
    return;
  }
  if (FRAMEDATA_BUTTON_ICON_MAP[token]) {
    appendFramedataCommandIcon(container, FRAMEDATA_BUTTON_ICON_MAP[token], token);
    return;
  }
  appendFramedataCommandText(container, token);
}

function renderFramedataMoveCell(td, cell) {
  const wrapper = document.createElement("div");
  wrapper.className = "framedata-move-cell";

  const title = document.createElement("div");
  title.className = "framedata-move-title";
  title.textContent = cell.moveName || "-";
  if (cell.moveNameJa) {
    title.title = cell.moveNameJa;
  }
  wrapper.appendChild(title);

  const commandLine = document.createElement("div");
  commandLine.className = "framedata-command-line";
  const tokens = buildFramedataCommandTokens(cell.command);
  if (!tokens.length) {
    commandLine.classList.add("is-empty");
    commandLine.textContent = "-";
  } else {
    tokens.forEach((token) => appendFramedataCommandToken(commandLine, token));
  }
  wrapper.appendChild(commandLine);

  td.appendChild(wrapper);
}

function renderFramedataTable(headers, rows) {
  refs.framedataHeadRow.innerHTML = "";
  headers.forEach((title) => {
    const th = document.createElement("th");
    th.textContent = title;
    refs.framedataHeadRow.appendChild(th);
  });

  refs.framedataBody.innerHTML = "";
  rows.forEach((row) => {
    if (row && row.length === 1 && row[0] && row[0].type === "section") {
      const tr = document.createElement("tr");
      tr.className = "framedata-section-row";
      const td = document.createElement("td");
      td.colSpan = headers.length;
      td.textContent = row[0].title || "-";
      tr.appendChild(td);
      refs.framedataBody.appendChild(tr);
      return;
    }
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      if (cell && typeof cell === "object" && cell.type === "move") {
        renderFramedataMoveCell(td, cell);
      } else {
        td.textContent = String(cell == null ? "-" : cell);
      }
      tr.appendChild(td);
    });
    refs.framedataBody.appendChild(tr);
  });
}

function renderFramedataModeSwitch(availability) {
  const hasSwitch = availability.hasClassic && availability.hasModern;
  if (refs.framedataModeWrap) {
    refs.framedataModeWrap.classList.toggle("is-hidden", !hasSwitch);
  }
  if (refs.framedataModeClassicBtn) {
    refs.framedataModeClassicBtn.classList.toggle("active", state.framedataMode === "classic");
  }
  if (refs.framedataModeModernBtn) {
    refs.framedataModeModernBtn.classList.toggle("active", state.framedataMode === "modern");
  }
}

function renderFramedata() {
  if (!state.framedataDatasetLoaded && !state.framedataDatasetLoading) {
    ensureFramedataDatasetLoaded().finally(() => {
      if (state.currentView === "framedata") {
        renderFramedata();
      }
    });
  }

  const options = buildFramedataCharacterOptions();
  renderFramedataCharacterSidebar(options);

  const current = options.find((item) => item.key === state.framedataCharacter) || options[0];
  if (!current) {
    renderFramedataModeSwitch({ hasClassic: false, hasModern: false });
    if (refs.framedataTitle) {
      refs.framedataTitle.textContent = "\u5e27\u6570\u8868";
    }
    if (refs.framedataHint) {
      if (state.framedataDatasetLoading) {
        refs.framedataHint.textContent = "\u6b63\u5728\u52a0\u8f7d\u672c\u5730\u5e27\u6570\u5e93...";
      } else if (state.framedataDatasetError) {
        refs.framedataHint.textContent = `\u672c\u5730\u5e27\u6570\u5e93\u52a0\u8f7d\u5931\u8d25\uff08${state.framedataDatasetError}\uff09`;
      } else {
        refs.framedataHint.textContent = "\u6682\u65e0\u5e27\u6570\u6570\u636e";
      }
    }
    if (refs.framedataStats) {
      setPills(refs.framedataStats, []);
    }
    renderFramedataTable(
      ["#", "\u62db\u5f0f", "\u53d1\u751f", "\u6301\u7eed", "\u786c\u76f4", "\u547d\u4e2d", "\u9632\u5fa1", "\u4f24\u5bb3", "\u5c5e\u6027"],
      [["-", "-", "-", "-", "-", "-", "-", "-", "-"]]
    );
    return;
  }

  ensureFramedataLoaded(current.key);

  const cache = state.framedataCache[current.key] || null;
  const sourceRows = cache && Array.isArray(cache.rows) ? cache.rows : [];
  const hasRemoteRows = sourceRows.length > 0;
  const availability = getFramedataModeAvailability(sourceRows);

  if (availability.hasModern && !availability.hasClassic) {
    state.framedataMode = "modern";
  } else if (state.framedataMode === "modern" && !availability.hasModern) {
    state.framedataMode = "classic";
  }

  renderFramedataModeSwitch(availability);

  const filteredRows = hasRemoteRows
    ? getFramedataRowsForMode(sourceRows, state.framedataMode)
    : getFramedataRowsForMode(buildFallbackFramedataRows(current.moves), state.framedataMode);
  const displayRows = toFramedataDisplayRows(filteredRows, state.framedataMode);

  if (refs.framedataTitle) {
    refs.framedataTitle.textContent = `${current.label} \u5e27\u6570\u8868`;
  }
  if (refs.framedataHint) {
    if (cache && cache.overrideLoading) {
      refs.framedataHint.textContent = "\u6b63\u5728\u52a0\u8f7d C.Viper \u5b98\u65b9\u7ecf\u5178 / \u73b0\u4ee3\u6307\u4ee4\u6570\u636e...";
    } else if (cache && cache.overrideLoaded) {
      refs.framedataHint.textContent = "\u6570\u636e\u6765\u6e90\uff1a\u672c\u5730\u56fa\u5316\u6570\u636e\uff08\u79bb\u7ebf\uff09\uff0c\u5e76\u53e0\u52a0\u5b98\u65b9 C.Viper \u7ecf\u5178 / \u73b0\u4ee3\u6a21\u5f0f\u4e0e\u6307\u4ee4";
    } else if (cache && cache.overrideError) {
      refs.framedataHint.textContent = `\u5b98\u65b9 C.Viper \u6307\u4ee4\u8986\u76d6\u52a0\u8f7d\u5931\u8d25\uff08${cache.overrideError}\uff09\uff0c\u5f53\u524d\u663e\u793a\u672c\u5730\u57fa\u7840\u5e27\u6570`;
    } else if (hasRemoteRows) {
      const updatedAtText = state.framedataDatasetUpdatedAt
        ? `\uff0c\u66f4\u65b0\u4e8e ${formatDate(state.framedataDatasetUpdatedAt)}`
        : "";
      refs.framedataHint.textContent = `\u6570\u636e\u6765\u6e90\uff1a\u672c\u5730\u56fa\u5316\u6570\u636e\uff08\u79bb\u7ebf\uff09${updatedAtText}`;
    } else if (state.framedataDatasetLoading) {
      refs.framedataHint.textContent = "\u6b63\u5728\u52a0\u8f7d\u672c\u5730\u5e27\u6570\u5e93...";
    } else if (state.framedataDatasetError) {
      refs.framedataHint.textContent = `\u672c\u5730\u5e27\u6570\u5e93\u52a0\u8f7d\u5931\u8d25\uff08${state.framedataDatasetError}\uff09`;
    } else if (cache && cache.error) {
      refs.framedataHint.textContent = `\u672c\u5730\u5e27\u6570\u7f3a\u5931\uff08${cache.error}\uff09\uff0c\u5f53\u524d\u663e\u793a\u62db\u5f0f\u540d\u79f0\u5217\u8868`;
    } else {
      refs.framedataHint.textContent = "\u6682\u65e0\u672c\u5730\u5e27\u6570\u6570\u636e\uff0c\u5f53\u524d\u663e\u793a\u62db\u5f0f\u540d\u79f0\u5217\u8868";
    }
  }
  if (refs.framedataStats) {
    const pills = [
      `\u89d2\u8272\uff1a${current.label}`,
      `\u62db\u5f0f\u6570\uff1a${filteredRows.length}`,
      hasRemoteRows ? "\u5e27\u6570\uff1a\u5df2\u52a0\u8f7d" : "\u5e27\u6570\uff1a\u672a\u52a0\u8f7d"
    ];
    if (availability.hasModeData) {
      pills.splice(2, 0, `\u6a21\u5f0f\uff1a${state.framedataMode === "modern" ? "\u73b0\u4ee3" : "\u7ecf\u5178"}`);
    }
    setPills(refs.framedataStats, pills);
  }
  renderFramedataTable(
    ["#", "\u62db\u5f0f", "\u53d1\u751f", "\u6301\u7eed", "\u786c\u76f4", "\u547d\u4e2d", "\u9632\u5fa1", "\u4f24\u5bb3", "\u5c5e\u6027"],
    displayRows.length ? displayRows : [["-", "-", "-", "-", "-", "-", "-", "-", "-"]]
  );
}
