chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ageaf:bot") return;
  const native = chrome.runtime.connectNative("com.overleaf_astra.bot");
  native.onMessage.addListener((message) => {
    try {
      port.postMessage(message);
    } catch {}
  });
  native.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (error) {
      try {
        port.postMessage({ type: "done", error });
      } catch {}
    }
    try {
      port.disconnect();
    } catch {}
  });
  port.onMessage.addListener((message) => {
    try {
      native.postMessage(message);
    } catch {}
  });
  port.onDisconnect.addListener(() => {
    try {
      native.disconnect();
    } catch {}
  });
});
