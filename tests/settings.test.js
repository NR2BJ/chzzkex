const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../src/settings.js");
const manifest = require("../manifest.json");
const popupHtml = fs.readFileSync(
  path.join(__dirname, "..", "popup", "popup.html"),
  "utf8"
);

test("keeps one complete immutable settings definition", () => {
  assert.deepEqual(Object.keys(config.DEFAULT_SETTINGS), [
    "normalizeVolume",
    "normalizationTargetDb",
    "normalizationMaxBoostDb",
    "compressAudio",
    "compressorPreset",
    "timelineAssist",
    "watchTimer",
    "followingAutoRefresh",
    "sidebarPreview",
    "chatTimestamp",
    "videoLatency",
    "restoreTransparentNicknames",
    "restoreBlindedMessages",
    "autoClaimPower",
    "debug"
  ]);
  assert.equal(Object.isFrozen(config.DEFAULT_SETTINGS), true);
  assert.equal(config.DEFAULT_SETTINGS.normalizationTargetDb, -16);
  assert.equal(config.DEFAULT_SETTINGS.normalizationMaxBoostDb, 12);
  assert.deepEqual(config.NORMALIZATION_TARGET_RANGE, { min: -60, max: -10 });
  assert.deepEqual(config.NORMALIZATION_MAX_BOOST_RANGE, { min: 0, max: 60 });
  assert.equal(Object.isFrozen(config.NORMALIZATION_TARGET_RANGE), true);
  assert.equal(Object.isFrozen(config.NORMALIZATION_MAX_BOOST_RANGE), true);
  assert.equal(config.DEFAULT_SETTINGS.compressorPreset, "medium");
  assert.deepEqual(Object.keys(config.COMPRESSOR_PRESETS), [
    "light",
    "medium",
    "strong"
  ]);
  assert.deepEqual(config.COMPRESSOR_PRESETS.medium, {
    label: "중",
    thresholdDb: -18,
    kneeDb: 12,
    ratio: 3,
    attackSeconds: 0.015,
    releaseSeconds: 0.3
  });
  assert.equal(Object.isFrozen(config.COMPRESSOR_PRESETS), true);
  assert.equal(Object.isFrozen(config.COMPRESSOR_PRESETS.medium), true);
  const presets = Object.values(config.COMPRESSOR_PRESETS);
  for (const preset of presets) {
    assert.ok(preset.thresholdDb < 0 && preset.thresholdDb >= -100);
    assert.ok(preset.kneeDb >= 0 && preset.kneeDb <= 40);
    assert.ok(preset.ratio >= 1 && preset.ratio <= 20);
    assert.ok(preset.attackSeconds >= 0 && preset.attackSeconds <= 1);
    assert.ok(preset.releaseSeconds >= 0 && preset.releaseSeconds <= 1);
    assert.ok(
      preset.thresholdDb + preset.kneeDb <= 0,
      "volume compensation assumes the soft knee ends below full scale"
    );
  }
  assert.ok(presets[0].thresholdDb > presets[1].thresholdDb);
  assert.ok(presets[1].thresholdDb > presets[2].thresholdDb);
  assert.ok(presets[0].ratio < presets[1].ratio);
  assert.ok(presets[1].ratio < presets[2].ratio);
  assert.deepEqual(Object.keys(config), [
    "DEFAULT_SETTINGS",
    "NORMALIZATION_MAX_BOOST_RANGE",
    "NORMALIZATION_TARGET_RANGE",
    "COMPRESSOR_PRESETS"
  ]);
});

test("loads shared modules only in the page world", () => {
  const scriptWorlds = new Map();

  for (const entry of manifest.content_scripts) {
    const world = entry.world || "ISOLATED";
    for (const script of entry.js || []) {
      const worlds = scriptWorlds.get(script) || [];
      worlds.push(world);
      scriptWorlds.set(script, worlds);
    }
  }

  for (const [script, worlds] of scriptWorlds) {
    assert.equal(
      new Set(worlds).size,
      1,
      `${script} must not be deduplicated across extension worlds`
    );
  }
});

test("describes playback status without obsolete rewind metrics", () => {
  assert.match(popupHtml, /실시간 지연과 음량 상태 표시/);
  assert.doesNotMatch(popupHtml, /LIVE까지|미리 받은 분량/);
});
