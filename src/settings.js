(function exposeSettings(root, factory) {
  const config = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = config;
    return;
  }

  Object.defineProperty(root, "__CHZZK_EX_CONFIG__", {
    value: config,
    configurable: false
  });
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const NORMALIZATION_MAX_BOOST_RANGE = Object.freeze({ min: 0, max: 60 });
  const NORMALIZATION_TARGET_RANGE = Object.freeze({ min: -60, max: -10 });
  const COMPRESSOR_PRESETS = Object.freeze({
    light: Object.freeze({
      label: "약",
      thresholdDb: -14,
      kneeDb: 10,
      ratio: 2,
      attackSeconds: 0.02,
      releaseSeconds: 0.35
    }),
    medium: Object.freeze({
      label: "중",
      thresholdDb: -18,
      kneeDb: 12,
      ratio: 3,
      attackSeconds: 0.015,
      releaseSeconds: 0.3
    }),
    strong: Object.freeze({
      label: "강",
      thresholdDb: -22,
      kneeDb: 16,
      ratio: 4,
      attackSeconds: 0.01,
      releaseSeconds: 0.25
    })
  });

  const DEFAULT_SETTINGS = Object.freeze({
    normalizeVolume: true,
    normalizationTargetDb: -16,
    normalizationMaxBoostDb: 12,
    compressAudio: true,
    compressorPreset: "medium",
    timelineAssist: true,
    watchTimer: true,
    followingAutoRefresh: true,
    sidebarPreview: true,
    chatTimestamp: true,
    videoLatency: true,
    restoreTransparentNicknames: true,
    restoreBlindedMessages: true,
    autoClaimPower: true,
    debug: false
  });

  return Object.freeze({
    DEFAULT_SETTINGS,
    NORMALIZATION_MAX_BOOST_RANGE,
    NORMALIZATION_TARGET_RANGE,
    COMPRESSOR_PRESETS
  });
});
