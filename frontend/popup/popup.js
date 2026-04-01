const statusEl = document.getElementById("status");

function setStatus(text, isError) {
  statusEl.textContent = text || "";
  statusEl.style.color = isError ? "#fca5a5" : "#93c5fd";
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "扩展通信失败。" });
        return;
      }
      resolve(response || { ok: false, error: "无响应。" });
    });
  });
}

async function refreshHint() {
  const hint = document.getElementById("hint");
  const result = await sendMessage({ type: "GET_ACTIVE_TAB_HINT" });
  if (!result.ok) {
    hint.textContent = "无法读取当前标签页状态。";
    return;
  }
  hint.textContent = result.isTargetPage
    ? "检测到 Buckler 页面，可直接同步。"
    : "先打开 Buckler 玩家页面，再点击同步。";
}

document.getElementById("openDashboard").addEventListener("click", async () => {
  const result = await sendMessage({ type: "OPEN_DASHBOARD" });
  setStatus(result.ok ? "已打开战绩面板。" : (result.error || "打开失败"), !result.ok);
});

document.getElementById("syncNow").addEventListener("click", async () => {
  setStatus("正在请求同步...", false);
  const result = await sendMessage({ type: "REQUEST_SYNC_ACTIVE_TAB" });
  if (!result.ok) {
    setStatus(result.error || "同步失败", true);
    return;
  }
  setStatus("同步已启动，请在战绩面板查看进度。", false);
});

refreshHint();
