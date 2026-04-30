function getChartRangeDays(range = state.rangeDays) {
  const value = String(range == null ? "0" : range);
  if (value === "recent100") {
    return 0;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isRecentMatchRange(range = state.rangeDays) {
  return String(range || "") === "recent100";
}

function getChartRangeLabel(range = state.rangeDays) {
  if (isRecentMatchRange(range)) {
    return "最近100场";
  }
  const days = getChartRangeDays(range);
  return days > 0 ? `${days}天` : "全部";
}

function sortMatchesByTime(matches) {
  return (Array.isArray(matches) ? matches : [])
    .slice()
    .sort((a, b) => String(a.playedAt || "").localeCompare(String(b.playedAt || "")));
}

function filterMatchesForChartRange(matches, range = state.rangeDays) {
  const sorted = sortMatchesByTime(matches);
  if (isRecentMatchRange(range)) {
    return sorted.slice(-100);
  }
  const days = getChartRangeDays(range);
  return filterMatchesByDays(sorted, days);
}

function toDayKey(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dayKey) {
  if (!dayKey) {
    return "-";
  }
  return dayKey.slice(5).replace("-", "/");
}

function getChartRangeBounds(list, days) {
  const validTimes = list
    .map((item) => new Date(item.playedAt || "").getTime())
    .filter((time) => Number.isFinite(time));
  if (!validTimes.length) {
    return null;
  }

  if (days && days > 0) {
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (days - 1));
    return { start: startDate, end: endDate };
  }

  const start = new Date(Math.min(...validTimes));
  start.setHours(0, 0, 0, 0);
  const end = new Date(Math.max(...validTimes));
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

function buildDailyScoreSlots(matches, days, metric = state.metric) {
  const rows = Array.isArray(matches) ? matches : [];
  const bounds = getChartRangeBounds(rows, days);
  if (!bounds) {
    return [];
  }

  const map = new Map();
  rows.forEach((match) => {
    const time = new Date(match.playedAt || "").getTime();
    if (!Number.isFinite(time)) {
      return;
    }
    const key = toDayKey(time);
    if (!key) {
      return;
    }
    const value = getMetricValueForMetric(match, metric);
    if (value === null) {
      return;
    }
    const current = map.get(key) || {
      key,
      date: new Date(key),
      matches: [],
      latestMatch: null,
      score: null,
      deltaTotal: 0
    };
    current.matches.push(match);
    current.deltaTotal += getMetricDeltaForMetric(match, metric) || 0;
    if (!current.latestMatch || String(match.playedAt || "") > String(current.latestMatch.playedAt || "")) {
      current.latestMatch = match;
      current.score = value;
    }
    map.set(key, current);
  });

  const slots = [];
  const cursor = new Date(bounds.start);
  while (cursor.getTime() <= bounds.end.getTime()) {
    const key = toDayKey(cursor);
    const item = map.get(key) || null;
    slots.push({
      key,
      label: formatDayLabel(key),
      date: new Date(cursor),
      value: item ? item.score : null,
      delta: item ? item.deltaTotal : null,
      match: item ? item.latestMatch : null,
      battleCount: item ? item.matches.length : 0
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

function findLatestMetricSnapshotBefore(matches, startDate, metric = state.metric) {
  const rows = Array.isArray(matches) ? matches : [];
  const startTime = startDate instanceof Date ? startDate.getTime() : NaN;
  if (!Number.isFinite(startTime)) {
    return null;
  }

  let latest = null;
  rows.forEach((match) => {
    const time = new Date(match.playedAt || "").getTime();
    if (!Number.isFinite(time) || time >= startTime) {
      return;
    }
    const value = getMetricValueForMetric(match, metric);
    if (value === null) {
      return;
    }
    if (!latest || time > latest.time) {
      latest = { time, value, match };
    }
  });
  return latest;
}

function buildCarryOverScoreSlots(matches, days, metric = state.metric) {
  if (!days || days <= 0) {
    return [];
  }

  const rows = Array.isArray(matches) ? matches : [];
  const bounds = getChartRangeBounds(rows, days);
  if (!bounds) {
    return [];
  }

  const snapshot = findLatestMetricSnapshotBefore(rows, bounds.start, metric);
  if (!snapshot) {
    return [];
  }

  const sourceKey = toDayKey(snapshot.time);
  const slots = [];
  const cursor = new Date(bounds.start);
  while (cursor.getTime() <= bounds.end.getTime()) {
    const key = toDayKey(cursor);
    slots.push({
      key,
      label: formatDayLabel(key),
      date: new Date(cursor),
      value: snapshot.value,
      delta: null,
      match: snapshot.match,
      battleCount: 0,
      isCarryOver: true,
      carrySourceKey: sourceKey
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

function buildContinuousDailyScoreSlots(matches, days, metric = state.metric) {
  const baseSlots = buildDailyScoreSlots(matches, days, metric);
  if (!baseSlots.length) {
    return [];
  }

  const seed = findLatestMetricSnapshotBefore(matches, baseSlots[0].date, metric);
  let lastValue = seed ? seed.value : null;
  let lastMatch = seed ? seed.match : null;
  let lastSourceKey = seed ? toDayKey(seed.time) : "";

  const continuous = baseSlots.map((slot) => {
    if (typeof slot.value === "number") {
      lastValue = slot.value;
      lastMatch = slot.match || lastMatch;
      lastSourceKey = slot.key;
      return {
        ...slot,
        isSynthetic: false
      };
    }

    if (lastValue === null) {
      return {
        ...slot,
        isSynthetic: true
      };
    }

    return {
      ...slot,
      value: lastValue,
      delta: null,
      match: lastMatch,
      battleCount: 0,
      isSynthetic: true,
      carrySourceKey: lastSourceKey
    };
  });

  let prevValue = null;
  continuous.forEach((slot) => {
    if (typeof slot.value !== "number") {
      slot.pointDelta = null;
      return;
    }
    slot.pointDelta = prevValue === null ? null : slot.value - prevValue;
    prevValue = slot.value;
  });

  return continuous;
}

function buildCharacterTrendSlots(matches, days, focusCharacter) {
  const rows = Array.isArray(matches) ? matches : [];
  const bounds = getChartRangeBounds(rows, days);
  if (!bounds) {
    return [];
  }

  const map = new Map();
  rows.forEach((match) => {
    const time = new Date(match.playedAt || "").getTime();
    if (!Number.isFinite(time)) {
      return;
    }
    const key = toDayKey(time);
    const current = map.get(key) || {
      key,
      totalCount: 0,
      focusCount: 0,
      latestMatch: null
    };
    current.totalCount += 1;
    if (String(match.myCharacter || "") === focusCharacter) {
      current.focusCount += 1;
    }
    if (!current.latestMatch || String(match.playedAt || "") > String(current.latestMatch.playedAt || "")) {
      current.latestMatch = match;
    }
    map.set(key, current);
  });

  const slots = [];
  const cursor = new Date(bounds.start);
  while (cursor.getTime() <= bounds.end.getTime()) {
    const key = toDayKey(cursor);
    const item = map.get(key) || null;
    slots.push({
      key,
      label: formatDayLabel(key),
      date: new Date(cursor),
      value: item ? item.focusCount : null,
      totalCount: item ? item.totalCount : 0,
      match: item ? item.latestMatch : null
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

function buildIndividualMatchScoreSlot(match, metric, index) {
  const value = getMetricValueForMetric(match, metric);
  if (value === null) {
    return null;
  }
  const beforeValue = getMetricBeforeValueForMetric(match, metric);
  const delta = getMetricDeltaForMetric(match, metric);
  const dateText = formatDate(match.playedAt);
  const resultText = match.result === "win" ? "胜" : match.result === "loss" ? "负" : match.result === "draw" ? "平" : "-";
  return {
    key: `${dateText}-${index + 1}`,
    label: "",
    date: new Date(match.playedAt || ""),
    value,
    delta,
    pointDelta: delta,
    match,
    battleCount: 1,
    matchIndex: index + 1,
    tooltipLines: [
      `${metric === "mr" ? "MR" : "LP"}：${formatInt(value)}（赛后）`,
      `赛前分数：${formatInt(beforeValue)}`,
      `加减分：${formatDelta(delta)}`,
      `时间：${dateText}`,
      `结果：${resultText} / ${match.mode || "-"}`,
      `对局：${String(match.myCharacter || "-")} vs ${String(match.opponentCharacter || "-")}`,
      `对手：${String(match.opponentName || "-")}`
    ]
  };
}

function buildAggregatedMatchScoreSlots(rows, metric, maxPoints = 120) {
  const slots = [];
  const bucketSize = Math.ceil(rows.length / maxPoints);
  for (let index = 0; index < rows.length; index += bucketSize) {
    const bucket = rows.slice(index, index + bucketSize);
    const lastMatch = bucket[bucket.length - 1];
    const value = getMetricValueForMetric(lastMatch, metric);
    if (value === null) {
      continue;
    }
    const delta = bucket.reduce((acc, match) => acc + (getMetricDeltaForMetric(match, metric) || 0), 0);
    const firstMatch = bucket[0];
    const startText = formatDate(firstMatch && firstMatch.playedAt);
    const endText = formatDate(lastMatch && lastMatch.playedAt);
    slots.push({
      key: `${startText}-${endText}-${slots.length + 1}`,
      label: "",
      date: new Date(lastMatch.playedAt || ""),
      value,
      delta,
      pointDelta: delta,
      match: lastMatch,
      battleCount: bucket.length,
      isAggregated: true,
      tooltipLines: [
        `${metric === "mr" ? "MR" : "LP"}：${formatInt(value)}（桶内最后一场赛后）`,
        `区间：${startText} ~ ${endText}`,
        `区间场次：${formatInt(bucket.length)}`,
        `区间净变化：${formatDelta(delta)}`,
        `最后对局：${String(lastMatch.myCharacter || "-")} vs ${String(lastMatch.opponentCharacter || "-")}`,
        `对手：${String(lastMatch.opponentName || "-")}`
      ]
    });
  }
  return slots;
}

function buildMatchScoreSlots(matches, range = state.rangeDays, metric = state.metric) {
  const rows = filterMatchesForChartRange(matches, range)
    .filter((match) => getMetricValueForMetric(match, metric) !== null);

  if (!isRecentMatchRange(range) && getChartRangeDays(range) <= 0 && rows.length > 120) {
    return buildAggregatedMatchScoreSlots(rows, metric, 120);
  }

  return rows
    .map((match, index) => buildIndividualMatchScoreSlot(match, metric, index))
    .filter(Boolean);
}

function renderChartAxis(slots, visible) {
  if (!refs.chartAxis) {
    return;
  }

  refs.chartAxis.innerHTML = "";
  refs.chartAxis.classList.toggle("is-visible", Boolean(visible && Array.isArray(slots) && slots.length));
  if (!visible || !Array.isArray(slots) || !slots.length) {
    return;
  }

  refs.chartAxis.style.gridTemplateColumns = `repeat(${slots.length}, minmax(0, 1fr))`;
  slots.forEach((slot) => {
    const item = document.createElement("div");
    item.className = "chart-axis-item";

    const tick = document.createElement("span");
    tick.className = "chart-axis-tick";

    const label = document.createElement("span");
    label.className = "chart-axis-label";
    label.textContent = slot.key ? slot.key.slice(5) : slot.label || "-";

    item.appendChild(tick);
    item.appendChild(label);
    refs.chartAxis.appendChild(item);
  });
}

function drawChart(slots, metric = state.metric, options = {}) {
  const showXAxisLabels = options.showXAxisLabels !== false;
  const showPointLabels = options.showPointLabels !== false;
  const points = Array.isArray(slots) ? slots : [];
  const valid = points.filter((item) => typeof item.value === "number");
  const canvas = refs.scoreChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(360, refs.chartWrap.clientWidth - 40);
  const height = Math.max(280, refs.chartWrap.clientHeight - 40);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (!valid.length) {
    return [];
  }

  const pad = { left: 62, right: 22, top: 26, bottom: showXAxisLabels ? 18 : 32 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = valid.map((item) => item.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePad = Math.max(1, Math.round((maxValue - minValue) * 0.08));
  const low = minValue - valuePad;
  const high = maxValue + valuePad;
  const span = Math.max(1, high - low);
  const lineColor = metric === "mr" ? "#2dd4bf" : "#f97316";
  const carryColor = metric === "mr" ? "rgba(45, 212, 191, 0.42)" : "rgba(249, 115, 22, 0.42)";

  ctx.strokeStyle = "rgba(204, 251, 241, 0.12)";
  ctx.fillStyle = "rgba(204, 251, 241, 0.68)";
  ctx.font = '12px "Segoe UI"';
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotHeight * i) / 4;
    const value = high - (span * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(Math.round(value).toLocaleString("zh-CN"), 8, y + 4);
  }

  const plotted = points.map((item, index) => {
    const x = pad.left + (plotWidth * index) / Math.max(1, points.length - 1);
    const y = typeof item.value === "number"
      ? pad.top + ((high - item.value) / span) * plotHeight
      : null;
    return { ...item, x, y };
  });

  ctx.setLineDash([2, 10]);
  ctx.strokeStyle = "rgba(204, 251, 241, 0.06)";
  plotted.forEach((point) => {
    ctx.beginPath();
    ctx.moveTo(point.x, pad.top);
    ctx.lineTo(point.x, height - pad.bottom);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  if (showXAxisLabels) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(204, 251, 241, 0.14)";
    ctx.lineWidth = 1;
    ctx.moveTo(pad.left, height - pad.bottom);
    ctx.lineTo(width - pad.right, height - pad.bottom);
    ctx.stroke();
  }

  const actual = plotted.filter((point) => typeof point.y === "number");
  for (let index = 1; index < actual.length; index += 1) {
    const prev = actual[index - 1];
    const current = actual[index];
    const syntheticSegment = Boolean(prev.isSynthetic || current.isSynthetic || prev.isCarryOver || current.isCarryOver);
    const horizontalSegment = Math.abs(prev.y - current.y) < 0.5;
    const dashedCarry = syntheticSegment && horizontalSegment;
    ctx.beginPath();
    ctx.strokeStyle = dashedCarry ? carryColor : lineColor;
    ctx.lineWidth = dashedCarry ? 2 : 3;
    ctx.setLineDash(dashedCarry ? [10, 8] : []);
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.font = '11px "Segoe UI"';
  actual.forEach((point) => {
    if (showPointLabels && !point.isSynthetic && !point.isCarryOver) {
      ctx.fillStyle = point.pointDelta > 0 ? "#86efac" : point.pointDelta < 0 ? "#fca5a5" : "#cbd5e1";
      const deltaText = point.pointDelta == null ? "" : formatDelta(point.pointDelta);
      if (deltaText && deltaText !== "-") {
        const textWidth = ctx.measureText(deltaText).width;
        ctx.fillText(deltaText, point.x - textWidth / 2, point.y - 12);
      }
    }

    const passivePoint = Boolean(point.isSynthetic || point.isCarryOver);
    ctx.fillStyle = passivePoint ? "rgba(7, 18, 28, 0.92)" : lineColor;
    ctx.beginPath();
    ctx.arc(point.x, point.y, passivePoint ? 3 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = passivePoint ? carryColor : "#07121c";
    ctx.lineWidth = passivePoint ? 1.5 : 2;
    ctx.stroke();
  });

  if (showXAxisLabels) {
    ctx.strokeStyle = "rgba(204, 251, 241, 0.18)";
    ctx.lineWidth = 1;
    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.moveTo(point.x, height - pad.bottom);
      ctx.lineTo(point.x, height - pad.bottom + 6);
      ctx.stroke();
    });
  }

  return actual.map((point) => ({
    ...point,
    tooltipLines: point.tooltipLines || (point.isSynthetic || point.isCarryOver
      ? [
        `${metric === "mr" ? "MR" : "LP"}：${formatInt(point.value)}`,
        `日期：${point.key}`,
        point.carrySourceKey
          ? `当日无对战，沿用 ${point.carrySourceKey} 的最近分数`
          : "当日无对战，暂无更早分数可沿用",
        point.match
          ? `最近对局：${String(point.match.myCharacter || "-")} vs ${String(point.match.opponentCharacter || "-")}`
          : "最近对局：-"
      ]
      : [
        `${metric === "mr" ? "MR" : "LP"}：${formatInt(point.value)}`,
        `相邻日期分差：${formatDelta(point.pointDelta)}`,
        `当日净变化：${formatDelta(point.delta)}`,
        `日期：${point.key}`,
        `对战数：${formatInt(point.battleCount)}`,
        point.match
          ? `最近对局：${String(point.match.myCharacter || "-")} vs ${String(point.match.opponentCharacter || "-")}`
          : "最近对局：-"
      ])
  }));
}

function createTrendSvgNode(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
  return node;
}

function showTrendTooltip(tooltip, lines, event, wrapRect) {
  tooltip.style.display = "block";
  tooltip.textContent = lines.join("\n");
  const left = Math.min(Math.max(10, event.clientX - wrapRect.left + 14), Math.max(10, wrapRect.width - 240));
  const top = Math.min(Math.max(10, event.clientY - wrapRect.top + 12), Math.max(10, wrapRect.height - 110));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function renderCharacterTrend(matches, focusCharacter) {
  if (!refs.characterTrendSvg || !refs.characterTrendWrap || !refs.characterTrendAxis) {
    return;
  }

  const slots = buildCharacterTrendSlots(matches, getChartRangeDays(state.rangeDays), focusCharacter);
  refs.characterTrendSvg.innerHTML = "";
  refs.characterTrendAxis.innerHTML = "";
  refs.characterTrendTooltip.style.display = "none";

  const valid = slots.filter((item) => typeof item.value === "number");
  if (!valid.length) {
    refs.characterTrendEmpty.style.display = "grid";
    refs.characterTrendTitle.textContent = "角色使用趋势";
    return;
  }

  refs.characterTrendEmpty.style.display = "none";
  refs.characterTrendTitle.textContent = `${focusCharacter || "主力角色"} 使用趋势`;

  const width = 420;
  const height = 220;
  const pad = { left: 20, right: 20, top: 22, bottom: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...valid.map((item) => item.value), 1);

  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (plotHeight * i) / 3;
    refs.characterTrendSvg.appendChild(createTrendSvgNode("line", {
      x1: pad.left,
      y1: y,
      x2: width - pad.right,
      y2: y,
      stroke: "rgba(204, 251, 241, 0.10)",
      "stroke-dasharray": "4 6"
    }));
  }

  const plotted = slots.map((item, index) => {
    const x = pad.left + (plotWidth * index) / Math.max(1, slots.length - 1);
    const y = typeof item.value === "number"
      ? pad.top + ((maxValue - item.value) / Math.max(1, maxValue)) * plotHeight
      : null;
    return { ...item, x, y };
  });

  plotted.forEach((point) => {
    refs.characterTrendSvg.appendChild(createTrendSvgNode("line", {
      x1: point.x,
      y1: pad.top,
      x2: point.x,
      y2: height - pad.bottom,
      stroke: "rgba(204, 251, 241, 0.06)",
      "stroke-dasharray": "2 10"
    }));
  });

  const actual = plotted.filter((point) => typeof point.y === "number");
  for (let index = 1; index < actual.length; index += 1) {
    const prev = actual[index - 1];
    const current = actual[index];
    const gap = current.key !== prev.key && (current.date.getTime() - prev.date.getTime()) > 86400000;
    refs.characterTrendSvg.appendChild(createTrendSvgNode("line", {
      x1: prev.x,
      y1: prev.y,
      x2: current.x,
      y2: current.y,
      stroke: gap ? "rgba(147, 197, 253, 0.26)" : "#93c5fd",
      "stroke-width": gap ? "2" : "3",
      "stroke-linecap": "round",
      "stroke-dasharray": gap ? "7 7" : "0"
    }));
  }

  actual.forEach((point) => {
    const deltaLabel = createTrendSvgNode("text", {
      x: point.x,
      y: point.y - 10,
      fill: "#bfdbfe",
      "font-size": "10",
      "font-weight": "700",
      "text-anchor": "middle"
    });
    deltaLabel.textContent = String(point.value);
    refs.characterTrendSvg.appendChild(deltaLabel);

    const circle = createTrendSvgNode("circle", {
      cx: point.x,
      cy: point.y,
      r: "4.5",
      fill: "#93c5fd",
      stroke: "#07121c",
      "stroke-width": "2"
    });
    circle.addEventListener("mouseenter", (event) => {
      const lines = [
        `日期：${point.key}`,
        `${focusCharacter || "主力角色"}出场：${formatInt(point.value)}`,
        `当天总对战：${formatInt(point.totalCount)}`
      ];
      showTrendTooltip(refs.characterTrendTooltip, lines, event, refs.characterTrendWrap.getBoundingClientRect());
    });
    circle.addEventListener("mousemove", (event) => {
      const lines = [
        `日期：${point.key}`,
        `${focusCharacter || "主力角色"}出场：${formatInt(point.value)}`,
        `当天总对战：${formatInt(point.totalCount)}`
      ];
      showTrendTooltip(refs.characterTrendTooltip, lines, event, refs.characterTrendWrap.getBoundingClientRect());
    });
    circle.addEventListener("mouseleave", () => {
      refs.characterTrendTooltip.style.display = "none";
    });
    refs.characterTrendSvg.appendChild(circle);
  });

  refs.characterTrendAxis.style.gridTemplateColumns = `repeat(${slots.length}, minmax(0, 1fr))`;
  const step = Math.max(1, Math.ceil(slots.length / 6));
  slots.forEach((slot, index) => {
    const label = document.createElement("span");
    label.textContent = index % step === 0 || index === slots.length - 1 ? slot.label : "";
    refs.characterTrendAxis.appendChild(label);
  });
}

function getCharacterUsageSummary(matches) {
  const options = buildCharacterOptions(matches);
  return options[0] || null;
}

function getRiskOpponent(matches) {
  const bucket = new Map();
  matches.forEach((match) => {
    const name = String(match.opponentCharacter || "").trim();
    if (!name) {
      return;
    }
    const item = bucket.get(name) || { name, total: 0, wins: 0 };
    item.total += 1;
    if (match.result === "win") {
      item.wins += 1;
    }
    bucket.set(name, item);
  });
  return Array.from(bucket.values())
    .filter((item) => item.total >= 3)
    .sort((a, b) => {
      const rateA = itemWinRate(a);
      const rateB = itemWinRate(b);
      if (rateA !== rateB) {
        return rateA - rateB;
      }
      return b.total - a.total;
    })[0] || null;

  function itemWinRate(item) {
    return item.total ? item.wins / item.total : 1;
  }
}

function renderOverviewSummary(filtered, allMatches, chartSlots) {
  const latestScore = chartSlots.length
    ? [...chartSlots].reverse().find((slot) => typeof slot.value === "number")
    : null;
  const summary = summarize(filtered);
  const mainCharacter = getCharacterUsageSummary(allMatches);
  const riskOpponent = getRiskOpponent(allMatches);

  if (refs.overviewCurrentScore) {
    refs.overviewCurrentScore.textContent = formatInt(latestScore ? latestScore.value : null);
  }
  if (refs.overviewCurrentScoreNote) {
    refs.overviewCurrentScoreNote.textContent = latestScore
      ? `最近一日净变化 ${formatDelta(latestScore.delta)}`
      : "最近区间暂无数据";
  }
  if (refs.overviewWinRate) {
    refs.overviewWinRate.textContent = formatPercent(summary.winRate, 1);
  }
  if (refs.overviewWinRateNote) {
    refs.overviewWinRateNote.textContent = `最近区间 ${summary.total} 场`;
  }
  if (refs.overviewMainCharacter) {
    refs.overviewMainCharacter.textContent = mainCharacter ? mainCharacter.label : "-";
  }
  if (refs.overviewMainCharacterNote) {
    refs.overviewMainCharacterNote.textContent = mainCharacter
      ? `使用 ${mainCharacter.count} 场`
      : "等待同步";
  }
  if (refs.overviewRiskCharacter) {
    refs.overviewRiskCharacter.textContent = riskOpponent ? riskOpponent.name : "-";
  }
  if (refs.overviewRiskCharacterNote) {
    refs.overviewRiskCharacterNote.textContent = riskOpponent
      ? `胜率 ${formatPercent((riskOpponent.wins / riskOpponent.total) * 100, 1)} / ${riskOpponent.total} 场`
      : "样本不足，暂不提示";
  }
}

function renderOverviewFramedataDirectory() {
  if (!refs.overviewFramedataDirectory) {
    return;
  }
  refs.overviewFramedataDirectory.innerHTML = "";

  if (!state.framedataDatasetLoaded && !state.framedataDatasetLoading) {
    ensureFramedataDatasetLoaded().finally(() => {
      if (state.currentView === "overview" || state.currentView === "battlelog") {
        renderBattlelog();
      }
    });
  }

  const options = buildFramedataCharacterOptions().slice(0, 8);
  if (!options.length) {
    const button = document.createElement("div");
    button.className = "character-entry-button";
    button.innerHTML = "<strong>帧数表加载中</strong><span>请稍候进入角色详情。</span>";
    refs.overviewFramedataDirectory.appendChild(button);
    return;
  }

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `character-entry-button${opt.key === state.framedataCharacter ? " active" : ""}`;
    btn.innerHTML = `<strong>${opt.label}</strong><span>进入角色详情</span>`;
    btn.addEventListener("click", () => {
      state.framedataCharacter = opt.key;
      state.currentView = "framedata";
      renderCurrentView();
    });
    refs.overviewFramedataDirectory.appendChild(btn);
  });
}

function renderBattlelogTableRows(rows) {
  refs.matchesBody.innerHTML = "";
  const resultMap = {
    win: { text: "胜", className: "result-win" },
    loss: { text: "负", className: "result-loss" },
    draw: { text: "平", className: "result-draw" }
  };

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const result = resultMap[row.result] || { text: "-", className: "" };
    const score = getMetricValue(row);
    const beforeScore = getMetricBeforeValueForMetric(row, state.metric);
    const delta = getMetricDelta(row);
    const scoreText = score === null
      ? "-"
      : `${formatInt(score)}${beforeScore !== null ? `（前 ${formatInt(beforeScore)}）` : ""}`;
    const cells = [
      { text: formatDate(row.playedAt) },
      { text: result.text, className: result.className },
      { text: row.mode || "-" },
      { text: scoreText },
      {
        text: formatDelta(delta),
        className: delta > 0 ? "delta-positive" : delta < 0 ? "delta-negative" : ""
      },
      { text: row.myCharacter || "-" },
      { text: row.opponentCharacter || "-" },
      { text: row.opponentName || "-" }
    ];

    cells.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell.text;
      if (cell.className) {
        td.className = cell.className;
      }
      tr.appendChild(td);
    });
    refs.matchesBody.appendChild(tr);
  });
}

function resolveBattlelogMetric(matches) {
  const preferredMetric = state.metric === "lp" ? "lp" : "mr";
  const fallbackMetric = preferredMetric === "mr" ? "lp" : "mr";

  if (hasMetricData(matches, preferredMetric)) {
    return { metric: preferredMetric, fallbackUsed: false };
  }
  if (hasMetricData(matches, fallbackMetric)) {
    return { metric: fallbackMetric, fallbackUsed: true };
  }
  return { metric: preferredMetric, fallbackUsed: false };
}

function hasChartPoints(slots) {
  return Array.isArray(slots) && slots.some((slot) => typeof slot.value === "number");
}

function filterMatchesByDays(matches, days) {
  const list = Array.isArray(matches) ? matches : [];
  if (!days || days <= 0) {
    return list;
  }
  const now = Date.now();
  const rangeMs = days * 86400000;
  return list.filter((match) => {
    const time = new Date(match && match.playedAt ? match.playedAt : "").getTime();
    return Number.isFinite(time) && now - time <= rangeMs;
  });
}

function clampPage(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  if (state.page > totalPages) {
    state.page = totalPages;
  }
  if (state.page < 1) {
    state.page = 1;
  }
  return totalPages;
}

function renderBattlelog() {
  const player = getPlayer();
  const matches = getMatches(player);
  const characterOptions = buildCharacterOptions(matches);
  renderCharacterSidebar(characterOptions);
  const isOverviewView = state.currentView !== "battlelog";

  const filtered = state.currentCharacter
    ? matches.filter((match) => String(match.myCharacter || "") === state.currentCharacter)
    : matches;

  const requestedMetric = state.metric;
  const rangeFilteredForMatches = filterMatchesForChartRange(filtered, state.rangeDays);
  const metricSource = isOverviewView ? filtered : (rangeFilteredForMatches.length ? rangeFilteredForMatches : filtered);
  const metricDecision = resolveBattlelogMetric(metricSource);
  if (metricDecision.metric !== state.metric) {
    state.metric = metricDecision.metric;
  }

  let chartSlots = [];
  if (isOverviewView) {
    chartSlots = buildContinuousDailyScoreSlots(filtered, getChartRangeDays(state.rangeDays), state.metric);
  } else {
    chartSlots = buildMatchScoreSlots(filtered, state.rangeDays, state.metric);
  }

  refs.chartTitle.textContent = isOverviewView
    ? `${state.metric.toUpperCase()} 日期分数趋势`
    : `${state.metric.toUpperCase()} 对战分数轨迹`;
  if (refs.metricSelect) {
    refs.metricSelect.value = state.metric;
  }
  if (refs.rangeSelect) {
    refs.rangeSelect.value = String(state.rangeDays);
  }
  if (refs.detailRangeSelect) {
    refs.detailRangeSelect.value = String(state.detailRangeDays);
  }

  if (!chartSlots.length || !hasChartPoints(chartSlots)) {
    refs.chartEmpty.style.display = "grid";
    refs.chartEmpty.textContent = isOverviewView
      ? "当前日期区间暂无可绘制的分数数据，请先同步或切换角色。"
      : "当前筛选范围内暂无可绘制的对战分数记录。";
    renderChartAxis([], false);
    state.chartPoints = [];
    refs.scoreChart.getContext("2d").clearRect(0, 0, refs.scoreChart.width, refs.scoreChart.height);
  } else {
    refs.chartEmpty.style.display = "none";
    renderChartAxis(chartSlots, isOverviewView);
    state.chartPoints = drawChart(chartSlots, state.metric, {
      showXAxisLabels: isOverviewView,
      showPointLabels: chartSlots.length <= 50,
      useDateGapStyle: isOverviewView
    });
  }

  const summary = summarize(filtered);
  const chartSummary = summarize(isOverviewView ? filtered : rangeFilteredForMatches);
  const latestScore = [...chartSlots].reverse().find((slot) => typeof slot.value === "number");
  const rangeLabel = getChartRangeLabel(state.rangeDays);
  const aggregatedPointCount = chartSlots.filter((slot) => slot.isAggregated).length;
  const chartRangeText = !isOverviewView && aggregatedPointCount
    ? `图表范围：全部（聚合为 ${aggregatedPointCount} 个点）`
    : `图表范围：${rangeLabel}`;
  const carryOverOnly = isOverviewView
    && chartSlots.length
    && chartSlots.every((slot) => typeof slot.value === "number" && (slot.isSynthetic || slot.isCarryOver));
  setPills(refs.chartStats, [
    `角色：${state.currentCharacter || "全部"}`,
    `场次：${chartSummary.total}`,
    `胜率：${chartSummary.winRate.toFixed(1)}%`,
    `当前${state.metric.toUpperCase()}：${formatInt(latestScore ? latestScore.value : null)}`,
    metricDecision.fallbackUsed
      ? `指标已从 ${requestedMetric.toUpperCase()} 切换为 ${state.metric.toUpperCase()}`
      : chartRangeText,
    !isOverviewView && chartSlots.length > 50
      ? `点位：${chartSlots.length}（已隐藏点上文字）`
      : `点位：${chartSlots.length}`,
    carryOverOnly
      ? "当前区间无对局，图表显示最近历史分数参考线"
      : `表格范围：${state.detailRangeDays > 0 ? `${state.detailRangeDays}天` : "全部"}`
  ]);

  renderOverviewSummary(filtered, matches, chartSlots);
  const focusCharacter = state.currentCharacter || (getCharacterUsageSummary(matches) || {}).label || "";
  renderCharacterTrend(matches, focusCharacter);
  renderOverviewFramedataDirectory();

  const detailFiltered = filterMatchesByDays(filtered, state.detailRangeDays);
  const detailSummary = summarize(detailFiltered);
  const detailRangeLabel = state.detailRangeDays > 0 ? `${state.detailRangeDays}天` : "全部";
  refs.detailTitle.textContent = `${state.currentCharacter || "全部角色"} 最近对战（${detailRangeLabel}）`;
  setPills(refs.detailStats, [
    `场次：${detailSummary.total}`,
    `胜：${detailSummary.wins}`,
    `负：${detailSummary.losses}`,
    `平：${detailSummary.draws}`
  ]);

  const totalPages = clampPage(detailFiltered.length);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = detailFiltered.slice(start, start + state.pageSize);
  renderBattlelogTableRows(pageRows);

  refs.pageInfo.textContent = `第${state.page} / ${totalPages} 页`;
  refs.prevPageBtn.disabled = state.page <= 1;
  refs.nextPageBtn.disabled = state.page >= totalPages;
}
