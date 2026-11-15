let native: chrome.runtime.Port | null = null;
const jobs = new Map<string, chrome.runtime.Port>();
function ensureNative() {
  if (native) return native;
  native = chrome.runtime.connectNative("com.overleaf_astra.bot");
  native.onMessage.addListener((message) => {
    const jobId = message.jobId;
    const client = typeof jobId === "string" ? jobs.get(jobId) : undefined;
    if (!client) return;
    try {
      client.postMessage(message);
    } catch {}
  });
  native.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    for (const [jobId, client] of jobs) {
      if (error) {
        try {
          client.postMessage({ type: "done", jobId, error });
        } catch {}
      }
      try {
        client.disconnect();
      } catch {}
    }
    jobs.clear();
    native = null;
  });
  return native;
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ageaf:bot") return;
  const bridge = ensureNative();
  let jobId: string | undefined;
  port.onMessage.addListener((message) => {
    if (message?.type === "start" && typeof message.trigger?.id === "string") {
      const id = message.trigger.id;
      jobId = id;
      jobs.set(id, port);
    }
    try {
      bridge.postMessage(message);
    } catch {}
  });
  port.onDisconnect.addListener(() => {
    if (jobId) jobs.delete(jobId);
  });
});
