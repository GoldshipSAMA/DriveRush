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

document.getElementById("openDashboard").addEventListener("click", async () => {
  await sendMessage({ type: "OPEN_DASHBOARD" });
});
