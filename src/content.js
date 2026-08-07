(() => {
  const config = globalThis.__CHZZK_EX_CONFIG__;
  if (!config) {
    console.error("[CHZZK EX] settings were not loaded");
    return;
  }

  const MESSAGE_SOURCE = "chzzk-ex";
  const { DEFAULT_SETTINGS } = config;

  const storage = chrome.storage;
  let statePromise = storageGet(DEFAULT_SETTINGS);
  storage.local.remove([
    "playbackFilter",
    "directPlayback",
    "loudnessProfilesV1"
  ]);

  function storageGet(defaults) {
    const result = storage.local.get(defaults);
    if (result && typeof result.then === "function") {
      return result;
    }

    return new Promise((resolve) => {
      storage.local.get(defaults, resolve);
    });
  }

  async function postSettings() {
    const state = await statePromise;
    const settings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      settings[key] = state[key];
    }
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "settings",
        settings
      },
      "*"
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) {
      return;
    }
    if (event.data.type === "ready") {
      postSettings();
    }
  });

  storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    const changedSettings = Object.keys(DEFAULT_SETTINGS).some((key) =>
      Object.prototype.hasOwnProperty.call(changes, key)
    );

    if (changedSettings) {
      statePromise = storageGet(DEFAULT_SETTINGS);
      postSettings();
    }
  });

  postSettings();
})();
