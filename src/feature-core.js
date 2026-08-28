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
  const CHAT_BLIND_TEXT = /^(?:메시지가\s*블라인드\s*처리되었습니다|클린봇이\s*부적절한\s*표현을\s*감지했습니다|블라인드\s*처리된\s*메시지입니다)[\s.!?…]*$/i;
  const BLINDED_CHAT_STATUSES = new Set([
    "BLIND",
    "HIDDEN",
    "RECLAIM",
    "FILTERED",
    "CBOTBLIND"
  ]);
  const VISIBLE_CHAT_STATUSES = new Set(["NORMAL", "CANCEL"]);

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

  function initialLiveSeekTarget(
    currentTime,
    start,
    end,
    minimumLagSeconds = 1,
    liveSafetySeconds = 0.25
  ) {
    if (
      ![currentTime, start, end, minimumLagSeconds, liveSafetySeconds].every(
        Number.isFinite
      ) ||
      end <= start
    ) {
      return null;
    }

    const safeEnd = Math.max(start, end - Math.max(0, liveSafetySeconds));
    const minimumLag = Math.max(0, minimumLagSeconds);
    return end - currentTime > minimumLag && safeEnd > currentTime
      ? safeEnd
      : null;
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

  function shouldResetLoudnessMeasurement(previousRoute, nextRoute) {
    const previous = String(previousRoute || "");
    const next = String(nextRoute || "");
    return Boolean(next && next !== previous);
  }

  function isSidebarPreviewTarget(href, insideSidebar) {
    return Boolean(
      insideSidebar &&
      /^\/live\/[a-f0-9]{32}(?:[/?#]|$)/i.test(String(href || ""))
    );
  }

  function compressorThresholdForMediaVolume(
    thresholdDb,
    volume,
    minimumVolume = 0.001
  ) {
    if (!Number.isFinite(thresholdDb)) {
      return 0;
    }
    const scalar = clamp(
      Number.isFinite(Number(volume)) ? Number(volume) : 1,
      Math.max(Number.EPSILON, minimumVolume),
      1
    );
    return thresholdDb + 20 * Math.log10(scalar);
  }

  function compressorMakeupTrimDb(thresholdDb, ratio) {
    if (!Number.isFinite(thresholdDb) || !Number.isFinite(ratio) || ratio < 1) {
      return 0;
    }
    const fullScaleOutputDb = Math.min(0, thresholdDb) -
      Math.min(0, thresholdDb) / ratio;
    return fullScaleOutputDb * 0.6;
  }

  function meanSquareTail(samples, sampleCount) {
    const values = ArrayBuffer.isView(samples) || Array.isArray(samples)
      ? samples
      : [];
    const count = Math.min(
      values.length,
      Math.max(0, Math.floor(Number(sampleCount) || 0))
    );
    if (!count) {
      return 0;
    }
    let squareSum = 0;
    for (let index = values.length - count; index < values.length; index += 1) {
      const sample = Number(values[index]) || 0;
      squareSum += sample * sample;
    }
    return squareSum / count;
  }

  function maximumAbsoluteTail(samples, sampleCount) {
    const values = ArrayBuffer.isView(samples) || Array.isArray(samples)
      ? samples
      : [];
    const count = Math.min(
      values.length,
      Math.max(0, Math.floor(Number(sampleCount) || 0))
    );
    let maximum = 0;
    for (let index = values.length - count; index < values.length; index += 1) {
      maximum = Math.max(maximum, Math.abs(Number(values[index]) || 0));
    }
    return maximum;
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

  function percentile(values, ratio) {
    const sortedValues = (Array.isArray(values) ? values : [])
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    return quantile(sortedValues, ratio);
  }

  function appendTimedSample(samples, value, at, maxAgeMs) {
    if (!Array.isArray(samples)) {
      return [];
    }
    if (Number.isFinite(value) && Number.isFinite(at)) {
      samples.push({ at, value });
    }
    const cutoff = Number(at) - Math.max(0, Number(maxAgeMs) || 0);
    let removeCount = 0;
    while (
      removeCount < samples.length &&
      (!Number.isFinite(samples[removeCount]?.at) ||
        samples[removeCount].at < cutoff)
    ) {
      removeCount += 1;
    }
    if (removeCount) {
      samples.splice(0, removeCount);
    }
    return samples;
  }

  function timedSampleValues(samples) {
    return (Array.isArray(samples) ? samples : [])
      .map((sample) => sample?.value)
      .filter(Number.isFinite);
  }

  function adaptiveLoudnessStats(
    blockEnergies,
    {
      absoluteGateDb = -70,
      relativeGateDb = 10
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
    const representativeEnergy =
      gated.reduce((sum, energy) => sum + energy, 0) / gated.length;
    return {
      loudnessDb: loudnessDbFromEnergy(representativeEnergy),
      lowerDb: loudnessDbFromEnergy(quantile(sortedEnergies, 0.1)),
      medianDb: loudnessDbFromEnergy(quantile(sortedEnergies, 0.5)),
      upperDb: loudnessDbFromEnergy(quantile(sortedEnergies, 0.9)),
      sampleCount: gated.length
    };
  }

  function normalizationGainDb({
    loudnessDb,
    targetDb = -14,
    minimumDb = -60,
    maximumDb = 12
  }) {
    if (!Number.isFinite(loudnessDb) || !Number.isFinite(targetDb)) {
      return 0;
    }
    return clamp(targetDb - loudnessDb, minimumDb, maximumDb);
  }

  function normalizationAnchorConfirmed({
    shortTermLoudnessDb,
    medianLoudnessDb,
    peakDb,
    targetDb = -16,
    targetMarginDb = 8,
    activityMarginDb = 6,
    peakThresholdDb = -12
  }) {
    const nearTarget =
      Number.isFinite(shortTermLoudnessDb) &&
      shortTermLoudnessDb >= targetDb - Math.max(0, targetMarginDb);
    const foregroundContrast =
      Number.isFinite(shortTermLoudnessDb) &&
      Number.isFinite(medianLoudnessDb) &&
      shortTermLoudnessDb - medianLoudnessDb >= Math.max(0, activityMarginDb);
    const strongPeak =
      Number.isFinite(peakDb) && peakDb >= peakThresholdDb;
    return nearTarget || foregroundContrast || strongPeak;
  }

  function hybridNormalizationGainDb({
    integratedLoudnessDb,
    shortTermLoudnessDb,
    peakDb,
    targetDb = -16,
    shortTermAllowanceDb = 4,
    peakCeilingDb = -3,
    minimumDb = -60,
    maximumDb = 12,
    provisionalMaximumDb = 6,
    anchorConfirmed = true
  }) {
    if (
      !Number.isFinite(integratedLoudnessDb) ||
      !Number.isFinite(targetDb)
    ) {
      return {
        gainDb: 0,
        integratedGainDb: 0,
        shortTermLimitDb: 0,
        peakLimitDb: 0,
        effectiveMaximumDb: 0
      };
    }

    const boundedMaximumDb = Math.max(minimumDb, maximumDb);
    const effectiveMaximumDb = anchorConfirmed
      ? boundedMaximumDb
      : Math.min(boundedMaximumDb, Math.max(0, provisionalMaximumDb));
    const integratedGainDb = targetDb - integratedLoudnessDb;
    const shortTermLimitDb = Number.isFinite(shortTermLoudnessDb)
      ? targetDb + shortTermAllowanceDb - shortTermLoudnessDb
      : effectiveMaximumDb;
    const peakLimitDb = Number.isFinite(peakDb)
      ? Math.max(0, peakCeilingDb - peakDb)
      : effectiveMaximumDb;
    const gainDb = clamp(
      Math.min(
        integratedGainDb,
        shortTermLimitDb,
        peakLimitDb,
        effectiveMaximumDb
      ),
      minimumDb,
      boundedMaximumDb
    );

    return {
      gainDb,
      integratedGainDb,
      shortTermLimitDb,
      peakLimitDb,
      effectiveMaximumDb
    };
  }

  function maximumPeakDb(peaks) {
    const peak = (Array.isArray(peaks) ? peaks : []).reduce(
      (maximum, value) =>
        Number.isFinite(value) && value > maximum ? value : maximum,
      0
    );
    return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
  }

  function percentilePeakDb(peaks, ratio = 0.99) {
    const peak = percentile(peaks, ratio);
    return Number.isFinite(peak) && peak > 0
      ? 20 * Math.log10(peak)
      : Number.NEGATIVE_INFINITY;
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
    minimumDb = -60,
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
    if (!color) {
      return 1;
    }
    if (String(color).trim().toLowerCase() === "transparent") {
      return 0;
    }

    const rgba = String(color).match(/^rgba?\(([^)]+)\)$/i);
    if (rgba) {
      const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 4) {
        return 1;
      }
      const token = parts[3];
      const alpha = token.endsWith("%")
        ? Number(token.slice(0, -1)) / 100
        : Number(token);
      return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
    }

    const colorFunction = String(color).match(
      /^color\([^/]+\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)%?)\s*\)$/i
    );
    if (!colorFunction) {
      return 1;
    }
    const token = colorFunction[1];
    const alpha = token.endsWith("%")
      ? Number(token.slice(0, -1)) / 100
      : Number(token);
    return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
  }

  function shouldRestoreTransparentNickname(style) {
    if (!style || colorAlpha(style.color) > 0.05) {
      return false;
    }
    const hasPaintedBackground = String(style.backgroundImage || "")
      .split(",")
      .some((layer) => {
        const background = layer.trim().toLowerCase();
        return background && background !== "none";
      });
    const clipsBackgroundToText = [
      style.backgroundClip,
      style.webkitBackgroundClip
    ].some((value) =>
      String(value || "")
        .split(",")
        .some((clip) => clip.trim().toLowerCase() === "text")
    );
    return !(
      hasPaintedBackground && clipsBackgroundToText
    );
  }

  function chatMessageStatus(message) {
    for (const value of [
      message?.status,
      message?.messageStatusType,
      message?.msgStatusType
    ]) {
      if (value === undefined || value === null) {
        continue;
      }
      const status = String(value).trim().toUpperCase();
      if (status) {
        return status;
      }
    }
    return "";
  }

  function isBlindChatPlaceholder(text) {
    return CHAT_BLIND_TEXT.test(String(text || ""));
  }

  function chatMessageBlindState(message, renderedText = "") {
    const status = chatMessageStatus(message);
    if (BLINDED_CHAT_STATUSES.has(status)) {
      return "blinded";
    }
    if (VISIBLE_CHAT_STATUSES.has(status)) {
      return "visible";
    }
    return isBlindChatPlaceholder(renderedText) ? "blinded" : "unknown";
  }

  function chatTextAfterRestoreCleanup(
    currentText,
    restoredText,
    placeholder,
    restorePlaceholder = true
  ) {
    return restorePlaceholder &&
      placeholder !== undefined &&
      currentText === restoredText
      ? placeholder
      : currentText;
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

    for (const key of [
      "pendingProps",
      "memoizedProps",
      "props",
      "children",
      "child"
    ]) {
      const found = findContainedChatMessage(value[key], depth + 1, seen);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function findChatMessageInReactElements(elements) {
    const candidates = Array.from(elements || []);
    for (const prefix of ["__reactProps$", "__reactFiber$"]) {
      for (const candidate of candidates) {
        for (const key of Object.keys(candidate || {})) {
          if (!key.startsWith(prefix)) {
            continue;
          }
          const message = findContainedChatMessage(candidate[key]);
          if (message) {
            return message;
          }
        }
      }
    }
    return null;
  }

  return Object.freeze({
    adaptiveLoudnessStats,
    appendTimedSample,
    biquadQDbFromLinear,
    clamp,
    compressorMakeupTrimDb,
    compressorThresholdForMediaVolume,
    chatMessageBlindState,
    chatMessageStatus,
    chatTextAfterRestoreCleanup,
    colorAlpha,
    energyFromLoudnessDb,
    findChatMessageInReactElements,
    findContainedChatMessage,
    formatDuration,
    formatVolumePercent,
    formatOffset,
    formatTimestamp,
    gatedLoudnessDb,
    hasUsableNativeTimeline,
    hybridNormalizationGainDb,
    initialLiveSeekTarget,
    isBlindChatPlaceholder,
    isAtLiveEdge,
    isSidebarPreviewTarget,
    loudnessDbFromEnergy,
    maximumAbsoluteTail,
    meanSquareTail,
    timelineSeekTarget,
    maximumPeakDb,
    normalizationAnchorConfirmed,
    normalizationGainDb,
    normalizationSafetyCeilingDb,
    percentile,
    percentilePeakDb,
    projectLiveEdge,
    timelineProgress,
    sourceLevelBeforeMediaVolume,
    shouldRestoreTransparentNickname,
    shouldResetLoudnessMeasurement,
    stepAdaptiveGainDb,
    timedSampleValues,
    trackLatencyMode
  });
});
