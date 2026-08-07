(() => {
  if (window.__CHZZK_EX_FEATURES__) {
    return;
  }

  const core = globalThis.__CHZZK_EX_FEATURE_CORE__;
  const config = globalThis.__CHZZK_EX_CONFIG__;
  delete globalThis.__CHZZK_EX_FEATURE_CORE__;

  if (!core || !config) {
    console.error("[CHZZK EX] feature startup modules were not loaded");
    return;
  }

  Object.defineProperty(window, "__CHZZK_EX_FEATURES__", {
    value: true,
    configurable: false
  });

  const MESSAGE_SOURCE = "chzzk-ex";
  const {
    DEFAULT_SETTINGS,
    NORMALIZATION_MAX_BOOST_RANGE,
    COMPRESSOR_PRESETS
  } = config;
  const EVENT_TOKEN = String.fromCharCode(97, 100);
  const EVENT_TITLE_TOKEN = `${EVENT_TOKEN[0].toUpperCase()}${EVENT_TOKEN.slice(1)}`;
  const AUXILIARY_VIDEO_SELECTOR = [
    `[data-role='${EVENT_TOKEN}VideoContainerEl']`,
    `[data-role='ima${EVENT_TITLE_TOKEN}ContainerEl']`,
    `[data-role='gv${EVENT_TITLE_TOKEN}ContainerEl']`,
    `#mid${EVENT_TITLE_TOKEN}VideoContainer`,
    `#mid${EVENT_TITLE_TOKEN}PlayerWrapper`
  ].join(", ");
  const CHAT_BLIND_TEXT = /(?:메시지가\s*블라인드|클린봇이\s*부적절|블라인드\s*처리)/i;
  const POWER_READY_TEXT =
    /(?:통나무\s*파워.*(?:배달\s*완료|받기|수령)|(?:배달\s*완료|받기|수령).*통나무\s*파워)/i;
  const POWER_ACTION_TEXT = /^(?:배달\s*완료|받기|수령)$/i;
  const LOUDNESS_MIN_BLOCKS = 40;
  const LOUDNESS_ADAPT_INTERVAL_BLOCKS = 20;
  const LOUDNESS_LONG_MAX_BLOCKS = 480;
  const LOUDNESS_SHORT_MAX_BLOCKS = 12;
  const LOUDNESS_SHORT_MIN_ACTIVE_BLOCKS = 4;
  const LOUDNESS_PEAK_MAX_BLOCKS = 60;
  const K_WEIGHTING_STAGE_ONE_FEEDFORWARD = [
    1.53512485958697,
    -2.69169618940638,
    1.19839281085285
  ];
  const K_WEIGHTING_STAGE_ONE_FEEDBACK = [
    1,
    -1.69065929318241,
    0.73248077421585
  ];
  const K_WEIGHTING_STAGE_TWO_FEEDFORWARD = [1, -2, 1];
  const K_WEIGHTING_STAGE_TWO_FEEDBACK = [
    1,
    -1.99004745483398,
    0.99007225036621
  ];
  const K_WEIGHTING_HIGHPASS_Q_DB = core.biquadQDbFromLinear(0.5003270373);

  let settings = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [
      key,
      typeof value === "boolean" ? false : value
    ])
  );
  let cachedMainVideo = null;
  let cachedMainVideoRoute = "";

  function log(...args) {
    if (settings.debug) {
      console.debug("[CHZZK EX Features]", ...args);
    }
  }

  function isLiveRoute() {
    return /^\/live\/[a-z0-9_-]+/i.test(location.pathname);
  }

  function channelIdFromLocation() {
    return location.pathname.match(/^\/live\/([a-z0-9_-]+)/i)?.[1] || "";
  }

  function mainVideo() {
    if (
      cachedMainVideoRoute === location.pathname &&
      cachedMainVideo?.isConnected &&
      !cachedMainVideo.closest(AUXILIARY_VIDEO_SELECTOR) &&
      cachedMainVideo.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      return cachedMainVideo;
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const video =
      videos.find(
        (video) =>
          !video.closest(AUXILIARY_VIDEO_SELECTOR) &&
          video.readyState >= HTMLMediaElement.HAVE_METADATA
      ) ||
      videos.find((video) => !video.closest(AUXILIARY_VIDEO_SELECTOR)) ||
      null;
    if (video?.readyState >= HTMLMediaElement.HAVE_METADATA) {
      cachedMainVideo = video;
      cachedMainVideoRoute = location.pathname;
    }
    return video;
  }

  function lastRangeEnd(ranges) {
    return ranges?.length ? ranges.end(ranges.length - 1) : null;
  }

  function seekableWindow(video) {
    if (!video?.seekable?.length) {
      return null;
    }

    const index = video.seekable.length - 1;
    const start = video.seekable.start(index);
    const end = video.seekable.end(index);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? { start, end, duration: end - start }
      : null;
  }

  function customTimelineSlider(element) {
    return element?.closest?.(".cng-timeline-assist[role='slider']") || null;
  }

  const timelineAssist = {
    activePointerId: null,
    slider: null,
    element: null,
    timelineVideo: null,
    timelineRoute: "",
    nativeTimelineVideo: null,
    nativeTimelineRoute: "",
    nativeTimelineAvailable: false,
    liveAnchorEnd: null,
    liveAnchorAt: 0,
    lastObservedEnd: null,
    displayDuration: 0,

    resetTimeline(video, range) {
      this.timelineVideo = video;
      this.timelineRoute = location.pathname;
      this.liveAnchorEnd = range.end;
      this.liveAnchorAt = performance.now();
      this.lastObservedEnd = range.end;
      this.displayDuration = range.duration;
      playbackState.manualTimelinePosition = false;
    },

    liveEdge(video, range) {
      const routeChanged = this.timelineRoute !== location.pathname;
      const timelineRestarted =
        Number.isFinite(this.lastObservedEnd) &&
        range.end < this.lastObservedEnd - 2;
      if (video !== this.timelineVideo || routeChanged || timelineRestarted) {
        this.resetTimeline(video, range);
      }

      const now = performance.now();
      if (!playbackState.manualTimelinePosition) {
        this.liveAnchorEnd = range.end;
        this.liveAnchorAt = now;
        this.displayDuration = range.duration;
      }
      this.lastObservedEnd = range.end;
      return core.projectLiveEdge(
        this.liveAnchorEnd,
        (now - this.liveAnchorAt) / 1000
      );
    },

    remove() {
      this.element?.remove();
      this.element = null;
      this.activePointerId = null;
      this.slider = null;
    },

    mount(player) {
      if (this.element?.isConnected && this.element.parentElement === player) {
        return this.element;
      }
      this.remove();
      const element = document.createElement("div");
      element.className = "cng-timeline-assist";
      element.setAttribute("role", "slider");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", "타임라인 보조");
      const track = document.createElement("span");
      const fill = document.createElement("span");
      const handle = document.createElement("span");
      const start = document.createElement("span");
      const position = document.createElement("span");
      const live = document.createElement("span");
      track.className = "cng-timeline-assist__track";
      fill.className = "cng-timeline-assist__fill";
      handle.className = "cng-timeline-assist__handle";
      start.className = "cng-timeline-assist__start";
      position.className = "cng-timeline-assist__position";
      live.className = "cng-timeline-assist__live";
      live.textContent = "LIVE";
      track.append(fill, handle);
      element.append(track, start, position, live);
      player.appendChild(element);
      this.element = element;
      return element;
    },

    observeNativeTimeline(player, video) {
      if (
        video !== this.nativeTimelineVideo ||
        location.pathname !== this.nativeTimelineRoute
      ) {
        this.nativeTimelineVideo = video;
        this.nativeTimelineRoute = location.pathname;
        this.nativeTimelineAvailable = false;
      }

      const candidates = Array.from(
        player.querySelectorAll(
          [
            ".pzp-pc-progress-slider[role='slider']",
            ".pzp-pc__progress-slider[role='slider']",
            ".pzp-progress-slider[role='slider']",
            "[class*='progress-slider'][role='slider']",
            "[data-role*='progress'][role='slider']"
          ].join(", ")
        )
      ).map((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return {
          custom: element.classList.contains("cng-timeline-assist"),
          display: style.display,
          visibility: style.visibility,
          width: bounds.width,
          height: bounds.height
        };
      });
      if (core.hasUsableNativeTimeline(candidates)) {
        this.nativeTimelineAvailable = true;
      }
      return this.nativeTimelineAvailable;
    },

    tick() {
      const video = mainVideo();
      const range = seekableWindow(video);
      if (!settings.timelineAssist || !isLiveRoute() || !video || !range || range.duration > 300) {
        this.remove();
        return;
      }

      const player =
        video.closest(".pzp-pc") ||
        video.closest("[class*='video_player']") ||
        video.parentElement;
      if (!player) {
        this.remove();
        return;
      }

      if (this.observeNativeTimeline(player, video)) {
        this.remove();
        return;
      }

      const element = this.mount(player);
      const liveEdge = this.liveEdge(video, range);
      const behind = Math.max(0, liveEdge - video.currentTime);
      const playerSaysLive = player.classList?.contains("pzp-pc--onlive");
      const atLiveEdge = core.isAtLiveEdge(
        playbackState.manualTimelinePosition,
        playerSaysLive,
        behind
      );
      const ratio = atLiveEdge
        ? 1
        : core.timelineProgress(behind, this.displayDuration);
      element.style.setProperty("--cng-timeline-progress", `${ratio * 100}%`);
      element.querySelector(".cng-timeline-assist__start").textContent =
        core.formatOffset(this.displayDuration);
      element.querySelector(".cng-timeline-assist__position").textContent =
        atLiveEdge ? "현재 LIVE" : `현재 ${core.formatOffset(behind)}`;
      element.setAttribute("aria-valuemin", String(-Math.round(this.displayDuration)));
      element.setAttribute("aria-valuemax", "0");
      element.setAttribute("aria-valuenow", String(-Math.round(behind)));
      element.setAttribute(
        "aria-valuetext",
        behind < 1 ? "실시간" : `실시간 ${Math.round(behind)}초 전`
      );
    },

    seek(event, slider) {
      const video = mainVideo();
      const range = seekableWindow(video);
      if (!video || !range || range.duration > 300) {
        return false;
      }

      const bounds =
        slider.querySelector?.(".cng-timeline-assist__track")?.getBoundingClientRect() ||
        slider.getBoundingClientRect();
      if (bounds.width <= 0) {
        return false;
      }

      const ratio = (event.clientX - bounds.left) / bounds.width;
      const target = core.timelineSeekTarget(
        range.start,
        range.end,
        timelineAssist.liveEdge(video, range),
        timelineAssist.displayDuration,
        ratio
      );
      if (target === null) {
        return false;
      }

      video.currentTime = target;
      playbackState.manualTimelinePosition = target < range.end - 2;
      return true;
    },

    onKeyDown(event) {
      const slider = event.target?.closest?.(".cng-timeline-assist[role='slider']");
      if (!settings.timelineAssist || !slider) {
        return;
      }
      const video = mainVideo();
      const range = seekableWindow(video);
      if (!video || !range) {
        return;
      }

      timelineAssist.liveEdge(video, range);

      let target = null;
      if (event.key === "ArrowLeft" || event.key === "PageDown") {
        target = video.currentTime - 5;
      } else if (event.key === "ArrowRight" || event.key === "PageUp") {
        target = video.currentTime + 5;
      } else if (event.key === "Home") {
        target = range.start;
      } else if (event.key === "End") {
        target = range.end - 0.25;
      }
      if (target === null) {
        return;
      }

      video.currentTime = core.clamp(target, range.start, range.end - 0.25);
      playbackState.manualTimelinePosition = video.currentTime < range.end - 2;
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    onPointerDown(event) {
      if (!settings.timelineAssist || event.button !== 0) {
        return;
      }

      const slider = customTimelineSlider(event.target);
      if (!slider || !timelineAssist.seek(event, slider)) {
        return;
      }

      timelineAssist.activePointerId = event.pointerId;
      timelineAssist.slider = slider;
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    onPointerMove(event) {
      if (
        timelineAssist.activePointerId !== event.pointerId ||
        !timelineAssist.slider
      ) {
        return;
      }

      timelineAssist.seek(event, timelineAssist.slider);
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    onPointerUp(event) {
      if (timelineAssist.activePointerId !== event.pointerId) {
        return;
      }

      if (timelineAssist.slider) {
        timelineAssist.seek(event, timelineAssist.slider);
      }
      timelineAssist.activePointerId = null;
      timelineAssist.slider = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    start() {
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("pointermove", this.onPointerMove, true);
      document.addEventListener("pointerup", this.onPointerUp, true);
      document.addEventListener("pointercancel", this.onPointerUp, true);
      document.addEventListener("keydown", this.onKeyDown, true);
      setInterval(() => this.tick(), 250);
    }
  };

  const playbackState = {
    manualTimelinePosition: false,
    adapter: null,
    nextAdapterSearchAt: 0,

    findCore(instance, depth = 0, seen = new Set()) {
      if (!instance || depth > 12 || seen.has(instance)) {
        return null;
      }
      seen.add(instance);
      if (typeof instance.getVideoTracksList === "function") {
        return instance;
      }
      for (const child of instance.$children || []) {
        const found = this.findCore(child, depth + 1, seen);
        if (found) {
          return found;
        }
      }
      return null;
    },

    findLegacyAdapter() {
      if (this.adapter?.player?.isConnected) {
        return this.adapter;
      }
      if (performance.now() < this.nextAdapterSearchAt) {
        return null;
      }

      const player = document.querySelector(".pzp-pc, .pzp");
      const candidates = [player, ...Array.from(player?.querySelectorAll("*") || [])];
      for (const element of candidates) {
        const vue = element?.__vue__;
        if (!vue) {
          continue;
        }
        const playerCore = this.findCore(vue);
        if (playerCore) {
          this.adapter = { player, playerCore };
          this.nextAdapterSearchAt = 0;
          return this.adapter;
        }
      }
      this.adapter = null;
      this.nextAdapterSearchAt = performance.now() + 5000;
      return null;
    },

    selectedTrack() {
      const currentPlayer = window.__player;
      if (currentPlayer?.videoTracks?.length) {
        return (
          currentPlayer.videoTracks[currentPlayer.videoTracks.selectedIndex] ||
          Array.from(currentPlayer.videoTracks).find((track) => track.selected) ||
          null
        );
      }
      const adapter = this.findLegacyAdapter();
      const tracks = Object.values(
        adapter?.playerCore?.getVideoTracksList?.() || {}
      );
      return tracks.find((track) => track?._selected || track?.selected) || null;
    },

    mode() {
      return core.trackLatencyMode(this.selectedTrack());
    },

    onClick(event) {
      const button = event.target?.closest?.("button");
      if (button && /^(실시간|LIVE)$/i.test((button.textContent || "").trim())) {
        playbackState.manualTimelinePosition = false;
      }
    },

    start() {
      document.addEventListener("click", this.onClick, true);
    }
  };

  const loudness = {
    context: null,
    video: null,
    graph: null,
    graphs: new WeakMap(),
    outputGain: null,
    compressor: null,
    analysers: [],
    sampleBuffers: [],
    peakAnalysers: [],
    peakSampleBuffers: [],
    blockEnergies: [],
    recentBlockEnergies: [],
    recentRenderedPeaks: [],
    gainDb: 0,
    longTermGainDb: 0,
    safetyCeilingDb: DEFAULT_SETTINGS.normalizationMaxBoostDb,
    shortTermLoudnessDb: Number.NEGATIVE_INFINITY,
    renderedPeakDb: Number.NEGATIVE_INFINITY,
    adaptiveApplied: false,
    activeBlockCount: 0,
    nextGainUpdate: LOUDNESS_MIN_BLOCKS,
    unlocked: false,
    resumePending: false,
    lastResumeAttemptAt: 0,
    lastSignalAt: 0,
    lastClipRiskLogAt: 0,
    lastPlaybackRate: null,
    failure: false,
    route: "",

    async unlock() {
      if (!settings.normalizeVolume && !settings.compressAudio) {
        return;
      }
      const context = loudness.ensureContext();
      if (!context) {
        return;
      }
      try {
        await context.resume();
      } catch {}
      if (context.state === "running") {
        loudness.unlocked = true;
        loudness.ensureGraph();
      }
    },

    ensureContext() {
      if (this.context) {
        return this.context;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.failure = true;
        return null;
      }
      try {
        try {
          this.context = new AudioContextClass({
            latencyHint: "playback",
            sampleRate: 48000
          });
        } catch {
          try {
            this.context = new AudioContextClass({ latencyHint: "playback" });
          } catch {
            this.context = new AudioContextClass();
          }
        }
        this.failure = false;
        return this.context;
      } catch (error) {
        log("audio context unavailable", error);
        this.failure = true;
        return null;
      }
    },

    tryAutomaticResume(video) {
      if (!video || video.paused || video.muted || !(video.volume > 0)) {
        return false;
      }
      const context = this.ensureContext();
      if (!context) {
        return false;
      }
      if (context.state === "running") {
        this.unlocked = true;
        return true;
      }

      const now = performance.now();
      if (this.resumePending || now - this.lastResumeAttemptAt < 5000) {
        return false;
      }
      this.lastResumeAttemptAt = now;
      this.resumePending = true;
      context
        .resume()
        .catch(() => {})
        .finally(() => {
          this.resumePending = false;
          if (context.state === "running") {
            this.unlocked = true;
            this.ensureGraph();
          }
        });
      return false;
    },

    disconnectGraph(graph = this.graph) {
      try {
        graph?.source.disconnect();
      } catch {}
      if (graph) {
        graph.connected = false;
      }
    },

    detachVideo() {
      this.disconnectGraph();
      this.video = null;
      this.graph = null;
      this.outputGain = null;
      this.compressor = null;
      this.analysers = [];
      this.sampleBuffers = [];
      this.peakAnalysers = [];
      this.peakSampleBuffers = [];
    },

    applyGain(gainDb, timeConstant = 1.5) {
      if (!this.outputGain || !this.context) {
        return;
      }
      const now = this.context.currentTime;
      const currentGain = this.outputGain.gain.value;
      this.outputGain.gain.cancelScheduledValues(now);
      this.outputGain.gain.setValueAtTime(currentGain, now);
      this.outputGain.gain.setTargetAtTime(
        10 ** (gainDb / 20),
        now,
        timeConstant
      );
    },

    currentMaximumBoostDb() {
      const value = Number(settings.normalizationMaxBoostDb);
      return core.clamp(
        Number.isFinite(value)
          ? value
          : DEFAULT_SETTINGS.normalizationMaxBoostDb,
        NORMALIZATION_MAX_BOOST_RANGE.min,
        NORMALIZATION_MAX_BOOST_RANGE.max
      );
    },

    currentCompressorPreset() {
      return (
        COMPRESSOR_PRESETS[settings.compressorPreset] ||
        COMPRESSOR_PRESETS.medium
      );
    },

    configureCompressor(enabled = settings.compressAudio) {
      if (!this.compressor || !this.context) {
        return;
      }
      const now = this.context.currentTime;
      const preset = this.currentCompressorPreset();
      const values = {
        threshold: preset.thresholdDb,
        knee: preset.kneeDb,
        ratio: enabled ? preset.ratio : 1,
        attack: preset.attackSeconds,
        release: preset.releaseSeconds
      };
      for (const [name, value] of Object.entries(values)) {
        const parameter = this.compressor[name];
        parameter.cancelScheduledValues(now);
        parameter.setValueAtTime(parameter.value, now);
        parameter.setTargetAtTime(value, now, 0.05);
      }
    },

    resetMeasurement(route = channelIdFromLocation()) {
      this.route = route;
      this.blockEnergies = [];
      this.recentBlockEnergies = [];
      this.recentRenderedPeaks = [];
      this.adaptiveApplied = false;
      this.activeBlockCount = 0;
      this.nextGainUpdate = LOUDNESS_MIN_BLOCKS;
      this.longTermGainDb = 0;
      this.safetyCeilingDb = this.currentMaximumBoostDb();
      this.shortTermLoudnessDb = Number.NEGATIVE_INFINITY;
      this.renderedPeakDb = Number.NEGATIVE_INFINITY;
      this.lastSignalAt = 0;
      this.lastClipRiskLogAt = 0;
      this.lastPlaybackRate = null;
      this.gainDb = 0;
      this.applyGain(0, 0.2);
    },

    disableNormalization() {
      this.route = "";
      this.blockEnergies = [];
      this.recentBlockEnergies = [];
      this.recentRenderedPeaks = [];
      this.gainDb = 0;
      this.longTermGainDb = 0;
      this.safetyCeilingDb = this.currentMaximumBoostDb();
      this.shortTermLoudnessDb = Number.NEGATIVE_INFINITY;
      this.renderedPeakDb = Number.NEGATIVE_INFINITY;
      this.adaptiveApplied = false;
      this.activeBlockCount = 0;
      this.nextGainUpdate = LOUDNESS_MIN_BLOCKS;
      this.resumePending = false;
      this.lastResumeAttemptAt = 0;
      this.lastSignalAt = 0;
      this.lastClipRiskLogAt = 0;
      this.lastPlaybackRate = null;
      this.applyGain(0, 0.2);
    },

    connectGraph(graph) {
      if (graph.connected) {
        return;
      }
      graph.source.connect(graph.outputGain);
      graph.source.connect(graph.splitter);
      graph.connected = true;
    },

    createGraph(video) {
      const source = this.context.createMediaElementSource(video);
      const outputGain = this.context.createGain();
      const compressor = this.context.createDynamicsCompressor();
      const splitter = this.context.createChannelSplitter(2);
      const silent = this.context.createGain();
      const analysers = [];
      const peakAnalysers = [];
      const weightingNodes = [];
      const compressorPreset = this.currentCompressorPreset();

      compressor.threshold.value = compressorPreset.thresholdDb;
      compressor.knee.value = compressorPreset.kneeDb;
      compressor.ratio.value = settings.compressAudio
        ? compressorPreset.ratio
        : 1;
      compressor.attack.value = compressorPreset.attackSeconds;
      compressor.release.value = compressorPreset.releaseSeconds;
      outputGain.connect(compressor).connect(this.context.destination);
      silent.gain.value = 0;
      silent.connect(this.context.destination);

      for (let channel = 0; channel < 2; channel += 1) {
        const analyser = this.context.createAnalyser();
        const peakAnalyser = this.context.createAnalyser();

        analyser.fftSize = 32768;
        analyser.smoothingTimeConstant = 0;
        peakAnalyser.fftSize = 32768;
        peakAnalyser.smoothingTimeConstant = 0;

        if (
          this.context.sampleRate === 48000 &&
          typeof this.context.createIIRFilter === "function"
        ) {
          const stageOne = this.context.createIIRFilter(
            K_WEIGHTING_STAGE_ONE_FEEDFORWARD,
            K_WEIGHTING_STAGE_ONE_FEEDBACK
          );
          const stageTwo = this.context.createIIRFilter(
            K_WEIGHTING_STAGE_TWO_FEEDFORWARD,
            K_WEIGHTING_STAGE_TWO_FEEDBACK
          );
          splitter
            .connect(stageOne, channel)
            .connect(stageTwo)
            .connect(analyser);
          weightingNodes.push(stageOne, stageTwo);
        } else {
          const highShelf = this.context.createBiquadFilter();
          const highPass = this.context.createBiquadFilter();
          highShelf.type = "highshelf";
          highShelf.frequency.value = 1681.974;
          highShelf.gain.value = 4;
          highPass.type = "highpass";
          highPass.frequency.value = 38.135;
          highPass.Q.value = K_WEIGHTING_HIGHPASS_Q_DB;
          splitter
            .connect(highShelf, channel)
            .connect(highPass)
            .connect(analyser);
          weightingNodes.push(highShelf, highPass);
        }
        analyser.connect(silent);
        splitter.connect(peakAnalyser, channel).connect(silent);
        analysers.push(analyser);
        peakAnalysers.push(peakAnalyser);
      }

      const graph = {
        source,
        outputGain,
        compressor,
        splitter,
        analysers,
        peakAnalysers,
        weightingNodes,
        connected: false
      };
      this.connectGraph(graph);
      this.graphs.set(video, graph);
      return graph;
    },

    ensureGraph() {
      if (!settings.normalizeVolume && !settings.compressAudio) {
        this.applyGain(0, 0.2);
        this.configureCompressor(false);
        return;
      }

      const video = mainVideo();
      const route = channelIdFromLocation();
      if (!video) {
        return;
      }
      if (
        !this.unlocked ||
        !this.context ||
        this.context.state !== "running"
      ) {
        this.tryAutomaticResume(video);
        return;
      }
      if (video === this.video) {
        this.configureCompressor();
        if (route !== this.route) {
          this.resetMeasurement(route);
        }
        return;
      }

      this.detachVideo();
      try {
        this.failure = false;
        const graph = this.graphs.get(video) || this.createGraph(video);
        this.connectGraph(graph);

        this.video = video;
        this.graph = graph;
        this.outputGain = graph.outputGain;
        this.compressor = graph.compressor;
        this.configureCompressor();
        this.analysers = graph.analysers;
        this.peakAnalysers = graph.peakAnalysers;
        this.sampleBuffers = graph.analysers.map(
          (analyser) => new Float32Array(analyser.fftSize)
        );
        this.peakSampleBuffers = graph.peakAnalysers.map(
          (analyser) => new Float32Array(analyser.fftSize)
        );
        if (route !== this.route) {
          this.resetMeasurement(route);
        } else {
          this.applyGain(this.gainDb, 0.2);
        }
        log("loudness normalizer attached", {
          contextSampleRate: this.context.sampleRate,
          playbackRate: video.playbackRate,
          compressorEnabled: settings.compressAudio,
          compressorPreset: settings.compressorPreset,
          compressor: this.currentCompressorPreset()
        });
      } catch (error) {
        log("loudness normalizer unavailable", error);
        this.detachVideo();
        this.failure = true;
      }
    },

    currentStats() {
      return core.adaptiveLoudnessStats(this.blockEnergies);
    },

    updateSafetyStats() {
      const activeShortBlocks = this.recentBlockEnergies.filter(
        (energy) => core.loudnessDbFromEnergy(energy) >= -70
      );
      this.shortTermLoudnessDb =
        activeShortBlocks.length >= LOUDNESS_SHORT_MIN_ACTIVE_BLOCKS
          ? core.gatedLoudnessDb(this.recentBlockEnergies)
          : Number.NEGATIVE_INFINITY;
      this.renderedPeakDb = core.maximumPeakDb(this.recentRenderedPeaks);
      this.safetyCeilingDb = core.normalizationSafetyCeilingDb({
        shortTermLoudnessDb: this.shortTermLoudnessDb,
        renderedPeakDb: this.renderedPeakDb,
        maximumDb: this.currentMaximumBoostDb()
      });
      return this.safetyCeilingDb;
    },

    refreshMaximumBoost() {
      this.safetyCeilingDb = this.currentMaximumBoostDb();
      if (!settings.normalizeVolume || !this.adaptiveApplied) {
        return;
      }
      const stats = this.currentStats();
      if (!stats || !Number.isFinite(stats.loudnessDb)) {
        return;
      }
      this.updateSafetyStats();
      const requestedGainDb = core.normalizationGainDb({
        loudnessDb: stats.loudnessDb,
        maximumDb: this.currentMaximumBoostDb()
      });
      this.longTermGainDb = requestedGainDb;
      const targetGainDb = Math.min(requestedGainDb, this.safetyCeilingDb);
      if (Math.abs(targetGainDb - this.gainDb) < 0.05) {
        return;
      }
      const previousGainDb = this.gainDb;
      this.gainDb = targetGainDb;
      this.applyGain(
        targetGainDb,
        targetGainDb < previousGainDb ? 0.75 : 10
      );
    },

    applySafetyGain() {
      const safetyCeilingDb = this.updateSafetyStats();
      if (this.gainDb <= safetyCeilingDb + 0.05) {
        return false;
      }
      this.gainDb = safetyCeilingDb;
      this.applyGain(this.gainDb, 0.75);
      log("lowered loudness gain for recent audio", {
        gainDb: this.gainDb,
        longTermGainDb: this.longTermGainDb,
        shortTermLoudnessDb: this.shortTermLoudnessDb,
        renderedPeakDb: this.renderedPeakDb
      });
      return true;
    },

    applyAdaptiveGain(stats) {
      const requestedGainDb = core.normalizationGainDb({
        loudnessDb: stats.loudnessDb,
        maximumDb: this.currentMaximumBoostDb()
      });
      const wasApplied = this.adaptiveApplied;
      this.longTermGainDb = wasApplied
        ? core.stepAdaptiveGainDb(this.longTermGainDb, requestedGainDb)
        : requestedGainDb;
      this.adaptiveApplied = true;

      const targetGainDb = Math.min(
        this.longTermGainDb,
        this.safetyCeilingDb
      );
      let nextGainDb = this.gainDb;
      if (!wasApplied || targetGainDb < this.gainDb - 0.05) {
        nextGainDb = targetGainDb;
      } else if (targetGainDb > this.gainDb + 0.05) {
        nextGainDb = Math.min(targetGainDb, this.gainDb + 0.25);
      }
      if (Math.abs(nextGainDb - this.gainDb) >= 0.05) {
        const safetyLimited = this.safetyCeilingDb < this.longTermGainDb - 0.05;
        const timeConstant = nextGainDb < this.gainDb
          ? safetyLimited ? 0.75 : 4
          : 10;
        this.gainDb = nextGainDb;
        this.applyGain(this.gainDb, timeConstant);
      }
      return { requestedGainDb, targetGainDb };
    },

    status() {
      if (!settings.normalizeVolume && !settings.compressAudio) {
        return "꺼짐";
      }
      if (this.failure) {
        return "연결 실패";
      }
      if (!this.unlocked) {
        return this.resumePending ? "연결 시도" : "페이지 클릭 필요";
      }
      if (!this.context || this.context.state !== "running") {
        return "오디오 대기";
      }
      if (!this.analysers.length || !this.outputGain) {
        return "연결 중";
      }
      if (!settings.normalizeVolume) {
        return `압축 ${this.currentCompressorPreset().label}`;
      }
      if (performance.now() - this.lastSignalAt > 2000) {
        return "음성 대기";
      }
      const sign = this.gainDb >= 0 ? "+" : "";
      if (this.adaptiveApplied) {
        return `적응 ${sign}${this.gainDb.toFixed(1)}dB`;
      }
      return `측정 ${Math.min(
        99,
        Math.round((this.activeBlockCount / LOUDNESS_MIN_BLOCKS) * 100)
      )}%`;
    },

    tick() {
      this.ensureGraph();
      if (
        !settings.normalizeVolume ||
        !this.analysers.length ||
        !this.outputGain ||
        this.video?.paused
      ) {
        return;
      }

      let blockEnergy = 0;
      let inputPeak = 0;
      const playbackRate = this.video?.playbackRate;
      if (
        settings.debug &&
        Number.isFinite(playbackRate) &&
        playbackRate !== this.lastPlaybackRate
      ) {
        log("playback rate changed", {
          previous: this.lastPlaybackRate,
          current: playbackRate
        });
        this.lastPlaybackRate = playbackRate;
      }
      for (let channel = 0; channel < this.analysers.length; channel += 1) {
        const samples = this.sampleBuffers[channel];
        this.analysers[channel].getFloatTimeDomainData(samples);
        let squareSum = 0;
        for (const sample of samples) {
          squareSum += sample * sample;
        }
        blockEnergy += squareSum / samples.length;

        const peakSamples = this.peakSampleBuffers[channel];
        this.peakAnalysers[channel].getFloatTimeDomainData(peakSamples);
        for (const sample of peakSamples) {
          inputPeak = Math.max(inputPeak, Math.abs(sample));
        }
      }

      const renderedPeak = inputPeak;
      const mediaVolume = this.video?.volume;
      const sourceLevel = core.sourceLevelBeforeMediaVolume(
        blockEnergy,
        inputPeak,
        mediaVolume,
        this.video?.muted
      );
      this.recentBlockEnergies.push(sourceLevel?.energy || 0);
      this.recentRenderedPeaks.push(renderedPeak);
      if (this.recentBlockEnergies.length > LOUDNESS_SHORT_MAX_BLOCKS) {
        this.recentBlockEnergies.shift();
      }
      if (this.recentRenderedPeaks.length > LOUDNESS_PEAK_MAX_BLOCKS) {
        this.recentRenderedPeaks.shift();
      }
      this.applySafetyGain();
      if (!sourceLevel) {
        return;
      }
      blockEnergy = sourceLevel.energy;
      inputPeak = sourceLevel.peak;

      const projectedPeak = renderedPeak * 10 ** (this.gainDb / 20);
      if (
        settings.debug &&
        projectedPeak > 1 &&
        performance.now() - this.lastClipRiskLogAt >= 5000
      ) {
        this.lastClipRiskLogAt = performance.now();
        log("output peak may clip", {
          inputPeak,
          mediaVolume,
          gainDb: this.gainDb,
          projectedPeak,
          playbackRate
        });
      }

      if (core.loudnessDbFromEnergy(blockEnergy) < -70) {
        return;
      }
      this.lastSignalAt = performance.now();
      this.activeBlockCount += 1;
      this.blockEnergies.push(blockEnergy);
      if (this.blockEnergies.length > LOUDNESS_LONG_MAX_BLOCKS) {
        this.blockEnergies.shift();
      }

      if (this.activeBlockCount >= this.nextGainUpdate) {
        const stats = this.currentStats();
        if (stats && Number.isFinite(stats.loudnessDb)) {
          const gains = this.applyAdaptiveGain(stats);
          log("adapted loudness gain", {
            gainDb: this.gainDb,
            longTermGainDb: this.longTermGainDb,
            safetyCeilingDb: this.safetyCeilingDb,
            ...gains,
            ...stats,
            playbackRate: this.video?.playbackRate
          });
        }
        this.nextGainUpdate += LOUDNESS_ADAPT_INTERVAL_BLOCKS;
      }
    },

    start() {
      document.addEventListener("pointerdown", this.unlock, { capture: true });
      document.addEventListener("keydown", this.unlock, { capture: true });
      setInterval(() => this.tick(), 250);
    }
  };

  const watchTimer = {
    element: null,
    elapsedMs: 0,
    previousTick: performance.now(),
    route: "",

    reset() {
      this.elapsedMs = 0;
      this.previousTick = performance.now();
    },

    remove() {
      this.element?.remove();
      this.element = null;
    },

    mount() {
      if (this.element?.isConnected) {
        return;
      }

      const anchor =
        document.querySelector(".pzp-pc__bottom-buttons-left") ||
        document.querySelector(".pzp-pc__bottom-buttons") ||
        document.querySelector("[class*='pzp-pc__bottom-buttons']");
      if (!anchor) {
        return;
      }

      const element = document.createElement("span");
      element.className = "cng-watch-timer";
      element.title = "시청 시간";
      anchor.appendChild(element);
      this.element = element;
    },

    tick() {
      const now = performance.now();
      const route = channelIdFromLocation();
      if (route !== this.route) {
        this.route = route;
        this.reset();
      }

      if (!settings.watchTimer || !isLiveRoute()) {
        this.remove();
        this.previousTick = now;
        return;
      }

      const video = mainVideo();
      if (video && !video.paused && !video.ended && video.readyState >= 2) {
        this.elapsedMs += Math.min(65000, now - this.previousTick);
      }
      this.previousTick = now;
      this.mount();
      if (this.element) {
        this.element.textContent = core.formatDuration(this.elapsedMs / 1000);
      }
    },

    start() {
      setInterval(() => this.tick(), 250);
    }
  };

  const followingRefresh = {
    lastRefresh: Date.now(),

    isFollowingHeading(element) {
      if (element.closest("a")) {
        return false;
      }
      return /^팔로잉(?:\s*(?:채널|방송))?$/.test(
        (element.textContent || "").trim()
      );
    },

    findButton() {
      const buttons = document.querySelectorAll(
        "button[aria-label*='새로고침'], button[title*='새로고침'], button[aria-label*='갱신'], button[title*='갱신']"
      );
      for (const button of buttons) {
        let section = button.parentElement;
        for (let depth = 0; section && depth < 6; depth += 1) {
          const headings = section.querySelectorAll(
            "h2, h3, strong, [role='heading']"
          );
          if (Array.from(headings).some((heading) => this.isFollowingHeading(heading))) {
            return button;
          }
          section = section.parentElement;
        }
      }
      return null;
    },

    tick() {
      if (
        !settings.followingAutoRefresh ||
        document.visibilityState !== "visible" ||
        Date.now() - this.lastRefresh < 30000
      ) {
        return;
      }

      this.lastRefresh = Date.now();
      const button = this.findButton();
      if (button && !button.disabled) {
        button.click();
        log("following list refreshed");
      }
    },

    start() {
      setInterval(() => this.tick(), 1000);
    }
  };

  const sidebarPreview = {
    card: null,
    timer: null,
    hideTimer: null,
    currentLink: null,
    controller: null,
    cache: new Map(),
    suppressedTitles: [],
    fallbackTitle: "",

    liveLink(target) {
      const link = target?.closest?.("a[href^='/live/']");
      if (!link?.getAttribute("href")?.match(/^\/live\/([a-f0-9]{32})/i)) {
        return null;
      }
      const semanticSidebar = link.closest("aside, nav, [class*='sidebar']");
      return semanticSidebar || link.getBoundingClientRect().left < 360 ? link : null;
    },

    linkTitle(link) {
      const titledElements = [link, ...link.querySelectorAll("[title]")];
      for (const element of titledElements) {
        const title = (element.getAttribute("title") || "").trim();
        if (title) {
          return title;
        }
      }
      const semanticText = [
        link.getAttribute("aria-label"),
        link.querySelector("[aria-label]")?.getAttribute("aria-label"),
        link.querySelector("img[alt]")?.getAttribute("alt"),
        link.textContent
      ].find((value) => typeof value === "string" && value.trim());
      return (semanticText || "").replace(/\s+/g, " ").trim();
    },

    suppressNativeTooltip(link) {
      this.restoreNativeTooltip();
      this.fallbackTitle = this.linkTitle(link);
      for (const element of [link, ...link.querySelectorAll("[title]")]) {
        if (!element.hasAttribute("title")) {
          continue;
        }
        this.suppressedTitles.push({
          element,
          value: element.getAttribute("title") || ""
        });
        element.removeAttribute("title");
      }
    },

    restoreNativeTooltip() {
      for (const { element, value } of this.suppressedTitles) {
        if (element.isConnected && !element.hasAttribute("title")) {
          element.setAttribute("title", value);
        }
      }
      this.suppressedTitles = [];
    },

    ensureCard() {
      if (this.card?.isConnected) {
        return this.card;
      }
      const card = document.createElement("div");
      const image = document.createElement("img");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      card.className = "cng-sidebar-preview";
      image.className = "cng-sidebar-preview__image";
      image.alt = "";
      body.className = "cng-sidebar-preview__body";
      title.className = "cng-sidebar-preview__title";
      meta.className = "cng-sidebar-preview__meta";
      body.append(title, meta);
      card.append(image, body);
      document.body.appendChild(card);
      this.card = card;
      return card;
    },

    position(link) {
      const card = this.ensureCard();
      const bounds = link.getBoundingClientRect();
      const width = 360;
      const left = Math.min(window.innerWidth - width - 12, bounds.right + 12);
      card.style.left = `${Math.max(12, left)}px`;
      card.style.top = `${Math.max(12, Math.min(bounds.top, window.innerHeight - 300))}px`;
    },

    async fetchDetail(channelId) {
      const cached = this.cache.get(channelId);
      if (cached && Date.now() - cached.time < 20000) {
        return cached.data;
      }

      this.controller?.abort();
      this.controller = new AbortController();
      const paths = [
        `https://api.chzzk.naver.com/service/v3.3/channels/${channelId}/live-detail?dt=PC&tm=false`,
        `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`
      ];
      for (const path of paths) {
        try {
          const response = await fetch(path, {
            credentials: "include",
            signal: this.controller.signal
          });
          const payload = await response.json();
          if (payload?.content) {
            this.cache.set(channelId, { time: Date.now(), data: payload.content });
            if (this.cache.size > 100) {
              this.cache.delete(this.cache.keys().next().value);
            }
            return payload.content;
          }
        } catch (error) {
          if (error.name === "AbortError") {
            return null;
          }
        }
      }
      return null;
    },

    async show(link) {
      if (!settings.sidebarPreview || this.currentLink !== link) {
        return;
      }

      const channelId = link.getAttribute("href").match(/^\/live\/([a-f0-9]{32})/i)?.[1];
      if (!channelId) {
        return;
      }

      this.position(link);
      const card = this.ensureCard();
      card.classList.add("is-loading", "is-visible");
      const image = card.querySelector(".cng-sidebar-preview__image");
      image.removeAttribute("src");
      card.querySelector(".cng-sidebar-preview__title").textContent =
        this.fallbackTitle;
      card.querySelector(".cng-sidebar-preview__meta").textContent = "";
      const detail = await this.fetchDetail(channelId);
      if (!detail) {
        if (this.currentLink === link) {
          card.classList.remove("is-loading", "is-visible");
        }
        return;
      }
      if (this.currentLink !== link) {
        return;
      }

      const imageUrl = detail.liveImageUrl?.replace("{type}", "480") || "";
      if (imageUrl) {
        image.src = imageUrl;
      }
      card.querySelector(".cng-sidebar-preview__title").textContent =
        detail.liveTitle || this.fallbackTitle || detail.channel?.channelName || "";
      const viewers = Number(detail.concurrentUserCount || 0).toLocaleString("ko-KR");
      const channelName = detail.channel?.channelName || "";
      card.querySelector(".cng-sidebar-preview__meta").textContent =
        [channelName, `${viewers}명`, detail.liveCategoryValue || "라이브"]
          .filter(Boolean)
          .join(" · ");
      card.classList.remove("is-loading");
    },

    hide() {
      clearTimeout(this.timer);
      this.controller?.abort();
      this.currentLink = null;
      this.fallbackTitle = "";
      this.restoreNativeTooltip();
      this.card?.classList.remove("is-visible");
    },

    onPointerOver(event) {
      if (!settings.sidebarPreview) {
        return;
      }
      const link = sidebarPreview.liveLink(event.target);
      if (!link) {
        return;
      }
      event.stopPropagation();
      if (link === sidebarPreview.currentLink) {
        return;
      }
      clearTimeout(sidebarPreview.timer);
      clearTimeout(sidebarPreview.hideTimer);
      sidebarPreview.currentLink = link;
      sidebarPreview.suppressNativeTooltip(link);
      sidebarPreview.timer = setTimeout(() => sidebarPreview.show(link), 250);
    },

    onPointerOut(event) {
      const link = sidebarPreview.liveLink(event.target);
      if (!link) {
        return;
      }
      event.stopPropagation();
      if (link.contains(event.relatedTarget)) {
        return;
      }
      const pointerX = event.clientX;
      const pointerY = event.clientY;
      sidebarPreview.hideTimer = setTimeout(() => {
        if (sidebarPreview.currentLink !== link) {
          return;
        }
        const hovered = document.elementFromPoint(pointerX, pointerY);
        if (hovered && link.contains(hovered)) {
          return;
        }
        sidebarPreview.hide();
      }, 120);
    },

    stopNativeMouseTooltip(event) {
      if (settings.sidebarPreview && sidebarPreview.liveLink(event.target)) {
        event.stopPropagation();
      }
    },

    start() {
      document.addEventListener("pointerover", this.onPointerOver, true);
      document.addEventListener("pointerout", this.onPointerOut, true);
      document.addEventListener("mouseover", this.stopNativeMouseTooltip, true);
      document.addEventListener("mouseout", this.stopNativeMouseTooltip, true);
    }
  };

  const volumeTooltip = {
    element: null,
    hideTimer: null,

    ensureElement(container) {
      if (this.element?.isConnected && this.element.parentElement === container) {
        return this.element;
      }
      this.element?.remove();
      const element = document.createElement("span");
      element.className = "cng-volume-tooltip";
      container.appendChild(element);
      this.element = element;
      return element;
    },

    anchor(video) {
      const player =
        video.closest(".pzp-pc, .pzp") ||
        video.closest("[class*='video_player']") ||
        video.parentElement;
      if (!player) {
        return null;
      }
      const control = player.querySelector(
        [
          ".pzp-pc__volume-control",
          ".pzp-pc-volume-control",
          "[class*='volume-control']",
          "button[aria-label*='볼륨']",
          "button[aria-label*='음량']"
        ].join(", ")
      );
      return { player, control };
    },

    show(video) {
      const anchor = this.anchor(video);
      if (!anchor) {
        return;
      }
      const container = document.fullscreenElement || document.body;
      const element = this.ensureElement(container);
      const bounds = (anchor.control || anchor.player).getBoundingClientRect();
      const horizontalPosition = anchor.control
        ? bounds.left + bounds.width / 2
        : bounds.left + 48;
      const verticalPosition = anchor.control
        ? bounds.top - 36
        : bounds.bottom - 72;
      element.textContent = core.formatVolumePercent(video.volume, video.muted);
      element.style.left = `${core.clamp(
        horizontalPosition,
        28,
        window.innerWidth - 28
      )}px`;
      element.style.top = `${Math.max(12, verticalPosition)}px`;
      element.classList.add("is-visible");
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(
        () => element.classList.remove("is-visible"),
        900
      );
    },

    onVolumeChange(event) {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || video !== mainVideo()) {
        return;
      }
      volumeTooltip.show(video);
    },

    start() {
      document.addEventListener("volumechange", this.onVolumeChange, true);
    }
  };

  const videoLatency = {
    element: null,

    ensureElement(anchor) {
      if (this.element?.isConnected && this.element.parentElement === anchor) {
        return this.element;
      }
      this.element?.remove();
      const element = document.createElement("span");
      element.className = "cng-video-latency";
      anchor.appendChild(element);
      this.element = element;
      return element;
    },

    tick() {
      if (!settings.videoLatency || !isLiveRoute()) {
        this.element?.remove();
        this.element = null;
        return;
      }

      const video = mainVideo();
      const range = seekableWindow(video);
      const anchor =
        document.querySelector(".pzp-pc__bottom-buttons-left") ||
        document.querySelector(".pzp-pc__bottom-buttons") ||
        document.querySelector("[class*='pzp-pc__bottom-buttons']");
      if (!video || !range || !anchor) {
        this.element?.remove();
        this.element = null;
        return;
      }

      const liveDistance = Math.max(
        0,
        timelineAssist.liveEdge(video, range) - video.currentTime
      );
      const player = video.closest(".pzp-pc");
      const atLiveEdge = core.isAtLiveEdge(
        playbackState.manualTimelinePosition,
        player?.classList?.contains("pzp-pc--onlive"),
        liveDistance
      );
      const mode = playbackState.mode();
      const loudnessStatus = loudness.status();
      const element = this.ensureElement(anchor);
      const status = [];
      const details = [];
      if (atLiveEdge) {
        status.push(mode ? `${mode} 자동` : "자동");
        status.push(`지연 ${liveDistance.toFixed(1)}초`);
        details.push(`지연: 현재 화면에서 실시간 위치까지 ${liveDistance.toFixed(1)}초`);
      }
      status.push(`음량 ${loudnessStatus}`);
      details.push(`음량 맞춤: ${loudnessStatus}`);
      element.textContent = status.join(" · ");
      element.title = details.join("\n");
    },

    start() {
      setInterval(() => this.tick(), 500);
    }
  };

  function reactValues(element) {
    const values = [];
    for (const key of Object.keys(element || {})) {
      if (key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")) {
        values.push(element[key]);
      }
    }
    return values;
  }

  function chatMessageForItem(item) {
    const candidates = [item, ...Array.from(item.querySelectorAll("button, p, span, div")).slice(0, 40)];
    for (const candidate of candidates) {
      for (const value of reactValues(candidate)) {
        const message = core.findContainedChatMessage(value);
        if (message) {
          return message;
        }
      }
    }
    return null;
  }

  function contentText(content) {
    if (typeof content === "string" || typeof content === "number") {
      return String(content);
    }
    if (Array.isArray(content)) {
      return content
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry?.type === "text") {
            return entry.value || "";
          }
          if (entry?.type === "emoji") {
            return entry.name ? `{${entry.name}}` : "";
          }
          return "";
        })
        .join("");
    }
    return "";
  }

  const chatEnhancements = {
    originals: new Map(),
    observer: null,
    scanTimer: null,
    route: "",

    ensureRoute() {
      const route = channelIdFromLocation();
      if (route === this.route) {
        return;
      }
      this.route = route;
      this.originals.clear();
    },

    itemForElement(element, chatLog) {
      let current = element;
      while (current && current !== chatLog) {
        const className = typeof current.className === "string" ? current.className : "";
        if (
          /(?:^|\s)_item_[^\s]+(?:\s|$)/.test(className) ||
          /chatting_(?:list|message)_item/.test(className)
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },

    itemsInLog(chatLog) {
      const items = new Set();
      const anchors = chatLog.querySelectorAll(
        "button[class*='nickname'], [class*='username'], [class*='blind'], [class*='hidden']"
      );
      for (const anchor of anchors) {
        const item = this.itemForElement(anchor, chatLog);
        if (item) {
          items.add(item);
        }
      }
      return items;
    },

    remember(key, text) {
      if (!key || !text || CHAT_BLIND_TEXT.test(text)) {
        return;
      }
      this.originals.set(key, text);
      if (this.originals.size > 2000) {
        this.originals.delete(this.originals.keys().next().value);
      }
    },

    restoreNickname(item, message) {
      const nickname = message?.profile?.nickname || "";
      const candidates = Array.from(
        item.querySelectorAll("button, [class*='nickname'], [class*='username']")
      ).slice(0, 20);
      for (const candidate of candidates) {
        candidate.classList.remove("cng-restored-nickname");
        if (!settings.restoreTransparentNicknames) {
          continue;
        }
        if (nickname && !(candidate.textContent || "").includes(nickname)) {
          continue;
        }
        if (core.colorAlpha(getComputedStyle(candidate).color) <= 0.05) {
          candidate.classList.add("cng-restored-nickname");
        }
      }
    },

    clearRestoredMessage(target, { restorePlaceholder = true } = {}) {
      const placeholder = target.dataset.cngBlindPlaceholder;
      const restoredText = target.dataset.cngRestoredText;
      if (
        restorePlaceholder &&
        placeholder !== undefined &&
        target.textContent === restoredText
      ) {
        target.textContent = placeholder;
      }
      delete target.dataset.cngBlindedRestored;
      delete target.dataset.cngBlindPlaceholder;
      delete target.dataset.cngRestoredText;
      target.classList.remove("cng-restored-message");
    },

    cleanItemState(item, key) {
      for (const target of item.querySelectorAll("[data-cng-blinded-restored]")) {
        if (target.dataset.cngBlindedRestored !== key) {
          this.clearRestoredMessage(target, { restorePlaceholder: false });
        }
      }
      if (!settings.restoreTransparentNicknames) {
        for (const target of item.querySelectorAll(".cng-restored-nickname")) {
          target.classList.remove("cng-restored-nickname");
        }
      }
      if (!settings.restoreBlindedMessages) {
        for (const target of item.querySelectorAll("[data-cng-blinded-restored]")) {
          this.clearRestoredMessage(target);
        }
      }
    },

    cleanupDisabledFeatures() {
      if (!settings.restoreTransparentNicknames) {
        for (const target of document.querySelectorAll(".cng-restored-nickname")) {
          target.classList.remove("cng-restored-nickname");
        }
      }
      if (!settings.restoreBlindedMessages) {
        for (const target of document.querySelectorAll("[data-cng-blinded-restored]")) {
          this.clearRestoredMessage(target);
        }
      }
    },

    restoreBlinded(item, message, key) {
      if (!settings.restoreBlindedMessages || !CHAT_BLIND_TEXT.test(item.textContent || "")) {
        return;
      }
      const directOriginal = contentText(message.originalContent);
      const original =
        directOriginal && !CHAT_BLIND_TEXT.test(directOriginal)
          ? directOriginal
          : this.originals.get(key);
      if (!original) {
        return;
      }

      const candidates = Array.from(item.querySelectorAll("p, span, div"))
        .filter((element) => CHAT_BLIND_TEXT.test(element.textContent || ""))
        .sort((left, right) =>
          (left.textContent || "").length - (right.textContent || "").length
      );
      const target = candidates[0];
      if (!target) {
        return;
      }
      if (target.dataset.cngBlindedRestored !== key) {
        target.dataset.cngBlindPlaceholder = target.textContent || "";
      }
      target.textContent = original;
      target.dataset.cngBlindedRestored = key;
      target.dataset.cngRestoredText = original;
      target.classList.add("cng-restored-message");
    },

    addTimestamp(item, message, key) {
      if (!settings.chatTimestamp) {
        item.querySelector(".cng-chat-timestamp")?.remove();
        return;
      }
      const timestamp = core.formatTimestamp(message.time);
      if (!timestamp) {
        return;
      }

      let stamp = item.querySelector(".cng-chat-timestamp");
      if (!stamp) {
        stamp = document.createElement("span");
        stamp.className = "cng-chat-timestamp";
        const nickname = item.querySelector("button, [class*='nickname'], [class*='username']");
        const host = nickname?.parentElement || item;
        host.insertBefore(stamp, nickname || host.firstChild);
      }
      stamp.textContent = timestamp;
      stamp.dataset.messageKey = key;
    },

    processItem(item) {
      if (!(item instanceof HTMLElement)) {
        return;
      }
      const message = chatMessageForItem(item);
      if (!message?.time) {
        return;
      }
      const key = String(message.key || `${message.user || "chat"}-${message.time}`);
      this.cleanItemState(item, key);
      const original =
        contentText(message.originalContent) || contentText(message.content);
      this.remember(key, original);
      this.addTimestamp(item, message, key);
      this.restoreNickname(item, message);
      this.restoreBlinded(item, message, key);
    },

    scan(root = document) {
      this.ensureRoute();
      const logs = root.matches?.("[role='log']")
        ? [root]
        : Array.from(root.querySelectorAll?.("[role='log']") || []);
      for (const chatLog of logs) {
        for (const item of this.itemsInLog(chatLog)) {
          this.processItem(item);
        }
      }
    },

    scheduleScan() {
      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scan();
      }, 50);
    },

    start() {
      const observe = () => {
        if (!document.body || this.observer) {
          return;
        }
        this.observer = new MutationObserver((mutations) => {
          let hasAddedElement = false;
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node instanceof HTMLElement) {
                hasAddedElement = true;
                break;
              }
            }
            if (hasAddedElement) {
              break;
            }
          }
          if (hasAddedElement) {
            this.scheduleScan();
          }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.scan();
      };
      observe();
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", observe, { once: true });
      }
      setInterval(() => this.scan(), 3000);
    }
  };

  const powerClaim = {
    isReadyButton(button) {
      const text = (button.textContent || "").trim();
      if (POWER_READY_TEXT.test(text)) {
        return true;
      }
      if (!POWER_ACTION_TEXT.test(text)) {
        return false;
      }

      let container = button.parentElement;
      for (let depth = 0; container && depth < 5; depth += 1) {
        if (/통나무\s*파워/i.test(container.textContent || "")) {
          return true;
        }
        container = container.parentElement;
      }
      return false;
    },

    tick() {
      if (!settings.autoClaimPower) {
        return;
      }
      const buttons = Array.from(document.querySelectorAll("button:not([data-cng-power-clicked])"));
      for (const button of buttons) {
        if (!this.isReadyButton(button) || button.disabled) {
          continue;
        }
        button.dataset.cngPowerClicked = "true";
        button.click();
        setTimeout(() => delete button.dataset.cngPowerClicked, 3000);
        log("claimed log power");
      }
    },

    start() {
      setInterval(() => this.tick(), 2000);
    }
  };

  function applySettings(nextSettings) {
    const previousMaximumBoostDb = loudness.currentMaximumBoostDb();
    settings = { ...settings, ...nextSettings };
    if (!settings.normalizeVolume) {
      loudness.disableNormalization();
    }
    if (!settings.compressAudio) {
      loudness.configureCompressor(false);
    }
    if (settings.normalizeVolume || settings.compressAudio) {
      loudness.ensureGraph();
    }
    if (previousMaximumBoostDb !== loudness.currentMaximumBoostDb()) {
      loudness.refreshMaximumBoost();
    }
    if (!settings.sidebarPreview) {
      sidebarPreview.hide();
    }
    chatEnhancements.cleanupDisabledFeatures();
    chatEnhancements.scheduleScan();
    log("settings updated", settings);
  }

  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.data?.source === MESSAGE_SOURCE &&
      event.data?.type === "settings"
    ) {
      applySettings(event.data.settings);
    }
  });

  function start() {
    timelineAssist.start();
    playbackState.start();
    loudness.start();
    watchTimer.start();
    followingRefresh.start();
    sidebarPreview.start();
    volumeTooltip.start();
    videoLatency.start();
    chatEnhancements.start();
    powerClaim.start();
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("readystatechange", start, { once: true });
  }

  window.postMessage({ source: MESSAGE_SOURCE, type: "ready" }, "*");
})();
