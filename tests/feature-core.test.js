const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/feature-core.js");

test("formats stopwatch duration without wrapping after 24 hours", () => {
  assert.equal(core.formatDuration(0), "00:00:00");
  assert.equal(core.formatDuration(3661.9), "01:01:01");
  assert.equal(core.formatDuration(90061), "25:01:01");
});

test("formats the effective player volume as a percentage", () => {
  assert.equal(core.formatVolumePercent(0.456), "46%");
  assert.equal(core.formatVolumePercent(2), "100%");
  assert.equal(core.formatVolumePercent(-1), "0%");
  assert.equal(core.formatVolumePercent(0.8, true), "0%");
});

test("formats relative timeline offsets", () => {
  assert.equal(core.formatOffset(0), "-00:00");
  assert.equal(core.formatOffset(89.5), "-01:30");
  assert.equal(core.formatOffset(3661), "-1:01:01");
});

test("formats an exact local chat timestamp", () => {
  const date = new Date(2026, 7, 6, 9, 5, 7);
  assert.equal(core.formatTimestamp(date.getTime()), "09:05:07");
  assert.equal(core.formatTimestamp("invalid"), "");
});

test("keeps a timeline position fixed against a continuously advancing live edge", () => {
  const initialEdge = core.projectLiveEdge(100, 0);
  const laterEdge = core.projectLiveEdge(100, 30);
  assert.equal(initialEdge - 10, 90);
  assert.equal(laterEdge - 40, 90);
  assert.equal(core.timelineProgress(initialEdge - 10, 120), 0.25);
  assert.equal(core.timelineProgress(laterEdge - 40, 120), 0.25);
});

test("distinguishes live playback from an intentional timeline rewind", () => {
  assert.equal(core.isAtLiveEdge(false, true, 12), true);
  assert.equal(core.isAtLiveEdge(false, false, 3.5), true);
  assert.equal(core.isAtLiveEdge(false, false, 45), false);
  assert.equal(core.isAtLiveEdge(true, true, 1), false);
});

test("maps the custom bar to seconds behind the projected live edge", () => {
  assert.equal(core.timelineSeekTarget(10, 100, 100, 90, 0), 10);
  assert.equal(core.timelineSeekTarget(10, 100, 100, 90, 0.5), 55);
  assert.equal(core.timelineSeekTarget(10, 100, 100, 90, 1), 99.75);
  assert.equal(core.timelineSeekTarget(40, 130, 132, 90, 0), 42);
  assert.equal(core.timelineSeekTarget(10, 10, 10, 90, 0.5), null);
});

test("recognizes only a genuinely visible native timeline", () => {
  assert.equal(
    core.hasUsableNativeTimeline([
      { display: "none", visibility: "visible", width: 0, height: 0 }
    ]),
    false
  );
  assert.equal(
    core.hasUsableNativeTimeline([
      { display: "block", visibility: "visible", width: 800, height: 14 }
    ]),
    true
  );
  assert.equal(
    core.hasUsableNativeTimeline([
      {
        custom: true,
        display: "grid",
        visibility: "visible",
        width: 800,
        height: 26
      }
    ]),
    false
  );
});

test("gated loudness ignores silence and quiet outliers", () => {
  const blocks = [-60, -20, -20, -21].map(core.energyFromLoudnessDb);
  const loudnessDb = core.gatedLoudnessDb(blocks);
  assert.ok(loudnessDb > -21 && loudnessDb < -19.5);
  assert.equal(core.gatedLoudnessDb([]), null);
});

test("normalization gain uses the louder target and configurable boost cap", () => {
  assert.equal(core.normalizationGainDb({ loudnessDb: -30 }), 12);
  assert.equal(core.normalizationGainDb({ loudnessDb: -30, maximumDb: 3 }), 3);
  assert.equal(core.normalizationGainDb({ loudnessDb: -40, maximumDb: 60 }), 26);
  assert.equal(core.normalizationGainDb({ loudnessDb: -4 }), -10);
  assert.equal(core.normalizationGainDb({ loudnessDb: 0 }), -14);
  assert.equal(core.normalizationGainDb({ loudnessDb: -14 }), 0);
});

test("hybrid normalization combines integrated, short-term, and peak limits", () => {
  assert.deepEqual(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -30,
      shortTermLoudnessDb: -18,
      peakDb: -6
    }),
    {
      gainDb: 3,
      integratedGainDb: 14,
      shortTermLimitDb: 6,
      peakLimitDb: 3,
      effectiveMaximumDb: 12
    }
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -16,
      shortTermLoudnessDb: -12,
      peakDb: -3
    }).gainDb,
    0
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -11,
      shortTermLoudnessDb: -8,
      peakDb: -1
    }).gainDb,
    -5
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -24,
      shortTermLoudnessDb: -20,
      peakDb: -12
    }).gainDb,
    8
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -32,
      shortTermLoudnessDb: -30,
      peakDb: -20,
      anchorConfirmed: false
    }).gainDb,
    6
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -32,
      shortTermLoudnessDb: -30,
      peakDb: -20,
      maximumDb: 3,
      anchorConfirmed: false
    }).gainDb,
    3
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -22,
      shortTermLoudnessDb: -20,
      peakDb: -10,
      targetDb: -20
    }).gainDb,
    2
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -5,
      shortTermLoudnessDb: -3,
      peakDb: -1,
      targetDb: -24
    }).gainDb,
    -19
  );
  assert.equal(
    core.hybridNormalizationGainDb({
      integratedLoudnessDb: -5,
      shortTermLoudnessDb: -3,
      peakDb: -1,
      targetDb: -60
    }).gainDb,
    -55
  );
});

test("normalization confirms a useful anchor by level, contrast, or peak", () => {
  assert.equal(
    core.normalizationAnchorConfirmed({
      shortTermLoudnessDb: -23,
      medianLoudnessDb: -25,
      peakDb: -18
    }),
    true
  );
  assert.equal(
    core.normalizationAnchorConfirmed({
      shortTermLoudnessDb: -27,
      medianLoudnessDb: -34,
      peakDb: -18
    }),
    true
  );
  assert.equal(
    core.normalizationAnchorConfirmed({
      shortTermLoudnessDb: -30,
      medianLoudnessDb: -30,
      peakDb: -10
    }),
    true
  );
  assert.equal(
    core.normalizationAnchorConfirmed({
      shortTermLoudnessDb: -30,
      medianLoudnessDb: -31,
      peakDb: -18
    }),
    false
  );
});

test("normalization measures source loudness independently of player volume", () => {
  const sourceEnergy = core.energyFromLoudnessDb(-20);
  const measured = core.sourceLevelBeforeMediaVolume(
    sourceEnergy * 0.25,
    0.2,
    0.5
  );

  assert.ok(Math.abs(core.loudnessDbFromEnergy(measured.energy) - -20) < 0.001);
  assert.equal(measured.peak, 0.4);
  assert.equal(core.sourceLevelBeforeMediaVolume(0, 0, 0), null);
  assert.equal(core.sourceLevelBeforeMediaVolume(sourceEnergy, 0.4, 1, true), null);
});

test("compressor threshold follows player volume before source correction", () => {
  assert.equal(core.compressorThresholdForMediaVolume(-18, 1), -18);
  assert.ok(
    Math.abs(core.compressorThresholdForMediaVolume(-18, 0.5) - -24.0206) <
      0.001
  );
  assert.equal(core.compressorThresholdForMediaVolume(-18, 0), -78);
});

test("reads only the current 400ms tail from analyser buffers", () => {
  const samples = new Float32Array([10, -10, 0.25, -0.5, 0.75, -1]);
  assert.ok(Math.abs(core.meanSquareTail(samples, 4) - 0.46875) < 1e-7);
  assert.equal(core.maximumAbsoluteTail(samples, 4), 1);
  assert.equal(core.meanSquareTail(samples, 0), 0);
  assert.equal(core.maximumAbsoluteTail([], 4), 0);
});

test("time-based histories expire independently of timer frequency", () => {
  const samples = [];
  core.appendTimedSample(samples, 1, 1000, 1000);
  core.appendTimedSample(samples, 2, 1500, 1000);
  core.appendTimedSample(samples, 3, 2101, 1000);
  assert.deepEqual(core.timedSampleValues(samples), [2, 3]);
  core.appendTimedSample(samples, Number.NaN, 2600, 1000);
  assert.deepEqual(core.timedSampleValues(samples), [3]);
});

test("long-term anchors use P95 loudness and P99 sample peaks", () => {
  const shortTerms = [...Array(95).fill(-20), ...Array(4).fill(-10), 0];
  const peaks = [...Array(99).fill(0.25), 1];
  assert.ok(Math.abs(core.percentile(shortTerms, 0.95) - -19.5) < 1e-7);
  assert.ok(Math.abs(core.percentilePeakDb(peaks, 0.99) - -11.78446) < 1e-4);
  assert.equal(core.percentile([], 0.95), null);
  assert.equal(core.percentilePeakDb([], 0.99), Number.NEGATIVE_INFINITY);
  assert.ok(
    Math.abs(
      core.percentilePeakDb([...Array(98).fill(0.25), 1, 1], 0.99)
    ) < 1e-7
  );
});

test("limiter trim cancels its fixed makeup gain below threshold", () => {
  assert.equal(core.compressorMakeupTrimDb(-1, 20), -0.57);
  assert.equal(core.compressorMakeupTrimDb(-1, 1), 0);
  assert.equal(core.compressorMakeupTrimDb(Number.NaN, 20), 0);
});

test("adaptive loudness uses the complete relative-gated programme", () => {
  const loudnessBlocks = [
    ...Array(5).fill(-55),
    ...Array(96).fill(-22),
    ...Array(4).fill(-4)
  ];
  const stats = core.adaptiveLoudnessStats(
    loudnessBlocks.map(core.energyFromLoudnessDb)
  );

  assert.ok(stats.loudnessDb > -16.7 && stats.loudnessDb < -16.4);
  assert.ok(stats.medianDb > -22.1 && stats.medianDb < -21.9);
  assert.equal(stats.sampleCount, 100);

  const sparseVoiceStats = core.adaptiveLoudnessStats(
    [...Array(475).fill(-35), ...Array(5).fill(-10)].map(
      core.energyFromLoudnessDb
    )
  );
  assert.ok(
    sparseVoiceStats.loudnessDb > -29 && sparseVoiceStats.loudnessDb < -28
  );
});

test("short-term safety only lowers the long-term gain ceiling", () => {
  assert.equal(
    core.normalizationSafetyCeilingDb({
      shortTermLoudnessDb: -24,
      renderedPeakDb: -18
    }),
    12
  );
  assert.equal(
    core.normalizationSafetyCeilingDb({
      shortTermLoudnessDb: -24,
      renderedPeakDb: -18,
      maximumDb: 30
    }),
    13
  );
  assert.equal(
    core.normalizationSafetyCeilingDb({
      shortTermLoudnessDb: -10,
      renderedPeakDb: -18
    }),
    -1
  );
  assert.equal(
    core.normalizationSafetyCeilingDb({
      shortTermLoudnessDb: -24,
      renderedPeakDb: -12
    }),
    9
  );
  assert.equal(
    core.normalizationSafetyCeilingDb({
      shortTermLoudnessDb: -24,
      renderedPeakDb: -1
    }),
    0
  );
  assert.equal(
    core.normalizationSafetyCeilingDb({
      shortTermLoudnessDb: -3,
      renderedPeakDb: -1,
      shortTermCeilingDb: -20
    }),
    -17
  );
  assert.ok(Math.abs(core.maximumPeakDb([0, 0.25, 0.5]) + 6.0206) < 0.001);
  assert.equal(core.maximumPeakDb([]), Number.NEGATIVE_INFINITY);
});

test("converts the K-weighting high-pass Q to the Web Audio dB unit", () => {
  assert.ok(
    Math.abs(core.biquadQDbFromLinear(0.5003270373) - -6.01492055) < 1e-7
  );
  assert.equal(core.biquadQDbFromLinear(0), 0);
});

test("adaptive gain ignores small changes and lowers faster than it raises", () => {
  assert.equal(core.stepAdaptiveGainDb(2, 2.5), 2);
  assert.equal(core.stepAdaptiveGainDb(2, 4), 2.25);
  assert.equal(core.stepAdaptiveGainDb(2, -2), 1);
  assert.equal(core.stepAdaptiveGainDb(2, 1.4), 2);
});

test("reports the player-selected latency mode without changing it", () => {
  assert.equal(core.trackLatencyMode({ kind: "low-latency" }), "LL");
  assert.equal(core.trackLatencyMode({ kind: "low-latency-main" }), "LL");
  assert.equal(core.trackLatencyMode({ kind: "main" }), "일반");
  assert.equal(core.trackLatencyMode(null), "");
});

test("detects transparent computed colors", () => {
  assert.equal(core.colorAlpha("transparent"), 0);
  assert.equal(core.colorAlpha("rgba(20, 21, 23, 0)"), 0);
  assert.equal(core.colorAlpha("rgba(20, 21, 23, 0.5)"), 0.5);
  assert.equal(core.colorAlpha("rgb(20, 21, 23)"), 1);
});

test("chat lookup stays inside the current React item", () => {
  const current = {
    time: 1000,
    content: "current",
    originalContent: "current"
  };
  const adjacent = {
    time: 2000,
    content: "adjacent",
    originalContent: "adjacent"
  };
  const fiber = {
    child: { pendingProps: { chatMessage: current } },
    sibling: { pendingProps: { chatMessage: adjacent } },
    return: { memoizedProps: { chatMessage: adjacent } }
  };

  assert.equal(core.findContainedChatMessage(fiber), current);
  assert.equal(
    core.findContainedChatMessage({ sibling: { pendingProps: { chatMessage: adjacent } } }),
    null
  );
});
