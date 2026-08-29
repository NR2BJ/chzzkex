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
    NORMALIZATION_TARGET_RANGE,
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
  const NATIVE_TIMELINE_SELECTOR = [
    ".pzp-pc-progress-slider[role='slider']",
    ".pzp-pc__progress-slider[role='slider']",
    ".pzp-progress-slider[role='slider']",
    "[class*='progress-slider'][role='slider']",
    "[data-role*='progress'][role='slider']"
  ].join(", ");
  const LIVE_EDGE_SEEK_TOLERANCE_SECONDS = 2;
  const BLIND_CACHE_STORAGE_PREFIX = "__chzzk_ex_blind_cache_v1__:";
  const BLIND_CACHE_MAX_ENTRIES = 1000;
  const BLIND_CACHE_MAX_TEXT_LENGTH = 2000;
  const BLIND_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const BLIND_CACHE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
  const BLIND_CACHE_SAVE_DELAY_MS = 250;
  const BLIND_CACHE_SEEN_REFRESH_MS = 60 * 1000;
  const POWER_READY_TEXT =
    /(?:통나무\s*파워.*(?:배달\s*완료|받기|수령)|(?:배달\s*완료|받기|수령).*통나무\s*파워)/i;
  const POWER_ACTION_TEXT = /^(?:배달\s*완료|받기|수령)$/i;
  const LOUDNESS_TICK_MS = 100;
  const LOUDNESS_BLOCK_SECONDS = 0.4;
  const LOUDNESS_INITIAL_BLOCKS = 30;
  const LOUDNESS_ADAPT_INTERVAL_MS = 5000;
  const LOUDNESS_LONG_WINDOW_MS = 2 * 60 * 1000;
  const LOUDNESS_SHORT_WINDOW_MS = 3000;
  const LOUDNESS_SHORT_MIN_BLOCKS = 27;
  const LOUDNESS_ANCHOR_WINDOW_MS = 2 * 60 * 1000;
  const LOUDNESS_ANCHOR_MIN_SAMPLES = 20;
  const LOUDNESS_SHORT_TERM_PERCENTILE = 0.95;
  const LOUDNESS_PEAK_PERCENTILE = 0.99;
  const LOUDNESS_SHORT_TERM_ALLOWANCE_DB = 4;
  const LOUDNESS_INTEGRATED_CEILING_ALLOWANCE_DB = 2;
  const LOUDNESS_PEAK_CEILING_DB = -3;
  const LOUDNESS_PROVISIONAL_MAX_BOOST_DB = 6;
  const LOUDNESS_GAIN_INCREASE_STEP_DB = 0.5;
  const LIMITER_THRESHOLD_DB = -1;
  const LIMITER_RATIO = 20;
  const LIMITER_ATTACK_SECONDS = 0;
  const LIMITER_RELEASE_SECONDS = 0.08;
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
    const currentChannel = channelIdFromLocation();
    const cachedChannel = cachedMainVideoRoute.match(
      /^\/live\/([a-z0-9_-]+)/i
    )?.[1];
    if (
      (cachedMainVideoRoute === location.pathname ||
        (!currentChannel && cachedChannel)) &&
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
    return (
      element?.closest?.(".cng-timeline-assist__track[role='slider']") || null
    );
  }

  function nativeTimelineSlider(element) {
    const slider = element?.closest?.(NATIVE_TIMELINE_SELECTOR) || null;
    if (
      !slider ||
      slider.classList.contains("cng-timeline-assist") ||
      slider.closest("[class*='volume'], [data-role*='volume']")
    ) {
      return null;
    }
    return slider.closest(".pzp-pc, .pzp, [class*='video_player']")
      ? slider
      : null;
  }

  const timelineAssist = {
    activePointerId: null,
    slider: null,
    dragVideo: null,
    dragRoute: "",
    element: null,
    timelineVideo: null,
    timelineRoute: "",
    liveAnchorEnd: null,
    liveAnchorAt: 0,
    lastObservedEnd: null,
    displayDuration: 0,

    resetTimeline(video, range) {
      this.cancelDrag();
      this.timelineVideo = video;
      this.timelineRoute = location.pathname;
      this.liveAnchorEnd = range.end;
      this.liveAnchorAt = performance.now();
      this.lastObservedEnd = range.end;
      this.displayDuration = range.duration;
      if (!playbackState.hasSeekIntentForRoute(location.pathname)) {
        playbackState.clearManualSeekIntent();
      }
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
      this.cancelDrag();
    },

    cancelDrag() {
      this.slider
        ?.closest?.(".cng-timeline-assist")
        ?.classList?.remove("is-dragging");
      this.activePointerId = null;
      this.slider = null;
      this.dragVideo = null;
      this.dragRoute = "";
    },

    mount(player) {
      if (this.element?.isConnected && this.element.parentElement === player) {
        return this.element;
      }
      this.remove();
      const element = document.createElement("div");
      element.className = "cng-timeline-assist";
      const track = document.createElement("span");
      const fill = document.createElement("span");
      const handle = document.createElement("span");
      const position = document.createElement("span");
      const live = document.createElement("button");
      track.className = "cng-timeline-assist__track";
      fill.className = "cng-timeline-assist__fill";
      handle.className = "cng-timeline-assist__handle";
      position.className = "cng-timeline-assist__position";
      live.className = "cng-timeline-assist__live";
      track.setAttribute("role", "slider");
      track.setAttribute("tabindex", "0");
      track.setAttribute("aria-label", "라이브 타임라인");
      position.setAttribute("aria-hidden", "true");
      live.setAttribute("type", "button");
      live.setAttribute("title", "실시간으로 이동");
      live.textContent = "실시간";
      track.append(fill, handle);
      element.append(position, live, track);
      player.appendChild(element);
      this.element = element;
      return element;
    },

    tick() {
      if (!settings.timelineAssist || !isLiveRoute()) {
        this.remove();
        return;
      }
      const video = mainVideo();
      const range = seekableWindow(video);
      if (!video || !range || range.duration > 300) {
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
      const displayBehind = atLiveEdge ? 0 : behind;
      const displaySeconds = Math.max(0, Math.round(displayBehind));
      element.style.setProperty("--cng-timeline-progress", `${ratio * 100}%`);
      const position = element.querySelector(".cng-timeline-assist__position");
      const positionText = core.formatOffset(displaySeconds);
      if (position.textContent !== positionText) {
        position.textContent = positionText;
      }
      if (atLiveEdge) {
        element.classList.add("is-live");
      } else {
        element.classList.remove("is-live");
      }
      const track = element.querySelector(".cng-timeline-assist__track");
      track.setAttribute("aria-valuemin", String(-Math.round(this.displayDuration)));
      track.setAttribute("aria-valuemax", "0");
      track.setAttribute("aria-valuenow", String(-displaySeconds));
      track.setAttribute(
        "aria-valuetext",
        displaySeconds === 0
          ? "실시간"
          : `실시간 ${displaySeconds}초 전`
      );
    },

    commitSeek(video, target, range) {
      const safeEnd = Math.max(range.start, range.end - 0.25);
      const nextTime = core.clamp(target, range.start, safeEnd);
      const returningToLive =
        nextTime >= range.end - LIVE_EDGE_SEEK_TOLERANCE_SECONDS;
      if (returningToLive) {
        const route = isLiveRoute() ? location.pathname : "";
        initialLiveEdgeSync.cancel(route);
        if (Math.abs(video.currentTime - nextTime) > 0.001) {
          initialLiveEdgeSync.beginOwnSeek(video);
        }
        playbackState.clearManualSeekIntent();
      } else {
        playbackState.markManualSeekIntent(true);
      }
      video.currentTime = nextTime;
      return true;
    },

    goLive(video, range) {
      this.cancelDrag();
      return this.commitSeek(video, range.end - 0.25, range);
    },

    isCurrentDrag() {
      return Boolean(
        this.slider?.isConnected &&
        this.dragVideo &&
        this.dragVideo === mainVideo() &&
        this.dragRoute === location.pathname
      );
    },

    seek(event, slider) {
      const video = mainVideo();
      const range = seekableWindow(video);
      if (!video || !range || range.duration > 300) {
        return false;
      }

      const bounds = slider.getBoundingClientRect();
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

      return this.commitSeek(video, target, range);
    },

    onKeyDown(event) {
      const slider = event.target?.closest?.(
        ".cng-timeline-assist__track[role='slider']"
      );
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
        timelineAssist.goLive(video, range);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (target === null) {
        return;
      }

      timelineAssist.commitSeek(video, target, range);
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
      timelineAssist.dragVideo = mainVideo();
      timelineAssist.dragRoute = location.pathname;
      slider.closest(".cng-timeline-assist")?.classList.add("is-dragging");
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
      if (!settings.timelineAssist) {
        timelineAssist.cancelDrag();
        return;
      }
      if (!timelineAssist.isCurrentDrag()) {
        timelineAssist.cancelDrag();
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

      if (!timelineAssist.isCurrentDrag()) {
        timelineAssist.cancelDrag();
        return;
      }

      if (settings.timelineAssist && timelineAssist.slider) {
        timelineAssist.seek(event, timelineAssist.slider);
      }
      timelineAssist.cancelDrag();
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    onPointerCancel(event) {
      if (timelineAssist.activePointerId !== event.pointerId) {
        return;
      }
      timelineAssist.cancelDrag();
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    onClick(event) {
      const live = event.target?.closest?.(".cng-timeline-assist__live");
      if (!settings.timelineAssist || !live) {
        return;
      }
      const video = mainVideo();
      const range = seekableWindow(video);
      if (!video || !range || range.duration > 300) {
        return;
      }
      timelineAssist.goLive(video, range);
      event.preventDefault();
      event.stopImmediatePropagation();
    },

    start() {
      document.addEventListener("click", this.onClick, true);
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("pointermove", this.onPointerMove, true);
      document.addEventListener("pointerup", this.onPointerUp, true);
      document.addEventListener("pointercancel", this.onPointerCancel, true);
      document.addEventListener("keydown", this.onKeyDown, true);
      setInterval(() => this.tick(), 250);
    }
  };

  const playbackState = {
    manualTimelinePosition: false,
    manualTimelineRoute: "",
    adapter: null,
    nextAdapterSearchAt: 0,
    userSeekIntentUntil: 0,

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

    clearManualSeekIntent() {
      this.manualTimelinePosition = false;
      this.manualTimelineRoute = "";
      this.userSeekIntentUntil = 0;
    },

    hasSeekIntentForRoute(route) {
      return Boolean(route && this.manualTimelineRoute === route);
    },

    markManualSeekIntent(manualPosition = true) {
      const route = isLiveRoute() ? location.pathname : "";
      this.manualTimelinePosition = Boolean(manualPosition);
      this.manualTimelineRoute = route;
      this.userSeekIntentUntil = performance.now() + 2000;
      initialLiveEdgeSync.cancel(route);
    },

    isPlayerSeekTarget(target) {
      if (nativeTimelineSlider(target)) {
        return true;
      }
      const video = mainVideo();
      const player =
        video?.closest(".pzp-pc, .pzp") ||
        video?.closest("[class*='video_player']") ||
        video?.parentElement;
      return Boolean(
        target &&
        (target === document.body ||
          target === video ||
          player === target ||
          player?.contains?.(target))
      );
    },

    isSeekKey(key) {
      return (
        ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(
          key
        ) || /^[jl]$/i.test(String(key || ""))
      );
    },

    onNativePointerDown(event) {
      if (
        event.isTrusted &&
        event.button === 0 &&
        nativeTimelineSlider(event.target)
      ) {
        playbackState.markManualSeekIntent();
      }
    },

    onNativeKeyDown(event) {
      if (
        event.isTrusted &&
        playbackState.isSeekKey(event.key) &&
        playbackState.isPlayerSeekTarget(event.target)
      ) {
        playbackState.markManualSeekIntent();
      }
    },

    onSeeking(event) {
      const video = event.target;
      if (initialLiveEdgeSync.consumeOwnSeek(video) || video !== mainVideo()) {
        return;
      }
      if (
        playbackState.userSeekIntentUntil > 0 &&
        performance.now() <= playbackState.userSeekIntentUntil
      ) {
        playbackState.markManualSeekIntent();
      }
    },

    onClick(event) {
      const button = event.target?.closest?.("button");
      if (button && /^(실시간|LIVE)$/i.test((button.textContent || "").trim())) {
        playbackState.clearManualSeekIntent();
        initialLiveEdgeSync.cancel(
          isLiveRoute() ? location.pathname : ""
        );
      }
    },

    start() {
      document.addEventListener("click", this.onClick, true);
      document.addEventListener("pointerdown", this.onNativePointerDown, true);
      document.addEventListener("keydown", this.onNativeKeyDown, true);
      document.addEventListener("seeking", this.onSeeking, true);
    }
  };

  const initialLiveEdgeSync = {
    route: "",
    candidateVideo: null,
    candidateSource: "",
    candidateSince: 0,
    decided: false,
    deadlineAt: 0,
    cancelledRoute: "",
    ownSeekVideo: null,
    ownSeekExpiresAt: 0,

    reset(route, now) {
      this.route = route;
      if (!playbackState.hasSeekIntentForRoute(route)) {
        playbackState.clearManualSeekIntent();
      }
      this.candidateVideo = null;
      this.candidateSource = "";
      this.candidateSince = 0;
      this.decided = Boolean(route && this.cancelledRoute === route);
      if (!this.decided) {
        this.cancelledRoute = "";
      }
      this.deadlineAt = route ? now + 15000 : 0;
    },

    cancel(route = isLiveRoute() ? location.pathname : "") {
      if (!route) {
        return;
      }
      this.cancelledRoute = route;
      if (this.route === route) {
        this.decided = true;
      }
    },

    beginOwnSeek(video) {
      this.ownSeekVideo = video;
      this.ownSeekExpiresAt = performance.now() + 2000;
    },

    consumeOwnSeek(video) {
      if (!video || video !== this.ownSeekVideo) {
        return false;
      }
      const isCurrent = performance.now() <= this.ownSeekExpiresAt;
      this.ownSeekVideo = null;
      this.ownSeekExpiresAt = 0;
      return isCurrent;
    },

    tick() {
      const now = performance.now();
      const route = isLiveRoute() ? location.pathname : "";
      if (route !== this.route) {
        this.reset(route, now);
      }
      if (!route || this.decided || !settings.timelineAssist) {
        return;
      }
      if (now > this.deadlineAt) {
        this.decided = true;
        return;
      }

      const video = mainVideo();
      if (!video) {
        return;
      }
      if (playbackState.manualTimelinePosition) {
        this.decided = true;
        return;
      }

      const source = video.currentSrc || video.src || "";
      if (video !== this.candidateVideo || source !== this.candidateSource) {
        this.candidateVideo = video;
        this.candidateSource = source;
        this.candidateSince = now;
        return;
      }
      if (
        now - this.candidateSince < 500 ||
        video.paused ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !Number.isFinite(video.currentTime)
      ) {
        return;
      }

      const range = seekableWindow(video);
      if (!range) {
        return;
      }

      const target = core.initialLiveSeekTarget(
        video.currentTime,
        range.start,
        range.end
      );
      if (target === null) {
        return;
      }

      this.decided = true;
      const previousTime = video.currentTime;
      this.beginOwnSeek(video);
      playbackState.clearManualSeekIntent();
      video.currentTime = target;
      log("initial live edge synchronized", {
        previousTime,
        target,
        rangeEnd: range.end
      });
    },

    start() {
      setInterval(() => this.tick(), 250);
    }
  };

  const loudness = {
    context: null,
    video: null,
    graph: null,
    graphs: new WeakMap(),
    outputGain: null,
    compressor: null,
    compressorTrim: null,
    limiter: null,
    limiterTrim: null,
    analysers: [],
    sampleBuffers: [],
    peakAnalysers: [],
    peakSampleBuffers: [],
    blockEnergies: [],
    recentBlockEnergies: [],
    shortTermLoudnessHistory: [],
    sourcePeakHistory: [],
    gainDb: 0,
    longTermGainDb: 0,
    safetyCeilingDb: DEFAULT_SETTINGS.normalizationMaxBoostDb,
    shortTermLoudnessDb: Number.NEGATIVE_INFINITY,
    adaptiveApplied: false,
    activeBlockCount: 0,
    nextGainUpdateAt: 0,
    unlocked: false,
    resumePending: false,
    lastResumeAttemptAt: Number.NEGATIVE_INFINITY,
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
            latencyHint: "interactive",
            sampleRate: 48000
          });
        } catch {
          try {
            this.context = new AudioContextClass({ latencyHint: "interactive" });
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
      this.compressorTrim = null;
      this.limiter = null;
      this.limiterTrim = null;
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
      this.holdAudioParam(this.outputGain.gain, now);
      this.outputGain.gain.setTargetAtTime(
        10 ** (gainDb / 20),
        now,
        timeConstant
      );
    },

    holdAudioParam(parameter, now = this.context?.currentTime ?? 0) {
      if (typeof parameter?.cancelAndHoldAtTime === "function") {
        try {
          parameter.cancelAndHoldAtTime(now);
          return;
        } catch {}
      }
      const currentValue = parameter?.value;
      parameter?.cancelScheduledValues(now);
      if (Number.isFinite(currentValue)) {
        parameter.setValueAtTime(currentValue, now);
      }
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

    currentTargetLoudnessDb() {
      const value = Number(settings.normalizationTargetDb);
      return core.clamp(
        Number.isFinite(value)
          ? value
          : DEFAULT_SETTINGS.normalizationTargetDb,
        NORMALIZATION_TARGET_RANGE.min,
        NORMALIZATION_TARGET_RANGE.max
      );
    },

    currentCompressorPreset() {
      return (
        COMPRESSOR_PRESETS[settings.compressorPreset] ||
        COMPRESSOR_PRESETS.medium
      );
    },

    compressorConfiguration(
      video = this.video,
      enabled = settings.compressAudio
    ) {
      const preset = this.currentCompressorPreset();
      const ratio = enabled ? preset.ratio : 1;
      const threshold = enabled
        ? core.compressorThresholdForMediaVolume(
            preset.thresholdDb,
            video?.volume
          )
        : preset.thresholdDb;
      const values = {
        threshold,
        knee: preset.kneeDb,
        ratio,
        attack: preset.attackSeconds,
        release: preset.releaseSeconds
      };
      const trimDb = enabled
        ? core.compressorVolumeCompensationDb(
            preset.thresholdDb,
            ratio,
            video?.volume
          )
        : 0;
      const trimGain = 10 ** (trimDb / 20);
      return {
        key: JSON.stringify([
          enabled,
          ...Object.values(values),
          trimGain
        ]),
        values,
        trimGain
      };
    },

    configureCompressor(
      enabled = settings.compressAudio,
      graph = this.graph,
      video = this.video
    ) {
      if (!graph?.compressor || !graph.compressorTrim || !this.context) {
        return false;
      }
      const configuration = this.compressorConfiguration(video, enabled);
      if (graph.compressorConfigKey === configuration.key) {
        return false;
      }
      const now = this.context.currentTime;
      const { values, trimGain } = configuration;
      for (const [name, value] of Object.entries(values)) {
        const parameter = graph.compressor[name];
        this.holdAudioParam(parameter, now);
        parameter.setTargetAtTime(value, now, 0.05);
      }
      this.holdAudioParam(graph.compressorTrim.gain, now);
      graph.compressorTrim.gain.setTargetAtTime(trimGain, now, 0.05);
      graph.compressorConfigKey = configuration.key;
      return true;
    },

    limiterConfiguration(
      enabled = settings.normalizeVolume || settings.compressAudio
    ) {
      const ratio = enabled ? LIMITER_RATIO : 1;
      const values = {
        threshold: LIMITER_THRESHOLD_DB,
        knee: 0,
        ratio,
        attack: LIMITER_ATTACK_SECONDS,
        release: LIMITER_RELEASE_SECONDS
      };
      const trimDb = enabled
        ? core.compressorMakeupTrimDb(LIMITER_THRESHOLD_DB, ratio)
        : 0;
      const trimGain = 10 ** (trimDb / 20);
      return {
        key: JSON.stringify([enabled, ...Object.values(values), trimGain]),
        values,
        trimGain
      };
    },

    configureLimiter(
      enabled = settings.normalizeVolume || settings.compressAudio,
      graph = this.graph
    ) {
      if (!graph?.limiter || !graph.limiterTrim || !this.context) {
        return false;
      }
      const configuration = this.limiterConfiguration(enabled);
      if (graph.limiterConfigKey === configuration.key) {
        return false;
      }
      const now = this.context.currentTime;
      const { values, trimGain } = configuration;
      for (const [name, value] of Object.entries(values)) {
        const parameter = graph.limiter[name];
        this.holdAudioParam(parameter, now);
        parameter.setTargetAtTime(value, now, 0.02);
      }
      this.holdAudioParam(graph.limiterTrim.gain, now);
      graph.limiterTrim.gain.setTargetAtTime(trimGain, now, 0.02);
      graph.limiterConfigKey = configuration.key;
      return true;
    },

    resetMeasurement(route = channelIdFromLocation()) {
      this.route = route;
      this.blockEnergies = [];
      this.recentBlockEnergies = [];
      this.shortTermLoudnessHistory = [];
      this.sourcePeakHistory = [];
      this.adaptiveApplied = false;
      this.activeBlockCount = 0;
      this.nextGainUpdateAt = 0;
      this.longTermGainDb = 0;
      this.safetyCeilingDb = this.currentMaximumBoostDb();
      this.shortTermLoudnessDb = Number.NEGATIVE_INFINITY;
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
      this.shortTermLoudnessHistory = [];
      this.sourcePeakHistory = [];
      this.gainDb = 0;
      this.longTermGainDb = 0;
      this.safetyCeilingDb = this.currentMaximumBoostDb();
      this.shortTermLoudnessDb = Number.NEGATIVE_INFINITY;
      this.adaptiveApplied = false;
      this.activeBlockCount = 0;
      this.nextGainUpdateAt = 0;
      this.lastSignalAt = 0;
      this.lastClipRiskLogAt = 0;
      this.lastPlaybackRate = null;
      this.applyGain(0, 0.2);
    },

    connectGraph(graph) {
      if (graph?.failed) {
        return false;
      }
      if (graph.connected) {
        return true;
      }
      try {
        graph.source.connect(graph.compressor);
        graph.connected = true;
        return true;
      } catch (error) {
        try {
          graph.source.disconnect();
        } catch {}
        try {
          graph.source.connect(this.context.destination);
          graph.connected = true;
        } catch {}
        graph.failed = true;
        log("audio processing graph bypassed", error);
        return false;
      }
    },

    createGraph(video) {
      const outputGain = this.context.createGain();
      const compressor = this.context.createDynamicsCompressor();
      const compressorTrim = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      const limiterTrim = this.context.createGain();
      const splitter = this.context.createChannelSplitter(2);
      const silent = this.context.createGain();
      const analysers = [];
      const peakAnalysers = [];
      const weightingNodes = [];
      const compressorConfiguration = this.compressorConfiguration(video);
      const limiterConfiguration = this.limiterConfiguration();

      for (const [name, value] of Object.entries(
        compressorConfiguration.values
      )) {
        compressor[name].value = value;
      }
      compressorTrim.gain.value = compressorConfiguration.trimGain;
      for (const [name, value] of Object.entries(limiterConfiguration.values)) {
        limiter[name].value = value;
      }
      limiterTrim.gain.value = limiterConfiguration.trimGain;
      compressor
        .connect(compressorTrim)
        .connect(outputGain)
        .connect(limiter)
        .connect(limiterTrim)
        .connect(this.context.destination);
      compressorTrim.connect(splitter);
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

      const downstreamNodes = [
        outputGain,
        compressor,
        compressorTrim,
        limiter,
        limiterTrim,
        splitter,
        silent,
        ...analysers,
        ...peakAnalysers,
        ...weightingNodes
      ];
      let source;
      try {
        source = this.context.createMediaElementSource(video);
      } catch (error) {
        for (const node of downstreamNodes) {
          try {
            node.disconnect();
          } catch {}
        }
        throw error;
      }

      const graph = {
        source,
        outputGain,
        compressor,
        compressorTrim,
        limiter,
        limiterTrim,
        splitter,
        analysers,
        peakAnalysers,
        weightingNodes,
        compressorConfigKey: compressorConfiguration.key,
        limiterConfigKey: limiterConfiguration.key,
        connected: false,
        failed: false
      };
      this.graphs.set(video, graph);
      this.connectGraph(graph);
      return graph;
    },

    ensureGraph() {
      if (!settings.normalizeVolume && !settings.compressAudio) {
        this.applyGain(0, 0.2);
        this.configureCompressor(false);
        this.configureLimiter(false);
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
        this.configureLimiter();
        if (core.shouldResetLoudnessMeasurement(this.route, route)) {
          this.resetMeasurement(route);
        }
        return;
      }

      this.detachVideo();
      try {
        const graph = this.graphs.get(video) || this.createGraph(video);
        if (!this.connectGraph(graph)) {
          this.failure = true;
          return;
        }

        this.failure = false;
        this.video = video;
        this.graph = graph;
        this.outputGain = graph.outputGain;
        this.compressor = graph.compressor;
        this.compressorTrim = graph.compressorTrim;
        this.limiter = graph.limiter;
        this.limiterTrim = graph.limiterTrim;
        this.configureCompressor();
        this.configureLimiter();
        this.analysers = graph.analysers;
        this.peakAnalysers = graph.peakAnalysers;
        this.sampleBuffers = graph.analysers.map(
          (analyser) => new Float32Array(analyser.fftSize)
        );
        this.peakSampleBuffers = graph.peakAnalysers.map(
          (analyser) => new Float32Array(analyser.fftSize)
        );
        if (core.shouldResetLoudnessMeasurement(this.route, route)) {
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

    pruneMeasurementHistory(now = performance.now()) {
      const windows = [
        [this.blockEnergies, LOUDNESS_LONG_WINDOW_MS],
        [this.recentBlockEnergies, LOUDNESS_SHORT_WINDOW_MS],
        [this.shortTermLoudnessHistory, LOUDNESS_ANCHOR_WINDOW_MS],
        [this.sourcePeakHistory, LOUDNESS_ANCHOR_WINDOW_MS]
      ];
      for (const [samples, maxAgeMs] of windows) {
        core.appendTimedSample(samples, Number.NaN, now, maxAgeMs);
      }
      this.activeBlockCount = this.blockEnergies.length;
    },

    currentStats() {
      this.pruneMeasurementHistory();
      const stats = core.adaptiveLoudnessStats(
        core.timedSampleValues(this.blockEnergies)
      );
      if (!stats) {
        return null;
      }
      const shortTermValues = core.timedSampleValues(
        this.shortTermLoudnessHistory
      );
      const shortTermAnchorDb = core.percentile(
        shortTermValues,
        LOUDNESS_SHORT_TERM_PERCENTILE
      );
      const peakAnchorDb = core.percentilePeakDb(
        core.timedSampleValues(this.sourcePeakHistory),
        LOUDNESS_PEAK_PERCENTILE
      );
      const anchorConfirmed =
        shortTermValues.length >= LOUDNESS_ANCHOR_MIN_SAMPLES &&
        Number.isFinite(shortTermAnchorDb);
      return {
        ...stats,
        shortTermAnchorDb:
          shortTermAnchorDb ?? Number.NEGATIVE_INFINITY,
        peakAnchorDb,
        anchorConfirmed
      };
    },

    normalizationPlan(stats) {
      return core.hybridNormalizationGainDb({
        integratedLoudnessDb: stats.loudnessDb,
        shortTermLoudnessDb: stats.shortTermAnchorDb,
        peakDb: stats.peakAnchorDb,
        targetDb: this.currentTargetLoudnessDb(),
        shortTermAllowanceDb: LOUDNESS_SHORT_TERM_ALLOWANCE_DB,
        integratedCeilingAllowanceDb:
          LOUDNESS_INTEGRATED_CEILING_ALLOWANCE_DB,
        peakCeilingDb: LOUDNESS_PEAK_CEILING_DB,
        maximumDb: this.currentMaximumBoostDb(),
        provisionalMaximumDb: LOUDNESS_PROVISIONAL_MAX_BOOST_DB,
        anchorConfirmed: stats.anchorConfirmed
      });
    },

    updateSafetyStats() {
      this.pruneMeasurementHistory();
      const recentBlockEnergies = core.timedSampleValues(
        this.recentBlockEnergies
      );
      const activeShortBlocks = recentBlockEnergies.filter(
        (energy) => core.loudnessDbFromEnergy(energy) >= -70
      );
      this.shortTermLoudnessDb =
        activeShortBlocks.length >= LOUDNESS_SHORT_MIN_BLOCKS
          ? core.loudnessDbFromEnergy(
              recentBlockEnergies.reduce((sum, energy) => sum + energy, 0) /
                recentBlockEnergies.length
            )
          : Number.NEGATIVE_INFINITY;
      this.safetyCeilingDb = core.normalizationSafetyCeilingDb({
        shortTermLoudnessDb: this.shortTermLoudnessDb,
        shortTermCeilingDb:
          this.currentTargetLoudnessDb() + LOUDNESS_SHORT_TERM_ALLOWANCE_DB,
        maximumDb: this.currentMaximumBoostDb()
      });
      return this.safetyCeilingDb;
    },

    refreshNormalizationPlan() {
      this.safetyCeilingDb = this.currentMaximumBoostDb();
      if (!settings.normalizeVolume || !this.adaptiveApplied) {
        return;
      }
      const stats = this.currentStats();
      if (!stats || !Number.isFinite(stats.loudnessDb)) {
        return;
      }
      this.updateSafetyStats();
      const plan = this.normalizationPlan(stats);
      const requestedGainDb = plan.gainDb;
      this.longTermGainDb = requestedGainDb;
      const targetGainDb = Math.min(requestedGainDb, this.safetyCeilingDb);
      if (Math.abs(targetGainDb - this.gainDb) < 0.05) {
        return;
      }
      const previousGainDb = this.gainDb;
      this.gainDb = targetGainDb;
      this.applyGain(
        targetGainDb,
        targetGainDb < previousGainDb ? 0.5 : 5
      );
    },

    applySafetyGain() {
      const safetyCeilingDb = this.updateSafetyStats();
      if (this.gainDb <= safetyCeilingDb + 0.05) {
        return false;
      }
      this.gainDb = safetyCeilingDb;
      this.applyGain(this.gainDb, 0.5);
      log("lowered loudness gain for recent audio", {
        gainDb: this.gainDb,
        longTermGainDb: this.longTermGainDb,
        shortTermLoudnessDb: this.shortTermLoudnessDb
      });
      return true;
    },

    applyAdaptiveGain(stats) {
      const plan = this.normalizationPlan(stats);
      const requestedGainDb = plan.gainDb;
      const wasApplied = this.adaptiveApplied;
      this.longTermGainDb = wasApplied
        ? core.stepAdaptiveGainDb(this.longTermGainDb, requestedGainDb, {
            increaseStepDb: LOUDNESS_GAIN_INCREASE_STEP_DB,
            decreaseStepDb: 1
          })
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
        nextGainDb = Math.min(
          targetGainDb,
          this.gainDb + LOUDNESS_GAIN_INCREASE_STEP_DB
        );
      }
      if (Math.abs(nextGainDb - this.gainDb) >= 0.05) {
        const timeConstant = nextGainDb < this.gainDb
          ? 0.5
          : 5;
        this.gainDb = nextGainDb;
        this.applyGain(this.gainDb, timeConstant);
      }
      const { gainDb: plannedGainDb, ...limits } = plan;
      return { ...limits, plannedGainDb, requestedGainDb, targetGainDb };
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
        return `맞춤 ${sign}${this.gainDb.toFixed(1)}dB`;
      }
      return `측정 ${Math.min(
        99,
        Math.round((this.activeBlockCount / LOUDNESS_INITIAL_BLOCKS) * 100)
      )}%`;
    },

    tick() {
      if (!settings.normalizeVolume && !settings.compressAudio) {
        return;
      }
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
      const measuredAt = performance.now();
      const blockSampleCount = Math.round(
        this.context.sampleRate * LOUDNESS_BLOCK_SECONDS
      );
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
        blockEnergy += core.meanSquareTail(samples, blockSampleCount);

        const peakSamples = this.peakSampleBuffers[channel];
        this.peakAnalysers[channel].getFloatTimeDomainData(peakSamples);
        inputPeak = Math.max(
          inputPeak,
          core.maximumAbsoluteTail(peakSamples, blockSampleCount)
        );
      }

      const renderedPeak = inputPeak;
      const mediaVolume = this.video?.volume;
      const sourceLevel = core.sourceLevelBeforeMediaVolume(
        blockEnergy,
        inputPeak,
        mediaVolume,
        this.video?.muted
      );
      if (!sourceLevel) {
        return;
      }
      blockEnergy = sourceLevel.energy;
      inputPeak = sourceLevel.peak;

      core.appendTimedSample(
        this.recentBlockEnergies,
        blockEnergy,
        measuredAt,
        LOUDNESS_SHORT_WINDOW_MS
      );
      if (Number.isFinite(this.shortTermLoudnessDb)) {
        core.appendTimedSample(
          this.shortTermLoudnessHistory,
          this.shortTermLoudnessDb,
          measuredAt,
          LOUDNESS_ANCHOR_WINDOW_MS
        );
      } else {
        core.appendTimedSample(
          this.shortTermLoudnessHistory,
          Number.NaN,
          measuredAt,
          LOUDNESS_ANCHOR_WINDOW_MS
        );
      }
      core.appendTimedSample(
        this.sourcePeakHistory,
        inputPeak,
        measuredAt,
        LOUDNESS_ANCHOR_WINDOW_MS
      );
      this.applySafetyGain();

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
        core.appendTimedSample(
          this.blockEnergies,
          Number.NaN,
          measuredAt,
          LOUDNESS_LONG_WINDOW_MS
        );
        this.activeBlockCount = this.blockEnergies.length;
        return;
      }
      this.lastSignalAt = performance.now();
      core.appendTimedSample(
        this.blockEnergies,
        blockEnergy,
        measuredAt,
        LOUDNESS_LONG_WINDOW_MS
      );
      this.activeBlockCount = this.blockEnergies.length;

      if (
        this.activeBlockCount >= LOUDNESS_INITIAL_BLOCKS &&
        measuredAt >= this.nextGainUpdateAt
      ) {
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
        this.nextGainUpdateAt = measuredAt + LOUDNESS_ADAPT_INTERVAL_MS;
      }
    },

    start() {
      document.addEventListener("pointerdown", this.unlock, { capture: true });
      document.addEventListener("keydown", this.unlock, { capture: true });
      setInterval(() => this.tick(), LOUDNESS_TICK_MS);
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
    route: "",
    observer: null,

    liveLink(target) {
      const link = target?.closest?.("a[href^='/live/']");
      return core.isSidebarPreviewTarget(
        link?.getAttribute("href"),
        Boolean(link?.closest("#sidebar"))
      )
        ? link
        : null;
    },

    isCurrent(link) {
      return Boolean(
        settings.sidebarPreview &&
        this.currentLink === link &&
        this.route === location.href &&
        link?.isConnected &&
        this.liveLink(link) === link
      );
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
      if (!this.isCurrent(link)) {
        if (this.currentLink === link) {
          this.hide();
        }
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
          this.hide();
        }
        return;
      }
      if (!this.isCurrent(link)) {
        if (this.currentLink === link) {
          this.hide();
        }
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
      clearTimeout(this.hideTimer);
      this.controller?.abort();
      this.timer = null;
      this.hideTimer = null;
      this.controller = null;
      this.currentLink = null;
      this.fallbackTitle = "";
      this.route = "";
      this.restoreNativeTooltip();
      this.card?.classList.remove("is-loading", "is-visible");
    },

    checkPageState() {
      const link = this.currentLink;
      if (link && !this.isCurrent(link)) {
        this.hide();
      }
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
      clearTimeout(sidebarPreview.hideTimer);
      sidebarPreview.hideTimer = null;
      if (link === sidebarPreview.currentLink) {
        return;
      }
      clearTimeout(sidebarPreview.timer);
      sidebarPreview.currentLink = link;
      sidebarPreview.route = location.href;
      sidebarPreview.suppressNativeTooltip(link);
      sidebarPreview.timer = setTimeout(() => sidebarPreview.show(link), 250);
    },

    onPointerOut(event) {
      if (!settings.sidebarPreview) {
        return;
      }
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

    onNavigationIntent() {
      sidebarPreview.hide();
    },

    onPageStateChange() {
      sidebarPreview.checkPageState();
    },

    onVisibilityChange() {
      if (document.visibilityState !== "visible") {
        sidebarPreview.hide();
      }
    },

    connectObserver() {
      if (this.observer || !settings.sidebarPreview) {
        return;
      }
      this.observer = new MutationObserver(this.onPageStateChange);
      this.observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "id"]
      });
    },

    disconnectObserver() {
      this.observer?.disconnect();
      this.observer = null;
    },

    setEnabled(enabled) {
      if (enabled) {
        this.connectObserver();
      } else {
        this.hide();
        this.disconnectObserver();
      }
    },

    start() {
      document.addEventListener("pointerover", this.onPointerOver, true);
      document.addEventListener("pointerout", this.onPointerOut, true);
      document.addEventListener("mouseover", this.stopNativeMouseTooltip, true);
      document.addEventListener("mouseout", this.stopNativeMouseTooltip, true);
      document.addEventListener("click", this.onNavigationIntent, true);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      window.addEventListener("popstate", this.onPageStateChange);
      window.addEventListener("hashchange", this.onPageStateChange);
      window.addEventListener("pagehide", this.onNavigationIntent);
      window.addEventListener("resize", this.onNavigationIntent);
      window.addEventListener("scroll", this.onNavigationIntent, true);
      this.setEnabled(settings.sidebarPreview);
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
      if (video === loudness.video) {
        loudness.configureCompressor();
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
      const loudnessStatus = loudness.status();
      const element = this.ensureElement(anchor);
      const status = [];
      const details = [];
      if (atLiveEdge) {
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

  function chatMessageForItem(item) {
    const candidates = [item, ...Array.from(item.querySelectorAll("button, p, span, div")).slice(0, 40)];
    return core.findChatMessageInReactElements(candidates);
  }

  function contentText(content, depth = 0, seen = new Set()) {
    if (depth > 7) {
      return "";
    }
    if (typeof content === "string" || typeof content === "number") {
      return String(content);
    }
    if (Array.isArray(content)) {
      return content
        .map((entry) => contentText(entry, depth + 1, seen))
        .join("");
    }
    if (!content || typeof content !== "object" || seen.has(content)) {
      return "";
    }
    seen.add(content);
    if (content.type === "emoji") {
      return content.name ? `{${content.name}}` : "";
    }
    for (const value of [
      content.type === "text" ? content.value : undefined,
      content.props?.children,
      content.children,
      content.text,
      content.value,
      content.props?.alt,
      content.props?.title
    ]) {
      const text = contentText(value, depth + 1, seen);
      if (text) {
        return text;
      }
    }
    return "";
  }

  const chatEnhancements = {
    originals: new Map(),
    stableOriginals: new Map(),
    itemRoutes: new WeakMap(),
    restoredNicknameStates: new WeakMap(),
    hasRestoredMessages: false,
    observer: null,
    scanTimer: null,
    scanInterval: null,
    verifyInterval: null,
    cacheSaveTimer: null,
    waitingForBody: false,
    route: "",

    enabled() {
      return Boolean(
        settings.chatTimestamp ||
        settings.restoreTransparentNicknames ||
        settings.restoreBlindedMessages
      );
    },

    ensureRoute() {
      const route = channelIdFromLocation();
      if (route === this.route) {
        return;
      }
      this.persistOriginals();
      clearTimeout(this.cacheSaveTimer);
      this.cacheSaveTimer = null;
      this.route = route;
      this.originals.clear();
      this.stableOriginals.clear();
      this.loadOriginals();
      this.restoredNicknameStates = new WeakMap();
    },

    originalCacheStorageKey() {
      return this.route ? `${BLIND_CACHE_STORAGE_PREFIX}${this.route}` : "";
    },

    loadOriginals() {
      const storageKey = this.originalCacheStorageKey();
      if (!storageKey || typeof sessionStorage === "undefined") {
        return;
      }
      try {
        const cached = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (!cached || typeof cached !== "object") {
          sessionStorage.removeItem(storageKey);
          return;
        }
        const now = Date.now();
        const fallbackSeenAt = Number(cached.savedAt);
        const exactEntries = Array.isArray(cached.exact) ? cached.exact : [];
        const stableEntries = Array.isArray(cached.stable) ? cached.stable : [];
        let shouldRewrite =
          exactEntries.length > BLIND_CACHE_MAX_ENTRIES ||
          stableEntries.length > BLIND_CACHE_MAX_ENTRIES;
        for (const entry of exactEntries.slice(-BLIND_CACHE_MAX_ENTRIES)) {
          if (!Array.isArray(entry)) {
            shouldRewrite = true;
            continue;
          }
          const [key, text, entrySeenAt] = entry;
          const seenAt = Number(entrySeenAt ?? fallbackSeenAt);
          if (
            typeof key === "string" &&
            typeof text === "string" &&
            text &&
            text.length <= BLIND_CACHE_MAX_TEXT_LENGTH &&
            !core.isBlindChatPlaceholder(text) &&
            this.cacheSeenAtIsFresh(seenAt, now)
          ) {
            this.originals.set(key, { text, seenAt });
          } else {
            shouldRewrite = true;
          }
        }
        for (const entry of stableEntries.slice(-BLIND_CACHE_MAX_ENTRIES)) {
          if (!Array.isArray(entry)) {
            shouldRewrite = true;
            continue;
          }
          const [key, text, entrySeenAt] = entry;
          const seenAt = Number(entrySeenAt ?? fallbackSeenAt);
          if (
            typeof key === "string" &&
            typeof text === "string" &&
            text &&
            text.length <= BLIND_CACHE_MAX_TEXT_LENGTH &&
            !core.isBlindChatPlaceholder(text) &&
            this.cacheSeenAtIsFresh(seenAt, now)
          ) {
            this.stableOriginals.set(key, { text, seenAt });
          } else {
            shouldRewrite = true;
          }
        }
        if (!this.originals.size && !this.stableOriginals.size) {
          sessionStorage.removeItem(storageKey);
        } else if (shouldRewrite) {
          this.persistOriginals();
        }
      } catch {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
      }
    },

    persistOriginals() {
      const storageKey = this.originalCacheStorageKey();
      if (!storageKey || typeof sessionStorage === "undefined") {
        return;
      }
      try {
        this.pruneOriginals();
        if (!this.originals.size && !this.stableOriginals.size) {
          sessionStorage.removeItem(storageKey);
          return;
        }
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            savedAt: Date.now(),
            exact: Array.from(this.originals.entries())
              .slice(-BLIND_CACHE_MAX_ENTRIES)
              .map(([key, entry]) => [
                key,
                entry.text,
                entry.seenAt
              ]),
            stable: Array.from(this.stableOriginals.entries())
              .slice(-BLIND_CACHE_MAX_ENTRIES)
              .map(([key, entry]) => [
                key,
                entry.text,
                entry.seenAt
              ])
          })
        );
      } catch {}
    },

    scheduleOriginalCacheSave() {
      if (this.cacheSaveTimer !== null) {
        return;
      }
      this.cacheSaveTimer = setTimeout(() => {
        this.cacheSaveTimer = null;
        this.persistOriginals();
      }, BLIND_CACHE_SAVE_DELAY_MS);
    },

    cacheSeenAtIsFresh(seenAt, now = Date.now()) {
      return (
        Number.isFinite(seenAt) &&
        seenAt <= now + BLIND_CACHE_FUTURE_TOLERANCE_MS &&
        now - seenAt <= BLIND_CACHE_MAX_AGE_MS
      );
    },

    pruneOriginals(now = Date.now()) {
      for (const [key, entry] of this.originals) {
        if (!this.cacheSeenAtIsFresh(Number(entry.seenAt), now)) {
          this.originals.delete(key);
        }
      }
      for (const [key, entry] of this.stableOriginals) {
        if (!this.cacheSeenAtIsFresh(Number(entry.seenAt), now)) {
          this.stableOriginals.delete(key);
        }
      }
    },

    cachedOriginal(cache, key) {
      if (!key || !cache.has(key)) {
        return "";
      }
      const entry = cache.get(key);
      if (!this.cacheSeenAtIsFresh(Number(entry.seenAt))) {
        cache.delete(key);
        this.scheduleOriginalCacheSave();
        return "";
      }
      return entry.text || "";
    },

    clearOriginalCache() {
      clearTimeout(this.cacheSaveTimer);
      this.cacheSaveTimer = null;
      try {
        const storageKeys = new Set();
        for (let index = 0; index < sessionStorage.length; index += 1) {
          const key = sessionStorage.key(index);
          if (key?.startsWith(BLIND_CACHE_STORAGE_PREFIX)) {
            storageKeys.add(key);
          }
        }
        const currentKey = this.originalCacheStorageKey();
        if (currentKey) {
          storageKeys.add(currentKey);
        }
        for (const key of storageKeys) {
          sessionStorage.removeItem(key);
        }
      } catch {}
      this.originals.clear();
      this.stableOriginals.clear();
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

    stableMessageKey(message) {
      const user = String(message?.user || "");
      const time = Number(message?.time);
      return user && Number.isFinite(time) ? `${user}:${time}` : "";
    },

    remember(key, text, message) {
      if (
        !key ||
        !text ||
        text.length > BLIND_CACHE_MAX_TEXT_LENGTH ||
        core.isBlindChatPlaceholder(text)
      ) {
        return;
      }
      const now = Date.now();
      let changed = this.rememberOriginal(this.originals, key, text, now);
      const stableKey = this.stableMessageKey(message);
      if (stableKey) {
        changed =
          this.rememberOriginal(this.stableOriginals, stableKey, text, now) ||
          changed;
      }
      if (changed) {
        this.scheduleOriginalCacheSave();
      }
    },

    rememberOriginal(cache, key, text, now) {
      const entry = cache.get(key);
      const changed = entry?.text !== text;
      const needsRefresh =
        now - Number(entry?.seenAt || 0) >= BLIND_CACHE_SEEN_REFRESH_MS;
      if (changed || needsRefresh) {
        cache.set(key, { text, seenAt: now });
      }
      if (cache.size > BLIND_CACHE_MAX_ENTRIES) {
        cache.delete(cache.keys().next().value);
      }
      return changed || needsRefresh;
    },

    directOriginal(message) {
      for (const text of [
        contentText(message?.originalContent),
        contentText(message?.content)
      ]) {
        if (text && !core.isBlindChatPlaceholder(text)) {
          return text;
        }
      }
      return "";
    },

    recoverableOriginal(message, key) {
      for (const text of [
        this.directOriginal(message),
        this.cachedOriginal(this.originals, key),
        this.cachedOriginal(this.stableOriginals, this.stableMessageKey(message))
      ]) {
        if (text && !core.isBlindChatPlaceholder(text)) {
          return text;
        }
      }
      return "";
    },

    clearRestoredNickname(target) {
      target.classList.remove("cng-restored-nickname");
      this.restoredNicknameStates.delete(target);
    },

    nicknameStyleSignature(target) {
      const parts = [];
      let current = target;
      for (let depth = 0; current && depth < 4; depth += 1) {
        const className = Array.from(current.classList || [])
          .filter((name) => name !== "cng-restored-nickname")
          .sort()
          .join(".");
        parts.push(`${className}|${current.getAttribute?.("style") || ""}`);
        current = current.parentElement;
      }
      return parts.join(">");
    },

    restoreNickname(item, message, key) {
      const nickname = message?.profile?.nickname || "";
      const candidates = Array.from(
        item.querySelectorAll(
          nickname
            ? "button, [class*='nickname'], [class*='username']"
            : "[class*='nickname'], [class*='username']"
        )
      ).slice(0, 20);
      for (const candidate of candidates) {
        const hasRestoredClass = candidate.classList.contains(
          "cng-restored-nickname"
        );
        const restoredState = this.restoredNicknameStates.get(candidate);
        const styleSignature = this.nicknameStyleSignature(candidate);
        const matchesNickname =
          !nickname || (candidate.textContent || "").includes(nickname);

        if (!settings.restoreTransparentNicknames || !matchesNickname) {
          if (hasRestoredClass || restoredState !== undefined) {
            this.clearRestoredNickname(candidate);
          }
          continue;
        }

        if (
          hasRestoredClass &&
          restoredState?.key === key &&
          restoredState.styleSignature === styleSignature
        ) {
          continue;
        }

        if (hasRestoredClass || restoredState !== undefined) {
          this.clearRestoredNickname(candidate);
        }
        if (core.shouldRestoreTransparentNickname(getComputedStyle(candidate))) {
          candidate.classList.add("cng-restored-nickname");
          this.restoredNicknameStates.set(candidate, {
            key,
            styleSignature: this.nicknameStyleSignature(candidate)
          });
        }
      }
    },

    clearRestoredMessage(target, { restorePlaceholder = true } = {}) {
      const placeholder = target.dataset.cngBlindPlaceholder;
      const restoredText = target.dataset.cngRestoredText;
      const cleanedText = core.chatTextAfterRestoreCleanup(
        target.textContent,
        restoredText,
        placeholder,
        restorePlaceholder
      );
      if (target.textContent !== cleanedText) {
        target.textContent = cleanedText;
      }
      delete target.dataset.cngBlindedRestored;
      delete target.dataset.cngBlindPlaceholder;
      delete target.dataset.cngRestoredText;
      target.classList.remove("cng-restored-message");
    },

    cleanItemState(item, key, blindState, visibleText) {
      for (const target of item.querySelectorAll("[data-cng-blinded-restored]")) {
        const restoredKey = target.dataset.cngBlindedRestored;
        if (restoredKey !== key) {
          if (
            blindState === "visible" &&
            visibleText &&
            target.textContent === target.dataset.cngRestoredText
          ) {
            target.textContent = visibleText;
            this.clearRestoredMessage(target, { restorePlaceholder: false });
          } else {
            this.clearRestoredMessage(target);
          }
        } else if (blindState === "visible") {
          this.clearRestoredMessage(target, { restorePlaceholder: false });
        } else if (blindState === "blinded" && !visibleText) {
          this.clearRestoredMessage(target);
        }
      }

      for (const target of item.querySelectorAll(".cng-restored-nickname")) {
        if (
          !settings.restoreTransparentNicknames ||
          this.restoredNicknameStates.get(target)?.key !== key
        ) {
          this.clearRestoredNickname(target);
        }
      }
      if (!settings.restoreBlindedMessages) {
        for (const target of item.querySelectorAll("[data-cng-blinded-restored]")) {
          this.clearRestoredMessage(target);
        }
      }
    },

    cleanupDisabledFeatures() {
      if (!settings.chatTimestamp) {
        for (const target of document.querySelectorAll(".cng-chat-timestamp")) {
          target.remove();
        }
      }
      if (!settings.restoreTransparentNicknames) {
        for (const target of document.querySelectorAll(".cng-restored-nickname")) {
          this.clearRestoredNickname(target);
        }
      }
      if (!settings.restoreBlindedMessages) {
        this.clearOriginalCache();
        for (const target of document.querySelectorAll("[data-cng-blinded-restored]")) {
          this.clearRestoredMessage(target);
        }
        this.hasRestoredMessages = false;
      }
    },

    blindNoticeTarget(item) {
      return (
        Array.from(item.querySelectorAll("p, span, div"))
          .filter((element) =>
            core.isBlindChatPlaceholder(element.textContent)
          )
          .sort(
            (left, right) =>
              (left.textContent || "").length -
              (right.textContent || "").length
          )[0] || null
      );
    },

    hasNativeHiddenChatStyle(item) {
      const className = typeof item.className === "string" ? item.className : "";
      return (
        /(?:^|\s)[^\s]*_is_hidden_[^\s]*(?:\s|$)/i.test(
          className
        ) ||
        Boolean(item.querySelector("[class*='_is_hidden_']"))
      );
    },

    blindStateForItem(item, message, key) {
      const officialState = core.chatMessageBlindState(message, "");
      const blindNotice = this.blindNoticeTarget(item);
      if (blindNotice && this.recoverableOriginal(message, key)) {
        return "blinded";
      }
      const restoredTarget = item.querySelector(
        "[data-cng-blinded-restored]"
      );
      if (restoredTarget && this.hasNativeHiddenChatStyle(item)) {
        return "blinded";
      }
      if (officialState === "visible") {
        return "visible";
      }
      if (blindNotice) {
        return "blinded";
      }
      if (
        restoredTarget &&
        core.chatMessageStatus(message) === "CBOTBLIND" &&
        restoredTarget.textContent === this.recoverableOriginal(message, key)
      ) {
        return "visible";
      }
      return officialState;
    },

    restoreBlinded(item, message, key, blindState) {
      if (!settings.restoreBlindedMessages || blindState !== "blinded") {
        return;
      }
      const original = this.recoverableOriginal(message, key);
      if (!original) {
        return;
      }

      const restoredTarget = Array.from(
        item.querySelectorAll("[data-cng-blinded-restored]")
      ).find((element) => element.dataset.cngBlindedRestored === key);
      if (restoredTarget?.textContent === original) {
        if (!restoredTarget.classList.contains("cng-restored-message")) {
          restoredTarget.classList.add("cng-restored-message");
        }
        this.hasRestoredMessages = true;
        return;
      }

      const target = restoredTarget || this.blindNoticeTarget(item);
      if (!target) {
        return;
      }
      if (
        core.isBlindChatPlaceholder(original) &&
        target.textContent === original
      ) {
        return;
      }
      if (
        target.dataset.cngBlindedRestored !== key ||
        target.textContent !== target.dataset.cngRestoredText
      ) {
        target.dataset.cngBlindPlaceholder = target.textContent || "";
      }
      if (target.textContent !== original) {
        target.textContent = original;
      }
      target.dataset.cngBlindedRestored = key;
      target.dataset.cngRestoredText = original;
      target.classList.add("cng-restored-message");
      this.hasRestoredMessages = true;
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
      if (stamp.textContent !== timestamp) {
        stamp.textContent = timestamp;
      }
      if (stamp.dataset.messageKey !== key) {
        stamp.dataset.messageKey = key;
      }
    },

    clearItemState(item) {
      item.querySelector(".cng-chat-timestamp")?.remove();
      for (const target of item.querySelectorAll(".cng-restored-nickname")) {
        this.clearRestoredNickname(target);
      }
      for (const target of item.querySelectorAll("[data-cng-blinded-restored]")) {
        this.clearRestoredMessage(target);
      }
    },

    processItem(item) {
      if (!(item instanceof HTMLElement)) {
        return;
      }
      const message = chatMessageForItem(item);
      if (!message?.time) {
        this.clearItemState(item);
        return;
      }
      const key = String(message.key || `${message.user || "chat"}-${message.time}`);
      const routeIdentity = this.stableMessageKey(message) || key;
      const previousItemRoute = this.itemRoutes.get(item);
      if (
        previousItemRoute?.route !== this.route &&
        previousItemRoute?.identity === routeIdentity
      ) {
        return;
      }
      this.itemRoutes.set(item, {
        route: this.route,
        identity: routeIdentity
      });
      const blindState = this.blindStateForItem(item, message, key);
      const directOriginal = this.directOriginal(message);
      const original = this.recoverableOriginal(message, key);
      this.cleanItemState(item, key, blindState, original);
      if (settings.restoreBlindedMessages) {
        this.remember(key, directOriginal, message);
      }
      this.addTimestamp(item, message, key);
      this.restoreNickname(item, message, key);
      this.restoreBlinded(item, message, key, blindState);
    },

    verifyRestoredMessages() {
      if (!settings.restoreBlindedMessages || !this.hasRestoredMessages) {
        return;
      }
      this.ensureRoute();
      if (!this.route) {
        for (const target of document.querySelectorAll(
          "[data-cng-blinded-restored]"
        )) {
          this.clearRestoredMessage(target);
        }
        this.hasRestoredMessages = false;
        return;
      }
      const targets = Array.from(
        document.querySelectorAll("[data-cng-blinded-restored]")
      );
      this.hasRestoredMessages = targets.length > 0;
      for (const target of targets) {
        const chatLog = target.closest?.("[role='log']");
        const item = chatLog ? this.itemForElement(target, chatLog) : null;
        if (!item) {
          continue;
        }
        const message = chatMessageForItem(item);
        if (!message?.time) {
          this.clearItemState(item);
          continue;
        }
        const key = String(
          message.key || `${message.user || "chat"}-${message.time}`
        );
        const routeIdentity = this.stableMessageKey(message) || key;
        const previousItemRoute = this.itemRoutes.get(item);
        if (
          previousItemRoute?.route !== this.route &&
          previousItemRoute?.identity === routeIdentity
        ) {
          this.clearRestoredMessage(target);
          continue;
        }
        const blindState = this.blindStateForItem(item, message, key);
        const original = this.recoverableOriginal(message, key);
        if (
          target.dataset.cngBlindedRestored !== key ||
          blindState === "visible" ||
          (blindState === "blinded" &&
            original &&
            (target.textContent !== original ||
              !target.classList.contains("cng-restored-message")))
        ) {
          this.processItem(item);
        }
      }
    },

    scan(root = document) {
      if (!this.enabled()) {
        return;
      }
      this.ensureRoute();
      if (!this.route) {
        return;
      }
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
      this.scanTimer = null;
      if (!this.enabled()) {
        return;
      }
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scan();
      }, 50);
    },

    onMutations(mutations) {
      if (!this.enabled()) {
        return;
      }
      let affectsChat = false;
      for (const mutation of mutations) {
        const mutationElement =
          mutation.target instanceof HTMLElement
            ? mutation.target
            : mutation.target.parentElement;
        if (
          mutationElement?.closest?.("[role='log']") &&
          (mutation.type === "characterData" ||
            mutation.type === "attributes" ||
            mutation.addedNodes.length > 0 ||
            mutation.removedNodes.length > 0)
        ) {
          affectsChat = true;
          break;
        }
        for (const node of mutation.addedNodes) {
          const element =
            node instanceof HTMLElement ? node : node.parentElement;
          if (
            element?.closest?.("[role='log']") ||
            element?.matches?.("[role='log']") ||
            element?.querySelector?.("[role='log']")
          ) {
            affectsChat = true;
            break;
          }
        }
        if (affectsChat) {
          break;
        }
      }
      if (affectsChat) {
        this.scheduleScan();
      }
    },

    connect() {
      if (!this.enabled() || this.observer) {
        return;
      }
      if (!document.body) {
        if (!this.waitingForBody) {
          this.waitingForBody = true;
          document.addEventListener(
            "DOMContentLoaded",
            () => {
              this.waitingForBody = false;
              this.connect();
            },
            { once: true }
          );
        }
        return;
      }

      this.observer = new MutationObserver((mutations) =>
        this.onMutations(mutations)
      );
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "data-index",
          "data-key",
          "data-virtual-index",
          "aria-posinset",
          "role"
        ]
      });
      this.scanInterval = setInterval(() => this.scan(), 3000);
      this.verifyInterval = setInterval(
        () => this.verifyRestoredMessages(),
        100
      );
      this.scan();
    },

    disconnect() {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
      clearTimeout(this.cacheSaveTimer);
      this.cacheSaveTimer = null;
      this.persistOriginals();
      this.observer?.disconnect();
      this.observer = null;
      if (this.scanInterval !== null) {
        clearInterval(this.scanInterval);
        this.scanInterval = null;
      }
      if (this.verifyInterval !== null) {
        clearInterval(this.verifyInterval);
        this.verifyInterval = null;
      }
      this.originals.clear();
      this.stableOriginals.clear();
      this.itemRoutes = new WeakMap();
      this.route = "";
      this.restoredNicknameStates = new WeakMap();
      this.hasRestoredMessages = false;
    },

    setEnabled(enabled) {
      if (enabled) {
        this.connect();
      } else {
        this.disconnect();
      }
    },

    start() {
      window.addEventListener("pagehide", () => this.persistOriginals());
      this.setEnabled(this.enabled());
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
    const previousTargetLoudnessDb = loudness.currentTargetLoudnessDb();
    const previousCompressAudio = settings.compressAudio;
    const previousCompressorPreset = settings.compressorPreset;
    settings = { ...settings, ...nextSettings };
    if (!settings.normalizeVolume) {
      loudness.disableNormalization();
    }
    loudness.configureCompressor(settings.compressAudio);
    loudness.configureLimiter(
      settings.normalizeVolume || settings.compressAudio
    );
    if (settings.normalizeVolume || settings.compressAudio) {
      loudness.ensureGraph();
    }
    if (
      settings.normalizeVolume &&
      (previousCompressAudio !== settings.compressAudio ||
        previousCompressorPreset !== settings.compressorPreset)
    ) {
      loudness.resetMeasurement();
    }
    if (
      previousMaximumBoostDb !== loudness.currentMaximumBoostDb() ||
      previousTargetLoudnessDb !== loudness.currentTargetLoudnessDb()
    ) {
      loudness.refreshNormalizationPlan();
    }
    if (!settings.timelineAssist) {
      timelineAssist.remove();
    }
    sidebarPreview.setEnabled(Boolean(settings.sidebarPreview));
    chatEnhancements.cleanupDisabledFeatures();
    chatEnhancements.setEnabled(chatEnhancements.enabled());
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
    initialLiveEdgeSync.start();
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

  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: "ready",
      settingsDefaults: DEFAULT_SETTINGS
    },
    "*"
  );
})();
