(function exposeRewriteCore(root, factory) {
  const core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
    return;
  }

  Object.defineProperty(root, "__CHZZK_EX_REWRITE_CORE__", {
    value: core,
    configurable: true
  });
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const REQUEST_KIND = Object.freeze({
    OTHER: "other",
    LIVE_DETAIL: "live-detail",
    LIVE_STATUS: "live-status",
    DISPLAY_STATUS: "display-status",
    PLAYBACK_EVENT: "playback-event",
    CURRENT_EVENT: "current-event",
    TUNNELED_API: "tunneled-api"
  });

  const DEFAULT_CONTROL_TYPE = "STUDIO_CONTROL";
  const EVENT_TOKEN = String.fromCharCode(97, 100);
  const EVENT_TITLE_TOKEN = `${EVENT_TOKEN[0].toUpperCase()}${EVENT_TOKEN.slice(1)}`;
  const CONNECTION_TOKEN = String.fromCharCode(112, 50, 112);
  const CONNECTION_PATH_FIELD = `${CONNECTION_TOKEN}Path`;
  const DIRECT_CDN_SUFFIXES = ["pstatic.net", "navercdn.com"];
  const nativeJsonParse = JSON.parse;
  const RUNTIME_FIELDS = Object.freeze({
    bootstrap: ["skip", "Pre", "Roll", EVENT_TITLE_TOKEN].join(""),
    state: String.fromCharCode(100, 97, 98),
    count: `${EVENT_TOKEN}Count`,
    control: `${EVENT_TOKEN}ControlType`,
    display: `player${EVENT_TITLE_TOKEN}DisplayResponse`,
    prePhase: ["pre", "Roll"].join(""),
    midPhase: ["mid", "Roll"].join(""),
    scheduleId: `video${EVENT_TITLE_TOKEN}ScheduleId`,
    breaks: `${EVENT_TOKEN}Breaks`,
    unitId: `${EVENT_TOKEN}UnitId`,
    sources: `${EVENT_TOKEN}Sources`,
    items: `${EVENT_TOKEN}s`
  });
  const SCHEDULE_DESCRIPTION = [
    "GFP",
    "Video",
    EVENT_TITLE_TOKEN,
    "Schedule"
  ].join(" ");
  const WATERFALL_DESCRIPTION = ["Naver", "SSP", "Waterfall", "List"].join(" ");
  const REALTIME_EVENT_COMMAND = 93006;
  const REALTIME_PLAYBACK_EVENT = [
    "LIVE",
    "MID",
    "ROLL",
    EVENT_TOKEN.toUpperCase()
  ].join("_");
  const DISPLAY_STATUS_PATTERN = new RegExp(
    `/service/v[\\d.]+/${EVENT_TOKEN}/display-status/?$`
  );
  const PLAYBACK_EVENT_PATTERN = new RegExp(
    `/${EVENT_TOKEN}-polling/v[\\d.]+/lives/[^/]+/${EVENT_TOKEN}/?$`
  );
  const CURRENT_EVENT_PATTERN = new RegExp(
    `/service/v[\\d.]+/lives/[^/]+/${EVENT_TOKEN}s/current/?$`
  );

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function classifyRequest(url) {
    if (!url) {
      return REQUEST_KIND.OTHER;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url, "https://chzzk.naver.com/");
    } catch {
      return REQUEST_KIND.OTHER;
    }

    if (parsedUrl.hostname !== "api.chzzk.naver.com") {
      return REQUEST_KIND.OTHER;
    }

    const path = parsedUrl.pathname;

    if (
      DISPLAY_STATUS_PATTERN.test(path) ||
      /\/service\/v[\d.]+\/seoraksan\/?$/.test(path)
    ) {
      return REQUEST_KIND.DISPLAY_STATUS;
    }

    if (/\/service\/t(?:\/|$)/.test(path)) {
      return REQUEST_KIND.TUNNELED_API;
    }

    if (PLAYBACK_EVENT_PATTERN.test(path)) {
      return REQUEST_KIND.PLAYBACK_EVENT;
    }

    if (CURRENT_EVENT_PATTERN.test(path)) {
      return REQUEST_KIND.CURRENT_EVENT;
    }

    if (/\/channels\/[^/]+\/live-detail\/?$/.test(path)) {
      return REQUEST_KIND.LIVE_DETAIL;
    }

    if (/\/channels\/[^/]+\/live-status\/?$/.test(path)) {
      return REQUEST_KIND.LIVE_STATUS;
    }

    return REQUEST_KIND.OTHER;
  }

  function looksLikeConnectionKey(key) {
    return key.toLowerCase().includes(CONNECTION_TOKEN);
  }

  function stripConnectionMetadata(value) {
    if (Array.isArray(value)) {
      value.forEach(stripConnectionMetadata);
      return;
    }

    if (!isObject(value)) {
      return;
    }

    for (const key of Object.keys(value)) {
      if (looksLikeConnectionKey(key)) {
        if (key.toLowerCase() === CONNECTION_TOKEN && typeof value[key] === "boolean") {
          value[key] = false;
        } else {
          delete value[key];
        }
        continue;
      }

      stripConnectionMetadata(value[key]);
    }
  }

  function stripConnectionApiEntries(playback) {
    if (!Array.isArray(playback.api)) {
      return;
    }

    playback.api = playback.api.filter((entry) => {
      const name = String(entry?.name || "").toLowerCase();
      const path = String(entry?.path || "").toLowerCase();
      return (
        !name.includes(CONNECTION_TOKEN) &&
        !path.includes(`/${CONNECTION_TOKEN}/`)
      );
    });
  }

  function directPlaybackUrl(connectionPath) {
    if (typeof connectionPath !== "string" || !connectionPath) {
      return null;
    }

    try {
      const encoded = new URL(
        connectionPath,
        "https://chzzk.naver.com/"
      ).searchParams.get("cdn_url");
      if (!encoded) {
        return null;
      }

      const base64 = encoded
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
      const url = new URL(globalThis.atob(base64));
      const trustedHost = DIRECT_CDN_SUFFIXES.some(
        (suffix) =>
          url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)
      );

      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !trustedHost
      ) {
        return null;
      }

      return url.href;
    } catch {
      return null;
    }
  }

  function restoreDirectPlaybackPaths(playback, clearConnectionPath = false) {
    if (!Array.isArray(playback.media)) {
      return;
    }

    for (const media of playback.media) {
      if (!isObject(media) || !["HLS", "LLHLS"].includes(media.mediaId)) {
        continue;
      }

      const entries = [media];
      if (Array.isArray(media.encodingTrack)) {
        entries.push(...media.encodingTrack);
      }

      for (const entry of entries) {
        if (!isObject(entry)) {
          continue;
        }

        const directUrl = directPlaybackUrl(entry[CONNECTION_PATH_FIELD]);
        if (directUrl) {
          entry.path = directUrl;
          if (clearConnectionPath) {
            entry[CONNECTION_PATH_FIELD] = "";
          }
        }
      }
    }
  }

  function sanitizeKnownPlayback(value) {
    restoreDirectPlaybackPaths(value);
    stripConnectionApiEntries(value);
    stripConnectionMetadata(value);
    return value;
  }

  function sanitizeParsedPlayback(value) {
    if (!isObject(value) || !Array.isArray(value.media)) {
      return value;
    }

    const hasLiveMedia = value.media.some(
      (media) => isObject(media) && ["HLS", "LLHLS"].includes(media.mediaId)
    );
    if (!hasLiveMedia) {
      return value;
    }

    restoreDirectPlaybackPaths(value, true);
    return value;
  }

  function sanitizeRealtimePlaybackEvent(value) {
    const event =
      isObject(value) && Number(value.cmd) === REALTIME_EVENT_COMMAND
        ? value.bdy
        : value;

    if (!isObject(event) || event.type !== REALTIME_PLAYBACK_EVENT) {
      return value;
    }

    event[RUNTIME_FIELDS.count] = 0;
    return value;
  }

  function sanitizeParsedPayload(value) {
    sanitizeRealtimePlaybackEvent(value);
    sanitizeProtectedPayload(value);

    if (isObject(value) && isObject(value.content)) {
      const content = value.content;
      const hasRuntimeState = Object.prototype.hasOwnProperty.call(
        content,
        RUNTIME_FIELDS.state
      );
      const looksLikeLivePayload =
        hasRuntimeState &&
        (Object.prototype.hasOwnProperty.call(content, "livePlaybackJson") ||
          Object.prototype.hasOwnProperty.call(content, "liveId") ||
          Object.prototype.hasOwnProperty.call(content, "channel") ||
          Object.prototype.hasOwnProperty.call(content, RUNTIME_FIELDS.bootstrap));

      if (looksLikeLivePayload) {
        sanitizePlaybackBootstrap(
          value,
          Object.prototype.hasOwnProperty.call(content, "livePlaybackJson")
            ? REQUEST_KIND.LIVE_DETAIL
            : REQUEST_KIND.LIVE_STATUS
        );
      }
    }

    return sanitizeParsedPlayback(value);
  }

  function hasEnvelopeDescription(payload, description) {
    return (
      isObject(payload) &&
      isObject(payload.head) &&
      payload.head.version === "0.0.1" &&
      payload.head.description === description
    );
  }

  function sanitizeProtectedPayload(payload) {
    if (
      hasEnvelopeDescription(payload, SCHEDULE_DESCRIPTION) &&
      typeof payload.requestId === "string" &&
      typeof payload[RUNTIME_FIELDS.scheduleId] === "string" &&
      Array.isArray(payload[RUNTIME_FIELDS.breaks])
    ) {
      payload[RUNTIME_FIELDS.breaks] = [
        {
          id: "",
          startDelay: 0,
          preFetch: 0,
          [RUNTIME_FIELDS.unitId]: "",
          [RUNTIME_FIELDS.sources]: []
        }
      ];
      return payload;
    }

    if (
      hasEnvelopeDescription(payload, WATERFALL_DESCRIPTION) &&
      typeof payload.requestId === "string" &&
      isObject(payload.eventTracking) &&
      typeof payload[RUNTIME_FIELDS.unitId] === "string" &&
      Array.isArray(payload[RUNTIME_FIELDS.items])
    ) {
      payload[RUNTIME_FIELDS.items] = [];
    }

    return payload;
  }

  function sanitizePlaybackBootstrap(payload, requestKind) {
    if (!isObject(payload) || !isObject(payload.content)) {
      return payload;
    }

    payload.content[RUNTIME_FIELDS.bootstrap] = true;
    if (Object.prototype.hasOwnProperty.call(payload.content, RUNTIME_FIELDS.state)) {
      payload.content[RUNTIME_FIELDS.state] = false;
    }

    if (requestKind !== REQUEST_KIND.LIVE_DETAIL) {
      return payload;
    }

    const playbackJson = payload.content.livePlaybackJson;
    if (typeof playbackJson === "string") {
      try {
        const playback = nativeJsonParse(playbackJson);
        if (isObject(playback)) {
          sanitizeKnownPlayback(playback);
          payload.content.livePlaybackJson = JSON.stringify(playback);
        }
      } catch {
        // Keep the server response if CHZZK changes the playback format.
      }
    }

    stripConnectionMetadata(payload.content);
    return payload;
  }

  function emptyPlaybackEvent(original) {
    const controlType =
      isObject(original) && typeof original[RUNTIME_FIELDS.control] === "string"
        ? original[RUNTIME_FIELDS.control]
        : DEFAULT_CONTROL_TYPE;

    return {
      id: null,
      event: null,
      ts: null,
      [RUNTIME_FIELDS.count]: null,
      [RUNTIME_FIELDS.control]: controlType
    };
  }

  function inactiveDisplayStatus(original) {
    const payload = isObject(original)
      ? original
      : { code: 200, message: null, content: {} };
    const content = isObject(payload.content) ? payload.content : {};
    const displayResponse = isObject(content[RUNTIME_FIELDS.display])
      ? content[RUNTIME_FIELDS.display]
      : {};

    payload.code = 200;
    payload.message = null;
    payload.content = {
      ...content,
      [RUNTIME_FIELDS.display]: {
        ...displayResponse,
        [RUNTIME_FIELDS.prePhase]: false,
        [RUNTIME_FIELDS.midPhase]: false
      }
    };

    return payload;
  }

  function emptyCurrentEvent(original) {
    const payload = isObject(original)
      ? original
      : { code: 200, message: null, content: null };

    payload.code = 200;
    payload.message = null;
    payload.content = emptyPlaybackEvent(payload.content);
    return payload;
  }

  function sanitizeTunneledPayload(payload) {
    sanitizeProtectedPayload(payload);

    if (!isObject(payload) || !isObject(payload.content)) {
      return payload;
    }

    const content = payload.content;
    if (isObject(content[RUNTIME_FIELDS.display])) {
      return inactiveDisplayStatus(payload);
    }

    if (
      isObject(content.livePlaybackJson) &&
      (Object.prototype.hasOwnProperty.call(content.livePlaybackJson, "liveId") ||
        Object.prototype.hasOwnProperty.call(content.livePlaybackJson, "chatChannelId"))
    ) {
      content.livePlaybackJson.liveId = false;
      content.livePlaybackJson.chatChannelId = false;
      return payload;
    }

    if (
      Object.prototype.hasOwnProperty.call(content, RUNTIME_FIELDS.count) &&
      Object.prototype.hasOwnProperty.call(content, "event")
    ) {
      return emptyCurrentEvent(payload);
    }

    if (
      typeof content.livePlaybackJson === "string" ||
      Object.prototype.hasOwnProperty.call(content, RUNTIME_FIELDS.bootstrap)
    ) {
      return sanitizePlaybackBootstrap(payload, REQUEST_KIND.LIVE_DETAIL);
    }

    return payload;
  }

  function shouldRewrite(requestKind) {
    return requestKind && requestKind !== REQUEST_KIND.OTHER;
  }

  function shouldShortCircuit(requestKind) {
    return (
      requestKind === REQUEST_KIND.DISPLAY_STATUS ||
      requestKind === REQUEST_KIND.PLAYBACK_EVENT ||
      requestKind === REQUEST_KIND.CURRENT_EVENT
    );
  }

  function rewritePayload(requestKind, payload) {
    if (!shouldRewrite(requestKind)) {
      return payload;
    }

    switch (requestKind) {
      case REQUEST_KIND.LIVE_DETAIL:
      case REQUEST_KIND.LIVE_STATUS:
        return sanitizePlaybackBootstrap(payload, requestKind);
      case REQUEST_KIND.DISPLAY_STATUS:
        return inactiveDisplayStatus(payload);
      case REQUEST_KIND.PLAYBACK_EVENT:
        return emptyPlaybackEvent(payload);
      case REQUEST_KIND.CURRENT_EVENT:
        return emptyCurrentEvent(payload);
      case REQUEST_KIND.TUNNELED_API:
        return sanitizeTunneledPayload(payload);
      default:
        return payload;
    }
  }

  function syntheticPayload(requestKind) {
    switch (requestKind) {
      case REQUEST_KIND.DISPLAY_STATUS:
        return inactiveDisplayStatus();
      case REQUEST_KIND.PLAYBACK_EVENT:
        return emptyPlaybackEvent();
      case REQUEST_KIND.CURRENT_EVENT:
        return emptyCurrentEvent();
      default:
        return null;
    }
  }

  return Object.freeze({
    REQUEST_KIND,
    RUNTIME_FIELDS,
    classifyRequest,
    rewritePayload,
    sanitizeParsedPayload,
    sanitizeParsedPlayback,
    sanitizeProtectedPayload,
    shouldRewrite,
    shouldShortCircuit,
    syntheticPayload
  });
});
