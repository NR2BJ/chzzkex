const {
  DEFAULT_SETTINGS,
  NORMALIZATION_MAX_BOOST_RANGE
} = globalThis.__CHZZK_EX_CONFIG__;

const fields = Object.keys(DEFAULT_SETTINGS);
const booleanFields = fields.filter(
  (field) => typeof DEFAULT_SETTINGS[field] === "boolean"
);
const numberFields = fields.filter(
  (field) => typeof DEFAULT_SETTINGS[field] === "number"
);
const statusElement = document.getElementById("status");
const normalizationMaxBoostElement = document.getElementById(
  "normalizationMaxBoost"
);
const compressorPresetElement = document.getElementById("compressorPreset");
const compressorPresetInputs = Array.from(
  document.querySelectorAll('input[name="compressorPreset"]')
);

function storageGet(defaults) {
  const result = chrome.storage.local.get(defaults);
  if (result && typeof result.then === "function") {
    return result;
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });
}

function storageSet(values) {
  const result = chrome.storage.local.set(values);
  if (result && typeof result.then === "function") {
    return result;
  }

  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

function renderStatus(settings) {
  const enabled = booleanFields.some(
    (field) => field !== "debug" && settings[field]
  );
  statusElement.textContent = enabled ? "ON" : "OFF";
  statusElement.classList.toggle("off", !enabled);
}

function renderCompressorPresetState(enabled) {
  compressorPresetElement.classList.toggle("is-disabled", !enabled);
  for (const input of compressorPresetInputs) {
    input.disabled = !enabled;
  }
}

function normalizedMaxBoostDb(value) {
  const number = Number(value);
  return Math.min(
    NORMALIZATION_MAX_BOOST_RANGE.max,
    Math.max(
      NORMALIZATION_MAX_BOOST_RANGE.min,
      Number.isFinite(number)
        ? number
        : DEFAULT_SETTINGS.normalizationMaxBoostDb
    )
  );
}

function renderNormalizationMaxBoostState(enabled) {
  const input = document.getElementById("normalizationMaxBoostDb");
  normalizationMaxBoostElement.classList.toggle("is-disabled", !enabled);
  input.disabled = !enabled;
}

async function loadSettings() {
  const settings = await storageGet(DEFAULT_SETTINGS);

  for (const field of booleanFields) {
    document.getElementById(field).checked = Boolean(settings[field]);
  }
  for (const field of numberFields) {
    document.getElementById(field).value = normalizedMaxBoostDb(settings[field]);
  }
  const selectedPreset = compressorPresetInputs.find(
    (input) => input.value === settings.compressorPreset
  );
  (selectedPreset || compressorPresetInputs[1]).checked = true;

  renderStatus(settings);
  renderNormalizationMaxBoostState(Boolean(settings.normalizeVolume));
  renderCompressorPresetState(Boolean(settings.compressAudio));
}

async function saveSettings() {
  const nextSettings = {};

  for (const field of booleanFields) {
    nextSettings[field] = document.getElementById(field).checked;
  }
  for (const field of numberFields) {
    const input = document.getElementById(field);
    nextSettings[field] = normalizedMaxBoostDb(input.value);
    input.value = nextSettings[field];
  }
  nextSettings.compressorPreset =
    compressorPresetInputs.find((input) => input.checked)?.value ||
    DEFAULT_SETTINGS.compressorPreset;

  await storageSet(nextSettings);
  renderStatus(nextSettings);
  renderNormalizationMaxBoostState(nextSettings.normalizeVolume);
  renderCompressorPresetState(nextSettings.compressAudio);
}

for (const field of booleanFields) {
  document.getElementById(field).addEventListener("change", saveSettings);
}
for (const field of numberFields) {
  document.getElementById(field).addEventListener("change", saveSettings);
}
for (const input of compressorPresetInputs) {
  input.addEventListener("change", saveSettings);
}

loadSettings();
