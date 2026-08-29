(() => {
  const MESSAGE_SOURCE = "chzzk-ex";

  const storage = chrome.storage;
  let settingsDefaults = null;
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

  async function postSettings(defaults) {
    if (defaults && typeof defaults === "object") {
      settingsDefaults = { ...defaults };
    }
    if (!settingsDefaults) {
      return;
    }

    const state = await storageGet(settingsDefaults);
    const settings = {};
    for (const key of Object.keys(settingsDefaults)) {
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
      postSettings(event.data.settingsDefaults);
    }
  });

  storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (!settingsDefaults) {
      return;
    }

    const changedSettings = Object.keys(settingsDefaults).some((key) =>
      Object.prototype.hasOwnProperty.call(changes, key)
    );

    if (changedSettings) {
      postSettings();
    }
  });
})();
