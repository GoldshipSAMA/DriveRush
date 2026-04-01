function getChartMatches(matches) {
  const now = Date.now();
  const allPoints = matches
    .map((m) => ({
      time: new Date(m.playedAt || "").getTime(),
      value: getMetricValue(m),
      match: m
    }))
    .filter((x) => Number.isFinite(x.time) && x.value !== null)
    .sort((a, b) => a.time - b.time);

  let points = allPoints;
  if (points.length && state.rangeDays !== 0) {
    const rangeMs = state.rangeDays * 86400000;
    points = points.filter((x) => now - x.time <= rangeMs);
  }
  return points.map((p, idx) => ({
    ...p,
    battleIndex: idx + 1
  }));
}

function filterMatchesByDays(matches, days) {
  const list = Array.isArray(matches) ? matches : [];
  if (!days || days <= 0) {
    return list;
  }
  const now = Date.now();
  const rangeMs = days * 86400000;
  return list.filter((m) => {
    const time = new Date(m && m.playedAt ? m.playedAt : "").getTime();
    if (!Number.isFinite(time)) {
      return false;
    }
    return now - time <= rangeMs;
  });
}

function downsample(points, limit = 420) {
  if (points.length <= limit) {
    return points;
  }
  const result = [];
  const step = (points.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i += 1) {
    const idx = Math.round(i * step);
    result.push(points[idx]);
  }
  return result;
}

function drawChart(points) {
  const canvas = refs.scoreChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, refs.chartWrap.clientWidth - 24);
  const height = Math.max(260, refs.chartWrap.clientHeight - 24);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 56, right: 18, top: 18, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const minValue = Math.min(...points.map((p) => p.value));
  const maxValue = Math.max(...points.map((p) => p.value));
  const valuePad = Math.max(1, Math.round((maxValue - minValue) * 0.05));
  const low = minValue - valuePad;
  const high = maxValue + valuePad;
  const valueSpan = Math.max(1, high - low);

  const useBattleXAxis = true;
  const getXValue = (p) => (useBattleXAxis ? (toNum(p.battleIndex) || 0) : p.time);
  const minXValue = getXValue(points[0]);
  const maxXValue = getXValue(points[points.length - 1]);
  const xSpan = Math.max(1, maxXValue - minXValue);

  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#64748b";
  ctx.font = "12px Segoe UI";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    const value = high - (valueSpan * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(Math.round(value).toLocaleString("zh-CN"), 6, y + 4);
  }

  const lineColor = state.metric === "mr" ? "#0284c7" : "#f97316";
  const plotted = points.map((p) => {
    const x = pad.left + ((getXValue(p) - minXValue) / xSpan) * plotW;
    const y = pad.top + ((high - p.value) / valueSpan) * plotH;
    return { ...p, x, y };
  });

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  plotted.forEach((p, idx) => {
    if (idx === 0) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  });
  ctx.stroke();

  ctx.fillStyle = lineColor;
  plotted.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#64748b";
  if (!useBattleXAxis && points.length > 1) {
    const start = formatDate(new Date(points[0].time).toISOString()).slice(5);
    const end = formatDate(new Date(points[points.length - 1].time).toISOString()).slice(5);
    ctx.fillText(start, pad.left, height - 10);
    const tw = ctx.measureText(end).width;
    ctx.fillText(end, width - pad.right - tw, height - 10);
  }
  return plotted;
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
    const delta = getMetricDelta(row);
    const cells = [
      { text: formatDate(row.playedAt) },
      { text: result.text, className: result.className },
      { text: row.mode || "-" },
      { text: formatInt(score) },
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

function renderBattlelog() {
  const player = getPlayer();
  const matches = getMatches(player);
  const characterOptions = buildCharacterOptions(matches);
  renderCharacterSidebar(characterOptions);

  const filtered = state.currentCharacter
    ? matches.filter((m) => String(m.myCharacter || "") === state.currentCharacter)
    : matches;

  refs.chartTitle.textContent = `${state.metric.toUpperCase()} 分数折线图`;
  if (refs.metricSelect) {
    refs.metricSelect.value = state.metric;
  }
  if (refs.rangeSelect) {
    refs.rangeSelect.value = String(state.rangeDays);
  }
  if (refs.detailRangeSelect) {
    refs.detailRangeSelect.value = String(state.detailRangeDays);
  }

  const chartPointsRaw = downsample(getChartMatches(filtered));
  if (!chartPointsRaw.length) {
    refs.chartEmpty.style.display = "grid";
    state.chartPoints = [];
    refs.scoreChart.getContext("2d").clearRect(0, 0, refs.scoreChart.width, refs.scoreChart.height);
  } else {
    refs.chartEmpty.style.display = "none";
    state.chartPoints = drawChart(chartPointsRaw);
  }

  const latestScore = filtered.length ? getMetricValue(filtered[0]) : null;
  const summary = summarize(filtered);
  setPills(refs.chartStats, [
    `角色：${state.currentCharacter || "全部"}`,
    `场次：${summary.total}`,
    `胜率：${summary.winRate.toFixed(1)}%`,
    `当前${state.metric.toUpperCase()}：${formatInt(latestScore)}`
  ]);

  refs.detailTitle.textContent = `${state.currentCharacter || "全部角色"} 最近对战`;
  setPills(refs.detailStats, [`胜：${summary.wins}`, `负：${summary.losses}`, `平：${summary.draws}`]);

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

