(function exposeFeatureCore(root, factory) {
  const core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
    return;
  }

  Object.defineProperty(root, "__CHZZK_EX_FEATURE_CORE__", {
    value: core,
    configurable: true
  });
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${remainder}`;
  }

  function formatVolumePercent(volume, muted = false) {
    const normalized = muted ? 0 : clamp(Number(volume) || 0, 0, 1);
    return `${Math.round(normalized * 100)}%`;
  }

  function formatOffset(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    return hours > 0
      ? `-${hours}:${minutes}:${remainder}`
      : `-${minutes}:${remainder}`;
  }

  function formatTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function projectLiveEdge(anchorEnd, elapsedSeconds) {
    if (!Number.isFinite(anchorEnd)) {
      return null;
    }
    return anchorEnd + Math.max(0, Number(elapsedSeconds) || 0);
  }

  function timelineProgress(liveDistance, windowDuration) {
    if (!Number.isFinite(liveDistance) || !Number.isFinite(windowDuration) || windowDuration <= 0) {
      return 1;
    }
    return clamp(1 - Math.max(0, liveDistance) / windowDuration, 0, 1);
  }

  function isAtLiveEdge(
    manualTimelinePosition,
    playerSaysLive,
    liveDistance,
    toleranceSeconds = 4.5
  ) {
    return (
      !manualTimelinePosition &&
      (playerSaysLive ||
        (Number.isFinite(liveDistance) &&
          liveDistance <= Math.max(0, toleranceSeconds)))
    );
  }

  function timelineSeekTarget(
    start,
    end,
    liveEdge,
    windowDuration,
    ratio,
    liveSafetySeconds = 0.25
  ) {
    if (
      ![start, end, liveEdge, windowDuration, ratio].every(Number.isFinite) ||
      end <= start ||
      windowDuration <= 0
    ) {
      return null;
    }

    const safeEnd = Math.max(start, end - Math.max(0, liveSafetySeconds));
    const requested =
      liveEdge - windowDuration * (1 - clamp(ratio, 0, 1));
    return clamp(requested, start, safeEnd);
  }

  function hasUsableNativeTimeline(candidates) {
    return (Array.isArray(candidates) ? candidates : []).some(
      ({ custom, display, visibility, width, height }) =>
        !custom &&
        display !== "none" &&
        visibility !== "hidden" &&
        Number.isFinite(width) &&
        width > 40 &&
        Number.isFinite(height) &&
        height > 0
    );
  }

  const LOUDNESS_OFFSET_DB = -0.691;

  function loudnessDbFromEnergy(energy) {
    if (!Number.isFinite(energy) || energy <= 0) {
      return Number.NEGATIVE_INFINITY;
    }
    return LOUDNESS_OFFSET_DB + 10 * Math.log10(energy);
  }

  function energyFromLoudnessDb(loudnessDb) {
    if (!Number.isFinite(loudnessDb)) {
      return 0;
    }
    return 10 ** ((loudnessDb - LOUDNESS_OFFSET_DB) / 10);
  }

  function sourceLevelBeforeMediaVolume(energy, peak, volume, muted = false) {
    const scalar = clamp(Number(volume), 0, 1);
    if (
      muted ||
      !Number.isFinite(energy) ||
      energy < 0 ||
      !Number.isFinite(peak) ||
      peak < 0 ||
      !Number.isFinite(scalar) ||
      scalar <= 0
    ) {
      return null;
    }
    return {
      energy: energy / (scalar * scalar),
      peak: peak / scalar
    };
  }

  function gatedLoudnessDb(
    blockEnergies,
    { absoluteGateDb = -70, relativeGateDb = 10 } = {}
  ) {
    const absoluteGated = (Array.isArray(blockEnergies) ? blockEnergies : []).filter(
      (energy) =>
        Number.isFinite(energy) &&
        energy > 0 &&
        loudnessDbFromEnergy(energy) >= absoluteGateDb
    );
    if (!absoluteGated.length) {
      return null;
    }

    const ungatedEnergy =
      absoluteGated.reduce((sum, energy) => sum + energy, 0) /
      absoluteGated.length;
    const relativeThreshold = Math.max(
      absoluteGateDb,
      loudnessDbFromEnergy(ungatedEnergy) - Math.max(0, relativeGateDb)
    );
    const gated = absoluteGated.filter(
      (energy) => loudnessDbFromEnergy(energy) >= relativeThreshold
    );
    const integratedEnergy =
      gated.reduce((sum, energy) => sum + energy, 0) / gated.length;
    return loudnessDbFromEnergy(integratedEnergy);
  }

  function quantile(sortedValues, ratio) {
    if (!Array.isArray(sortedValues) || !sortedValues.length) {
      return null;
    }
    const position = (sortedValues.length - 1) * clamp(ratio, 0, 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sortedValues[lowerIndex];
    const upper = sortedValues[upperIndex];
    return lower + (upper - lower) * (position - lowerIndex);
  }

  function adaptiveLoudnessStats(
    blockEnergies,
    {
      absoluteGateDb = -70,
      relativeGateDb = 10,
      lowerQuantile = 0.1,
      upperQuantile = 0.9
    } = {}
  ) {
    const candidates = (Array.isArray(blockEnergies) ? blockEnergies : [])
      .filter(
        (energy) =>
          Number.isFinite(energy) &&
          energy > 0 &&
          loudnessDbFromEnergy(energy) >= absoluteGateDb
      );
    if (!candidates.length) {
      return null;
    }

    const ungatedEnergy =
      candidates.reduce((sum, energy) => sum + energy, 0) /
      candidates.length;
    const relativeThreshold = Math.max(
      absoluteGateDb,
      loudnessDbFromEnergy(ungatedEnergy) - Math.max(0, relativeGateDb)
    );
    const gated = candidates.filter(
      (energy) => loudnessDbFromEnergy(energy) >= relativeThreshold
    );
    if (!gated.length) {
      return null;
    }

    const sortedEnergies = [...gated].sort((left, right) => left - right);
    const lowerEnergy = quantile(sortedEnergies, lowerQuantile);
    const upperEnergy = quantile(sortedEnergies, upperQuantile);
    const trimmedEnergies = sortedEnergies.filter(
      (energy) => energy >= lowerEnergy && energy <= upperEnergy
    );
    const representativeEnergies = trimmedEnergies.length
      ? trimmedEnergies
      : sortedEnergies;
    const representativeEnergy =
      representativeEnergies.reduce((sum, energy) => sum + energy, 0) /
      representativeEnergies.length;
    return {
      loudnessDb: loudnessDbFromEnergy(representativeEnergy),
      lowerDb: loudnessDbFromEnergy(lowerEnergy),
      medianDb: loudnessDbFromEnergy(quantile(sortedEnergies, 0.5)),
      upperDb: loudnessDbFromEnergy(upperEnergy),
      sampleCount: gated.length
    };
  }

  function normalizationGainDb({
    loudnessDb,
    targetDb = -14,
    minimumDb = -12,
    maximumDb = 12
  }) {
    if (!Number.isFinite(loudnessDb) || !Number.isFinite(targetDb)) {
      return 0;
    }
    return clamp(targetDb - loudnessDb, minimumDb, maximumDb);
  }

  function maximumPeakDb(peaks) {
    const peak = (Array.isArray(peaks) ? peaks : []).reduce(
      (maximum, value) =>
        Number.isFinite(value) && value > maximum ? value : maximum,
      0
    );
    return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
  }

  function biquadQDbFromLinear(linearQ) {
    return Number.isFinite(linearQ) && linearQ > 0
      ? 20 * Math.log10(linearQ)
      : 0;
  }

  function normalizationSafetyCeilingDb({
    shortTermLoudnessDb,
    renderedPeakDb,
    shortTermCeilingDb = -11,
    peakCeilingDb = -3,
    minimumDb = -12,
    maximumDb = 12
  }) {
    const loudnessLimitedGainDb = Number.isFinite(shortTermLoudnessDb)
      ? shortTermCeilingDb - shortTermLoudnessDb
      : maximumDb;
    const peakLimitedGainDb = Number.isFinite(renderedPeakDb)
      ? Math.max(0, peakCeilingDb - renderedPeakDb)
      : maximumDb;
    return clamp(
      Math.min(loudnessLimitedGainDb, peakLimitedGainDb, maximumDb),
      minimumDb,
      maximumDb
    );
  }

  function stepAdaptiveGainDb(
    currentGainDb,
    targetGainDb,
    { deadbandDb = 0.75, increaseStepDb = 0.25, decreaseStepDb = 1 } = {}
  ) {
    if (!Number.isFinite(currentGainDb) || !Number.isFinite(targetGainDb)) {
      return Number.isFinite(currentGainDb) ? currentGainDb : 0;
    }
    const difference = targetGainDb - currentGainDb;
    if (Math.abs(difference) < Math.max(0, deadbandDb)) {
      return currentGainDb;
    }
    const step = difference > 0
      ? Math.max(0, increaseStepDb)
      : Math.max(0, decreaseStepDb);
    return currentGainDb + Math.sign(difference) * Math.min(Math.abs(difference), step);
  }

  function trackLatencyMode(track) {
    if (!track) {
      return "";
    }
    const identity = [track.kind, track.id, track.label]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/low[-_.]?latency|lowlatency/.test(identity)) {
      return "LL";
    }
    const standardConnectionLabel = String.fromCharCode(112, 50, 112);
    return new RegExp(
      `(?:^|\\s)(?:main|${standardConnectionLabel})(?:\\s|$)`
    ).test(identity) || identity
      ? "일반"
      : "";
  }

  function colorAlpha(color) {
    if (!color || color === "transparent") {
      return 0;
    }

    const rgba = String(color).match(/^rgba?\(([^)]+)\)$/i);
    if (!rgba) {
      return 1;
    }

    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 ? clamp(Number(parts[3]), 0, 1) : 1;
  }

  function findContainedChatMessage(value, depth = 0, seen = new Set()) {
    if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) {
      return null;
    }
    seen.add(value);

    if (value.chatMessage && typeof value.chatMessage === "object") {
      return value.chatMessage;
    }
    if (
      Object.prototype.hasOwnProperty.call(value, "time") &&
      (Object.prototype.hasOwnProperty.call(value, "content") ||
        Object.prototype.hasOwnProperty.call(value, "originalContent"))
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findContainedChatMessage(entry, depth + 1, seen);
        if (found) {
          return found;
        }
      }
      return null;
    }

    for (const key of ["memoizedProps", "pendingProps", "child", "children", "props"]) {
      const found = findContainedChatMessage(value[key], depth + 1, seen);
      if (found) {
        return found;
      }
    }
    return null;
  }

  return Object.freeze({
    adaptiveLoudnessStats,
    biquadQDbFromLinear,
    clamp,
    colorAlpha,
    energyFromLoudnessDb,
    findContainedChatMessage,
    formatDuration,
    formatVolumePercent,
    formatOffset,
    formatTimestamp,
    gatedLoudnessDb,
    hasUsableNativeTimeline,
    isAtLiveEdge,
    loudnessDbFromEnergy,
    timelineSeekTarget,
    maximumPeakDb,
    normalizationGainDb,
    normalizationSafetyCeilingDb,
    projectLiveEdge,
    timelineProgress,
    sourceLevelBeforeMediaVolume,
    stepAdaptiveGainDb,
    trackLatencyMode
  });
});
