const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const core = require("../src/feature-core.js");
const config = require("../src/settings.js");
const featureSource = fs.readFileSync(
  path.join(root, "src/features.js"),
  "utf8"
);

function createRuntime() {
  const windowListeners = new Map();
  let nowMs = 0;
  const sandbox = {
    __CHZZK_EX_FEATURE_CORE__: core,
    __CHZZK_EX_CONFIG__: config,
    console,
    document: {
      documentElement: null,
      addEventListener() {},
      querySelectorAll() {
        return [];
      }
    },
    location: {
      href: "https://chzzk.naver.com/live/test-channel",
      pathname: "/live/test-channel"
    },
    performance: {
      now() {
        return nowMs;
      }
    },
    setInterval() {
      return 1;
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    HTMLMediaElement: {
      HAVE_METADATA: 1,
      HAVE_CURRENT_DATA: 2
    },
    HTMLVideoElement: class {},
    HTMLElement: class {},
    MutationObserver: class {},
    fetch() {
      throw new Error("unexpected fetch in audio test");
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = (type, listener) => {
    windowListeners.set(type, listener);
  };
  sandbox.postMessage = () => {};

  const instrumentedSource = featureSource.replace(
    "const loudness = {",
    "const loudness = globalThis.__CHZZK_EX_TEST_LOUDNESS__ = {"
  ).replace(
    "function applySettings(nextSettings) {",
    "const applySettings = globalThis.__CHZZK_EX_TEST_APPLY_SETTINGS__ = function applySettings(nextSettings) {"
  );
  assert.notEqual(
    instrumentedSource,
    featureSource,
    "the loudness object must remain available for focused runtime tests"
  );
  vm.runInNewContext(instrumentedSource, sandbox, {
    filename: "src/features.js"
  });

  return {
    loudness: sandbox.__CHZZK_EX_TEST_LOUDNESS__,
    setNow(value) {
      nowMs = value;
    },
    updateSettings(settings) {
      assert.equal(
        typeof sandbox.__CHZZK_EX_TEST_APPLY_SETTINGS__,
        "function"
      );
      sandbox.__CHZZK_EX_TEST_APPLY_SETTINGS__(settings);
    }
  };
}

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }

  cancelAndHoldAtTime(at) {
    this.calls.push(["hold", at]);
  }

  cancelScheduledValues(at) {
    this.calls.push(["cancel", at]);
  }

  setValueAtTime(value, at) {
    this.value = value;
    this.calls.push(["value", value, at]);
  }

  setTargetAtTime(value, at, timeConstant) {
    this.calls.push(["target", value, at, timeConstant]);
  }

  targetCount() {
    return this.calls.filter(([type]) => type === "target").length;
  }

  lastTarget() {
    return this.calls.filter(([type]) => type === "target").at(-1)?.[1];
  }
}

class FakeAudioNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
  }

  connect(target, output = 0, input = 0) {
    this.connections.push({ target, output, input });
    return target;
  }

  disconnect() {}
}

function compressorNode(kind = "compressor") {
  return Object.assign(new FakeAudioNode(kind), {
    threshold: new FakeAudioParam(),
    knee: new FakeAudioParam(),
    ratio: new FakeAudioParam(1),
    attack: new FakeAudioParam(),
    release: new FakeAudioParam()
  });
}

function gainNode(kind = "gain") {
  return Object.assign(new FakeAudioNode(kind), {
    gain: new FakeAudioParam(1)
  });
}

function totalTargets(...nodes) {
  return nodes.reduce((total, node) => {
    const parameters = [
      node.threshold,
      node.knee,
      node.ratio,
      node.attack,
      node.release,
      node.gain
    ].filter(Boolean);
    return total + parameters.reduce(
      (count, parameter) => count + parameter.targetCount(),
      0
    );
  }, 0);
}

function createAudioContext({ failAtChannelSplitter = false } = {}) {
  const creationOrder = [];
  let gainIndex = 0;
  let compressorIndex = 0;
  const destination = new FakeAudioNode("destination");

  return {
    currentTime: 7,
    sampleRate: 44100,
    destination,
    creationOrder,
    createGain() {
      creationOrder.push("gain");
      gainIndex += 1;
      return gainNode(`gain-${gainIndex}`);
    },
    createDynamicsCompressor() {
      creationOrder.push("compressor");
      compressorIndex += 1;
      return compressorNode(`compressor-${compressorIndex}`);
    },
    createChannelSplitter() {
      creationOrder.push("splitter");
      if (failAtChannelSplitter) {
        throw new Error("downstream setup failed");
      }
      return new FakeAudioNode("splitter");
    },
    createAnalyser() {
      creationOrder.push("analyser");
      return Object.assign(new FakeAudioNode("analyser"), {
        fftSize: 0,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData() {}
      });
    },
    createBiquadFilter() {
      creationOrder.push("biquad");
      return Object.assign(new FakeAudioNode("biquad"), {
        frequency: new FakeAudioParam(),
        gain: new FakeAudioParam(),
        Q: new FakeAudioParam()
      });
    },
    createMediaElementSource() {
      creationOrder.push("media-source");
      return new FakeAudioNode("media-source");
    }
  };
}

test("audio parameter fallback holds the current value without cancelAndHold", () => {
  const { loudness } = createRuntime();
  const calls = [];
  const parameter = {
    value: 0.75,
    cancelScheduledValues(at) {
      calls.push(["cancel", at]);
    },
    setValueAtTime(value, at) {
      calls.push(["value", value, at]);
    }
  };
  loudness.context = { currentTime: 2 };

  loudness.holdAudioParam(parameter);

  assert.deepEqual(calls, [
    ["cancel", 2],
    ["value", 0.75, 2]
  ]);
});

test("compressor volume compensation removes only the volume-dependent makeup delta", () => {
  assert.equal(typeof core.compressorVolumeCompensationDb, "function");
  assert.equal(core.compressorVolumeCompensationDb(-18, 3, 1), 0);
  assert.equal(core.compressorVolumeCompensationDb(-18, 1, 0.5), 0);
  assert.ok(
    Math.abs(
      core.compressorVolumeCompensationDb(-18, 3, 0.5) +
        2.40823996531185
    ) < 1e-9
  );
  assert.ok(
    Math.abs(core.compressorVolumeCompensationDb(-18, 3, 0.1) + 8) < 1e-9
  );
});

test("compressor trim follows media volume without rescheduling unchanged parameters", () => {
  const { loudness } = createRuntime();
  const compressor = compressorNode();
  const compressorTrim = gainNode("compressor-trim");
  loudness.context = { currentTime: 3 };
  loudness.video = { volume: 0.5 };
  loudness.graph = { compressor, compressorTrim };
  loudness.compressor = compressor;
  loudness.compressorTrim = compressorTrim;

  loudness.configureCompressor(true);
  const firstScheduleCount = totalTargets(compressor, compressorTrim);
  assert.equal(firstScheduleCount, 6);
  assert.ok(
    Math.abs(
      compressorTrim.gain.lastTarget() -
        10 ** (
          core.compressorVolumeCompensationDb(-18, 3, 0.5) / 20
        )
    ) < 1e-12
  );

  loudness.configureCompressor(true);
  assert.equal(totalTargets(compressor, compressorTrim), firstScheduleCount);

  loudness.video.volume = 0.25;
  loudness.configureCompressor(true);
  assert.equal(totalTargets(compressor, compressorTrim), firstScheduleCount * 2);
});

test("normalization preserves native makeup and only trims volume-dependent gain", () => {
  const runtime = createRuntime();
  runtime.updateSettings({ normalizeVolume: true, compressAudio: true });

  const fullVolume = runtime.loudness.compressorConfiguration({ volume: 1 });
  const halfVolume = runtime.loudness.compressorConfiguration({ volume: 0.5 });
  const expectedHalfTrimDb = core.compressorVolumeCompensationDb(
    -18,
    3,
    0.5
  );

  assert.equal(fullVolume.trimGain, 1);
  assert.ok(
    Math.abs(halfVolume.trimGain - 10 ** (expectedHalfTrimDb / 20)) < 1e-12
  );
  assert.ok(halfVolume.trimGain < fullVolume.trimGain);

  runtime.updateSettings({ normalizeVolume: false, compressAudio: true });
  assert.equal(
    runtime.loudness.compressorConfiguration({ volume: 0.5 }).trimGain,
    halfVolume.trimGain
  );
});

test("compression-only mode keeps the safety limiter enabled and cached", () => {
  const runtime = createRuntime();
  runtime.updateSettings({ normalizeVolume: false, compressAudio: true });

  const limiter = compressorNode("limiter");
  const limiterTrim = gainNode("limiter-trim");
  runtime.loudness.context = { currentTime: 4 };
  runtime.loudness.graph = { limiter, limiterTrim };
  runtime.loudness.limiter = limiter;
  runtime.loudness.limiterTrim = limiterTrim;

  runtime.loudness.configureLimiter();
  assert.equal(limiter.ratio.lastTarget(), 20);
  const firstScheduleCount = totalTargets(limiter, limiterTrim);
  assert.equal(firstScheduleCount, 6);

  runtime.loudness.configureLimiter();
  assert.equal(totalTargets(limiter, limiterTrim), firstScheduleCount);
});

test("audio graph measures the volume-compensated compressor output", () => {
  const runtime = createRuntime();
  runtime.updateSettings({ normalizeVolume: false, compressAudio: true });
  const context = createAudioContext();
  runtime.loudness.context = context;

  const graph = runtime.loudness.createGraph({ volume: 0.5 });
  const targets = (node) => node.connections.map(({ target }) => target);

  assert.equal(context.creationOrder.at(-1), "media-source");
  assert.ok(graph.compressorTrim, "graph must retain its compressor trim node");
  assert.ok(targets(graph.compressor).includes(graph.compressorTrim));
  assert.ok(targets(graph.compressorTrim).includes(graph.outputGain));
  assert.ok(targets(graph.compressorTrim).includes(graph.splitter));
  assert.equal(graph.limiter.ratio.value, 20);
});

test("downstream graph failure cannot consume the media element source", () => {
  const { loudness } = createRuntime();
  const context = createAudioContext({ failAtChannelSplitter: true });
  loudness.context = context;

  assert.throws(
    () => loudness.createGraph({ volume: 1 }),
    /downstream setup failed/
  );
  assert.equal(
    context.creationOrder.includes("media-source"),
    false,
    "createMediaElementSource must be the final, non-recoverable setup step"
  );
});

test("normalization warm-up counts only blocks still in the active history window", () => {
  const runtime = createRuntime();
  runtime.updateSettings({ normalizeVolume: true, compressAudio: false });
  runtime.setNow(200000);

  const fillWithSignal = {
    getFloatTimeDomainData(samples) {
      samples.fill(0.1);
    }
  };
  const loudness = runtime.loudness;
  loudness.ensureGraph = () => {};
  loudness.context = { sampleRate: 10 };
  loudness.video = {
    muted: false,
    paused: false,
    playbackRate: 1,
    volume: 1
  };
  loudness.outputGain = {};
  loudness.analysers = [fillWithSignal];
  loudness.peakAnalysers = [fillWithSignal];
  loudness.sampleBuffers = [new Float32Array(8)];
  loudness.peakSampleBuffers = [new Float32Array(8)];
  loudness.blockEnergies = [{ at: 0, value: 0.01 }];
  loudness.activeBlockCount = 30;
  loudness.nextGainUpdateAt = 0;
  loudness.applySafetyGain = () => false;
  loudness.currentStats = () => ({
    loudnessDb: -20,
    medianDb: -20,
    shortTermAnchorDb: -20,
    peakAnchorDb: -10,
    anchorConfirmed: true
  });
  let adaptationCount = 0;
  loudness.applyAdaptiveGain = () => {
    adaptationCount += 1;
    return {};
  };

  loudness.tick();

  assert.equal(loudness.blockEnergies.length, 1);
  assert.equal(loudness.activeBlockCount, 1);
  assert.equal(adaptationCount, 0);
});

test("normalization peak anchor measures before player volume", () => {
  const runtime = createRuntime();
  runtime.updateSettings({ normalizeVolume: true, compressAudio: false });

  const fillWithSignal = {
    getFloatTimeDomainData(samples) {
      samples.fill(0.1);
    }
  };
  const loudness = runtime.loudness;
  loudness.ensureGraph = () => {};
  loudness.context = { sampleRate: 10 };
  loudness.video = {
    muted: false,
    paused: false,
    playbackRate: 1,
    volume: 0.5
  };
  loudness.outputGain = {};
  loudness.analysers = [fillWithSignal];
  loudness.peakAnalysers = [fillWithSignal];
  loudness.sampleBuffers = [new Float32Array(8)];
  loudness.peakSampleBuffers = [new Float32Array(8)];
  loudness.applySafetyGain = () => false;

  loudness.tick();

  const [sourcePeak] = core.timedSampleValues(loudness.sourcePeakHistory);
  assert.ok(Math.abs(sourcePeak - 0.2) < 1e-6);
});

test("loud-part anchor needs a stable sample history", () => {
  const runtime = createRuntime();
  runtime.setNow(1000);
  const loudness = runtime.loudness;
  loudness.blockEnergies = Array.from({ length: 30 }, () => ({
    at: 1000,
    value: core.energyFromLoudnessDb(-20)
  }));
  loudness.shortTermLoudnessHistory = Array.from({ length: 19 }, () => ({
    at: 1000,
    value: -16
  }));
  loudness.sourcePeakHistory = [{ at: 1000, value: 0.25 }];

  assert.equal(loudness.currentStats().anchorConfirmed, false);
  loudness.shortTermLoudnessHistory.push({ at: 1000, value: -16 });
  assert.equal(loudness.currentStats().anchorConfirmed, true);
});
