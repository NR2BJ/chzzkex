(() => {
  if (window.__CHZZK_EX_RUNTIME__) {
    return;
  }

  const core = globalThis.__CHZZK_EX_REWRITE_CORE__;
  const config = globalThis.__CHZZK_EX_CONFIG__;
  delete globalThis.__CHZZK_EX_REWRITE_CORE__;

  if (!core || !config) {
    console.error("[CHZZK EX] startup modules were not loaded");
    return;
  }

  Object.defineProperty(window, "__CHZZK_EX_RUNTIME__", {
    value: true,
    configurable: false
  });

  const nativeJsonParse = JSON.parse;
  const nativeUint8Array = globalThis.Uint8Array;
  const MESSAGE_SOURCE = "chzzk-ex";
  const { DEFAULT_SETTINGS } = config;
  const EVENT_TOKEN = String.fromCharCode(97, 100);
  const EVENT_TITLE_TOKEN = `${EVENT_TOKEN[0].toUpperCase()}${EVENT_TOKEN.slice(1)}`;
  const PLAYBACK_REJECTION_EVENT = [
    EVENT_TOKEN.toUpperCase(),
    "NOT",
    "DISPLAYED"
  ].join("_");
  const PLAYBACK_ADVANCE_EVENT = ["ui", EVENT_TOKEN, "skip"].join("_");
  const PLAYBACK_ADVANCE_DELAY_MS = 150;
  const PRIMARY_MUTE_RESTORE_DELAY_MS = 500;
  const PRIMARY_UNMUTED_SNAPSHOT_DELAY_MS = 750;
  const USER_VOLUME_INTENT_WINDOW_MS = 1200;
  const MAX_PROTECTED_PAYLOAD_BYTES = 2 * 1024 * 1024;
  const FILTER_PLAYBACK_RUNTIME = Symbol.for("chzzkfilter-playback");
  const PROTECTED_BYTES_RUNTIME = Symbol.for("chzzk-ex-protected-bytes");
  const PROTECTED_CRYPTO_RUNTIME = Symbol.for("chzzk-ex-protected-crypto");
  const REJECTION_GUARD_RUNTIME = Symbol.for("chzzk-ex-rejection-guard");
  const ownsPlaybackTransport = !window[FILTER_PLAYBACK_RUNTIME];
  const KOREAN_EVENT_LABEL = String.fromCharCode(44305, 44256);
  const KOREAN_SKIP_LABEL = String.fromCharCode(49828, 53429);
  const AUXILIARY_VIDEO_CONTAINER_SELECTOR = [
    `[data-role='${EVENT_TOKEN}VideoContainerEl']`,
    `[data-role='ima${EVENT_TITLE_TOKEN}ContainerEl']`,
    `[data-role='gv${EVENT_TITLE_TOKEN}ContainerEl']`,
    `#mid${EVENT_TITLE_TOKEN}VideoContainer`,
    `#mid${EVENT_TITLE_TOKEN}PlayerWrapper`
  ].join(", ");
  const AUXILIARY_CONTEXT_SELECTOR = [
    AUXILIARY_VIDEO_CONTAINER_SELECTOR,
    `[class*='${EVENT_TOKEN}_']`,
    `[class*='${EVENT_TOKEN}vert']`
  ].join(", ");
  const EVENT_SKIP_PATTERN = new RegExp(
    `${KOREAN_EVENT_LABEL}\\s*(?:SKIP|${KOREAN_SKIP_LABEL})|skip\\s*${EVENT_TOKEN}`,
    "i"
  );
  const EVENT_CONTEXT_PATTERN = new RegExp(
    `${KOREAN_EVENT_LABEL}|\\b${EVENT_TOKEN}\\b`,
    "i"
  );
  const AUXILIARY_CONTAINER_CLASS = "chzzk-ex-auxiliary";
  const AUXILIARY_MEDIA_HOST_PATTERN = /(^|\.)((tvetamovie\.pstatic\.net)|(glad-vod\.pstatic\.net)|(video-gfa\.pstatic\.net))$/i;

  let settings = { ...DEFAULT_SETTINGS };
  let playbackAdvanceListeners;
  let pendingPrimaryMuted;
  let preferredPrimaryMuted;
  let lastUserVolumeIntentAt = Number.NEGATIVE_INFINITY;
  const advancedAuxiliaryVideos = new WeakSet();
  const pendingAuxiliaryVideos = new WeakSet();
  const pendingPrimarySnapshots = new WeakSet();

  function suppressPlaybackRejectionSignal() {
    if (globalThis[REJECTION_GUARD_RUNTIME]) {
      return;
    }

    const existingDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      PLAYBACK_REJECTION_EVENT
    );
    if (!existingDescriptor || existingDescriptor.configurable) {
      Object.defineProperty(Object.prototype, PLAYBACK_REJECTION_EVENT, {
        configurable: true,
        get() {
          return undefined;
        },
        set(value) {
          if (value !== PLAYBACK_REJECTION_EVENT) {
            return;
          }

          Object.defineProperty(this, PLAYBACK_REJECTION_EVENT, {
            value,
            configurable: true,
            enumerable: true,
            writable: true
          });
        }
      });
    }

    const mapPrototype = globalThis.Map?.prototype;
    const nativeMapGet = mapPrototype?.get;
    const nativeMapSet = mapPrototype?.set;
    if (typeof nativeMapGet === "function" && typeof nativeMapSet === "function") {
      Object.defineProperties(mapPrototype, {
        get: {
          value: function guardedMapGet(key) {
            if (key === PLAYBACK_REJECTION_EVENT) {
              return [];
            }
            return nativeMapGet.apply(this, arguments);
          },
          configurable: true,
          writable: true
        },
        set: {
          value: function guardedMapSet(key) {
            if (key === PLAYBACK_REJECTION_EVENT) {
              return this;
            }
            return nativeMapSet.apply(this, arguments);
          },
          configurable: true,
          writable: true
        }
      });
    }

    const eventTargetPrototype = globalThis.EventTarget?.prototype;
    const nativeAddEventListener = eventTargetPrototype?.addEventListener;
    if (typeof nativeAddEventListener === "function") {
      Object.defineProperty(eventTargetPrototype, "addEventListener", {
        value: function guardedAddEventListener(type) {
          if (type === PLAYBACK_REJECTION_EVENT) {
            return undefined;
          }
          return nativeAddEventListener.apply(this, arguments);
        },
        configurable: true,
        writable: true
      });
    }

    Object.defineProperty(globalThis, REJECTION_GUARD_RUNTIME, {
      value: true,
      configurable: false
    });
  }

  function capturePlaybackAdvanceSignal() {
    if (
      Object.prototype.hasOwnProperty.call(
        Object.prototype,
        PLAYBACK_ADVANCE_EVENT
      )
    ) {
      return;
    }

    Object.defineProperty(Object.prototype, PLAYBACK_ADVANCE_EVENT, {
      configurable: true,
      get() {
        return undefined;
      },
      set(value) {
        if (Array.isArray(value)) {
          playbackAdvanceListeners = value;
        }

        Object.defineProperty(this, PLAYBACK_ADVANCE_EVENT, {
          value,
          configurable: true,
          enumerable: true,
          writable: true
        });
      }
    });
  }

  suppressPlaybackRejectionSignal();
  if (ownsPlaybackTransport) {
    capturePlaybackAdvanceSignal();
  }

  function log(...args) {
    if (settings.debug) {
      console.debug("[CHZZK EX]", ...args);
    }
  }

  function markAuxiliaryContainers() {
    for (const element of document.querySelectorAll(AUXILIARY_VIDEO_CONTAINER_SELECTOR)) {
      element.classList.add(AUXILIARY_CONTAINER_CLASS);
    }
  }

  function applyVisualGuard() {
    markAuxiliaryContainers();
    document.documentElement?.classList.toggle(
      "chzzk-ex-playback-active",
      true
    );
  }

  function applySettings(nextSettings) {
    settings = { ...settings, ...nextSettings };
    log("settings updated", settings);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE || data.type !== "settings") {
      return;
    }

    applySettings(data.settings);
  });

  function requestUrl(input) {
    try {
      if (typeof input === "string") {
        return new URL(input, location.href).href;
      }

      if (input instanceof URL) {
        return input.href;
      }

      if (input instanceof Request) {
        return input.url;
      }

      if (input && typeof input.url === "string") {
        return new URL(input.url, location.href).href;
      }
    } catch (error) {
      log("failed to normalize url", error);
    }

    return "";
  }

  function jsonHeaders(headers) {
    const nextHeaders = new Headers(headers);
    nextHeaders.set("content-type", "application/json;charset=utf-8");
    nextHeaders.delete("content-length");
    nextHeaders.delete("content-encoding");
    return nextHeaders;
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json;charset=utf-8"
      }
    });
  }

  function rewriteJsonText(text, requestKind) {
    try {
      const payload = nativeJsonParse(text);
      const originalJson = JSON.stringify(payload);
      const rewrittenJson = JSON.stringify(
        core.rewritePayload(requestKind, payload)
      );
      return rewrittenJson === originalJson ? null : rewrittenJson;
    } catch (error) {
      log("json rewrite skipped", requestKind, error);
      return null;
    }
  }

  function startsWithJsonObject(bytes) {
    if (!bytes || bytes.byteLength === 0) {
      return false;
    }

    let index = 0;
    if (
      bytes.byteLength >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      index = 3;
    }

    while (
      index < bytes.byteLength &&
      (bytes[index] === 0x09 ||
        bytes[index] === 0x0a ||
        bytes[index] === 0x0d ||
        bytes[index] === 0x20)
    ) {
      index += 1;
    }

    return bytes[index] === 0x7b;
  }

  function installProtectedByteRewrite() {
    if (
      globalThis[PROTECTED_BYTES_RUNTIME] ||
      typeof nativeUint8Array !== "function" ||
      typeof globalThis.TextDecoder !== "function" ||
      typeof globalThis.TextEncoder !== "function"
    ) {
      return;
    }

    const decoder = new globalThis.TextDecoder("utf-8", { fatal: true });
    const decode = globalThis.TextDecoder.prototype.decode;
    const encoder = new globalThis.TextEncoder();

    try {
      const patchedUint8Array = new Proxy(nativeUint8Array, {
        construct(target, args, newTarget) {
          const bytes = Reflect.construct(target, args, newTarget);
          if (
            bytes.byteLength > MAX_PROTECTED_PAYLOAD_BYTES ||
            !startsWithJsonObject(bytes)
          ) {
            return bytes;
          }

          try {
            const text = decode.call(decoder, bytes);
            const rewritten = rewriteJsonText(
              text,
              core.REQUEST_KIND.TUNNELED_API
            );
            if (rewritten === null) {
              return bytes;
            }

            log("rewrote protected byte payload");
            return Reflect.construct(target, [encoder.encode(rewritten)]);
          } catch {
            return bytes;
          }
        }
      });

      Object.defineProperty(globalThis, "Uint8Array", {
        value: patchedUint8Array,
        configurable: true,
        writable: true
      });
      Object.defineProperty(globalThis, PROTECTED_BYTES_RUNTIME, {
        value: true,
        configurable: false
      });
    } catch (error) {
      log("failed to install protected byte rewrite", error);
    }
  }

  function installProtectedCryptoRewrite() {
    const subtle = globalThis.crypto?.subtle;
    const subtlePrototype =
      globalThis.SubtleCrypto?.prototype ||
      (subtle ? Object.getPrototypeOf(subtle) : null);
    const nativeDecrypt = subtlePrototype?.decrypt;

    if (
      globalThis[PROTECTED_CRYPTO_RUNTIME] ||
      typeof nativeDecrypt !== "function" ||
      typeof nativeUint8Array !== "function" ||
      typeof globalThis.TextDecoder !== "function" ||
      typeof globalThis.TextEncoder !== "function"
    ) {
      return;
    }

    const decoder = new globalThis.TextDecoder("utf-8", { fatal: true });
    const decode = globalThis.TextDecoder.prototype.decode;
    const encoder = new globalThis.TextEncoder();

    try {
      Object.defineProperty(subtlePrototype, "decrypt", {
        value: function patchedDecrypt(algorithm) {
          const result = nativeDecrypt.apply(this, arguments);
          const algorithmName =
            typeof algorithm === "string" ? algorithm : algorithm?.name;
          if (String(algorithmName || "").toUpperCase() !== "AES-GCM") {
            return result;
          }

          return Promise.resolve(result).then((buffer) => {
            const bytes = new nativeUint8Array(buffer);
            if (
              bytes.byteLength > MAX_PROTECTED_PAYLOAD_BYTES ||
              !startsWithJsonObject(bytes)
            ) {
              return buffer;
            }

            try {
              const text = decode.call(decoder, bytes);
              const rewritten = rewriteJsonText(
                text,
                core.REQUEST_KIND.TUNNELED_API
              );
              if (rewritten === null) {
                return buffer;
              }

              log("rewrote authenticated response");
              return encoder.encode(rewritten).buffer;
            } catch {
              return buffer;
            }
          });
        },
        configurable: true,
        writable: true
      });
      Object.defineProperty(globalThis, PROTECTED_CRYPTO_RUNTIME, {
        value: true,
        configurable: false
      });
    } catch (error) {
      log("failed to install authenticated response rewrite", error);
    }
  }

  const textDecoderPrototype = globalThis.TextDecoder?.prototype;
  const nativeTextDecoderDecode = textDecoderPrototype?.decode;

  if (typeof nativeJsonParse === "function") {
    Object.defineProperty(JSON, "parse", {
      value: new Proxy(nativeJsonParse, {
        apply(target, thisArg, args) {
          return core.sanitizeParsedPayload(
            Reflect.apply(target, thisArg, args)
          );
        }
      }),
      configurable: true,
      writable: true
    });
  }

  installProtectedCryptoRewrite();
  installProtectedByteRewrite();

  function isProtectedTunnelDecoder(decoder) {
    return (
      decoder?.encoding === "utf-8" &&
      decoder.fatal === true &&
      decoder.ignoreBOM === false
    );
  }

  if (typeof nativeTextDecoderDecode === "function") {
    textDecoderPrototype.decode = function patchedTextDecoderDecode() {
      const decodedText = nativeTextDecoderDecode.apply(this, arguments);
      if (
        !isProtectedTunnelDecoder(this) ||
        typeof decodedText !== "string" ||
        !/^\s*\{/.test(decodedText)
      ) {
        return decodedText;
      }

      const rewrittenText = rewriteJsonText(
        decodedText,
        core.REQUEST_KIND.TUNNELED_API
      );
      if (rewrittenText === null) {
        return decodedText;
      }

      log("rewrote protected response");
      return rewrittenText;
    };
  }

  async function rewriteResponse(response, requestKind) {
    const text = await response.clone().text();
    if (!text) {
      return response;
    }

    const rewrittenText = rewriteJsonText(text, requestKind);
    if (rewrittenText === null) {
      return response;
    }

    return new Response(rewrittenText, {
      status: response.status,
      statusText: response.statusText,
      headers: jsonHeaders(response.headers)
    });
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function patchedFetch(input) {
      const url = requestUrl(input);
      const requestKind = core.classifyRequest(url);

      if (core.shouldShortCircuit(requestKind)) {
        log("handled playback decision request", requestKind);
        return jsonResponse(core.syntheticPayload(requestKind));
      }

      const response = await nativeFetch.apply(this, arguments);
      if (!core.shouldRewrite(requestKind)) {
        return response;
      }

      log("rewriting response", requestKind);
      return rewriteResponse(response, requestKind);
    };
  }

  const xhrPrototype = XMLHttpRequest.prototype;
  const nativeOpen = xhrPrototype.open;
  const nativeResponseTextGetter = Object.getOwnPropertyDescriptor(
    xhrPrototype,
    "responseText"
  )?.get;
  const nativeResponseGetter = Object.getOwnPropertyDescriptor(
    xhrPrototype,
    "response"
  )?.get;
  const xhrRequestKinds = new WeakMap();
  const xhrRewriteCache = new WeakMap();
  const xhrFacades = new WeakSet();

  function xhrCacheKey(xhr, requestKind) {
    return [requestKind, xhr.responseType || "text"].join(":");
  }

  function rewrittenXhrText(xhr, requestKind, originalText) {
    if (
      xhr.readyState !== XMLHttpRequest.DONE ||
      !core.shouldRewrite(requestKind) ||
      typeof originalText !== "string" ||
      !originalText
    ) {
      return originalText;
    }

    const key = xhrCacheKey(xhr, requestKind);
    const cached = xhrRewriteCache.get(xhr);
    if (cached?.key === key && cached.original === originalText) {
      return cached.rewritten;
    }

    const rewrittenText = rewriteJsonText(originalText, requestKind);
    const rewritten = rewrittenText === null ? originalText : rewrittenText;
    xhrRewriteCache.set(xhr, { key, original: originalText, rewritten });
    if (rewrittenText !== null) {
      log("rewrote XHR response", requestKind);
    }
    return rewritten;
  }

  function rewrittenXhrJson(xhr, requestKind, originalJson) {
    if (
      xhr.readyState !== XMLHttpRequest.DONE ||
      !core.shouldRewrite(requestKind) ||
      originalJson === null ||
      typeof originalJson !== "object"
    ) {
      return originalJson;
    }

    const key = xhrCacheKey(xhr, requestKind);
    const cached = xhrRewriteCache.get(xhr);
    if (cached?.key === key && cached.original === originalJson) {
      return cached.rewritten;
    }

    let clonedJson;
    try {
      clonedJson = nativeJsonParse(JSON.stringify(originalJson));
    } catch (error) {
      log("XHR JSON clone skipped", requestKind, error);
      return originalJson;
    }

    const originalSerialized = JSON.stringify(clonedJson);
    const rewritten = core.rewritePayload(requestKind, clonedJson);
    if (JSON.stringify(rewritten) === originalSerialized) {
      xhrRewriteCache.set(xhr, {
        key,
        original: originalJson,
        rewritten: originalJson
      });
      return originalJson;
    }

    xhrRewriteCache.set(xhr, { key, original: originalJson, rewritten });
    log("rewrote XHR JSON response", requestKind);
    return rewritten;
  }

  function installXhrFacade(xhr) {
    if (xhrFacades.has(xhr)) {
      return;
    }

    xhrFacades.add(xhr);

    if (nativeResponseTextGetter) {
      Object.defineProperty(xhr, "responseText", {
        configurable: true,
        get() {
          const originalText = nativeResponseTextGetter.call(this);
          const requestKind = xhrRequestKinds.get(this);
          return rewrittenXhrText(this, requestKind, originalText);
        }
      });
    }

    if (nativeResponseGetter) {
      Object.defineProperty(xhr, "response", {
        configurable: true,
        get() {
          const originalResponse = nativeResponseGetter.call(this);
          const requestKind = xhrRequestKinds.get(this);

          if (this.responseType === "json") {
            return rewrittenXhrJson(this, requestKind, originalResponse);
          }

          if (!this.responseType || this.responseType === "text") {
            return rewrittenXhrText(this, requestKind, originalResponse);
          }

          return originalResponse;
        }
      });
    }
  }

  function shouldInstallXhrFacade(requestKind) {
    return (
      core.shouldRewrite(requestKind) &&
      requestKind !== core.REQUEST_KIND.TUNNELED_API
    );
  }

  function uninstallXhrFacade(xhr) {
    if (!xhrFacades.has(xhr)) {
      return;
    }

    if (nativeResponseTextGetter) {
      delete xhr.responseText;
    }
    if (nativeResponseGetter) {
      delete xhr.response;
    }
    xhrFacades.delete(xhr);
  }

  if (typeof nativeOpen === "function") {
    xhrPrototype.open = function patchedOpen(method, url) {
      const result = nativeOpen.apply(this, arguments);
      const requestKind = core.classifyRequest(requestUrl(url));
      xhrRequestKinds.set(this, requestKind);
      xhrRewriteCache.delete(this);
      if (shouldInstallXhrFacade(requestKind)) {
        installXhrFacade(this);
      } else {
        uninstallXhrFacade(this);
      }
      if (core.shouldRewrite(requestKind)) {
        log("observed XHR route", requestKind);
      }
      return result;
    };
  }

  function clickElement(element) {
    if (!element || element.disabled) {
      return false;
    }

    element.click();
    return true;
  }

  function textOf(element) {
    return `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`.trim();
  }

  function isInterruptionSkipButton(button) {
    const text = textOf(button);
    if (EVENT_SKIP_PATTERN.test(text)) {
      return true;
    }
    if (!/건너뛰기/i.test(text)) {
      return false;
    }

    const context = button.closest(AUXILIARY_CONTEXT_SELECTOR);
    return Boolean(context && EVENT_CONTEXT_PATTERN.test(textOf(context)));
  }

  function hasKnownAuxiliaryMediaSource(video) {
    const source = video.currentSrc || video.src;
    if (!source || source.startsWith("blob:")) {
      return false;
    }

    try {
      return AUXILIARY_MEDIA_HOST_PATTERN.test(
        new URL(source, location.href).hostname
      );
    } catch {
      return false;
    }
  }

  function isAuxiliaryVideo(video) {
    return (
      Boolean(video.closest(AUXILIARY_VIDEO_CONTAINER_SELECTOR)) ||
      hasKnownAuxiliaryMediaSource(video)
    );
  }

  function hasActiveAuxiliaryPlayback() {
    return Array.from(document.querySelectorAll("video")).some(
      (video) =>
        isAuxiliaryVideo(video) &&
        Boolean(video.currentSrc || video.src) &&
        (!video.paused || video.readyState > 0)
    );
  }

  function volumeControlText(node) {
    if (!node || typeof node !== "object") {
      return "";
    }

    const className =
      typeof node.className === "string"
        ? node.className
        : node.className?.baseVal || "";
    return [
      node.localName,
      node.id,
      className,
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("title")
    ]
      .filter(Boolean)
      .join(" ");
  }

  function isVolumeControlIntent(event) {
    if (event.type === "keydown") {
      return String(event.key || "").toLowerCase() === "m";
    }

    const path =
      typeof event.composedPath === "function"
        ? event.composedPath()
        : [event.target];
    return path.some((node) =>
      /volume|mute|볼륨|음량|음소거/i.test(volumeControlText(node))
    );
  }

  function noteUserVolumeIntent(event) {
    if (isVolumeControlIntent(event)) {
      lastUserVolumeIntentAt = Date.now();
    }
  }

  function hasRecentUserVolumeIntent() {
    return Date.now() - lastUserVolumeIntentAt <= USER_VOLUME_INTENT_WINDOW_MS;
  }

  function rememberStablePrimaryUnmuted(video) {
    if (
      preferredPrimaryMuted !== undefined ||
      pendingPrimarySnapshots.has(video) ||
      isAuxiliaryVideo(video)
    ) {
      return;
    }

    pendingPrimarySnapshots.add(video);
    setTimeout(() => {
      pendingPrimarySnapshots.delete(video);
      if (
        preferredPrimaryMuted === undefined &&
        pendingPrimaryMuted === undefined &&
        !isAuxiliaryVideo(video) &&
        !hasActiveAuxiliaryPlayback() &&
        !video.paused &&
        video.muted === false
      ) {
        preferredPrimaryMuted = false;
      }
    }, PRIMARY_UNMUTED_SNAPSHOT_DELAY_MS);
  }

  function rememberPrimaryMute(video) {
    if (
      isAuxiliaryVideo(video) ||
      pendingPrimaryMuted !== undefined ||
      hasActiveAuxiliaryPlayback() ||
      !hasRecentUserVolumeIntent()
    ) {
      return;
    }

    preferredPrimaryMuted = video.muted;
  }

  function restorePrimaryMute(video) {
    if (
      pendingPrimaryMuted === undefined ||
      isAuxiliaryVideo(video)
    ) {
      return;
    }

    const muted = pendingPrimaryMuted;
    pendingPrimaryMuted = undefined;
    preferredPrimaryMuted = muted;
    if (video.muted !== muted) {
      video.muted = muted;
    }
  }

  function restoreCurrentPrimaryMute() {
    for (const video of document.querySelectorAll("video")) {
      if (!isAuxiliaryVideo(video) && (video.currentSrc || video.src)) {
        restorePrimaryMute(video);
        if (pendingPrimaryMuted === undefined) {
          return;
        }
      }
    }
  }

  function advanceAuxiliaryPlayback(video) {
    if (
      advancedAuxiliaryVideos.has(video) ||
      pendingAuxiliaryVideos.has(video)
    ) {
      return true;
    }

    if (
      video.paused ||
      video.readyState < 2 ||
      !Array.isArray(playbackAdvanceListeners)
    ) {
      return false;
    }

    const listeners = playbackAdvanceListeners.filter(
      (listener) => typeof listener === "function"
    );
    if (listeners.length === 0) {
      return false;
    }

    if (preferredPrimaryMuted !== undefined) {
      pendingPrimaryMuted = preferredPrimaryMuted;
    }
    pendingAuxiliaryVideos.add(video);
    setTimeout(() => {
      pendingAuxiliaryVideos.delete(video);
      if (advancedAuxiliaryVideos.has(video)) {
        return;
      }

      advancedAuxiliaryVideos.add(video);
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          log("failed to advance auxiliary playback", error);
        }
      }

      setTimeout(restoreCurrentPrimaryMute, PRIMARY_MUTE_RESTORE_DELAY_MS);
      log("advanced auxiliary playback");
    }, PLAYBACK_ADVANCE_DELAY_MS);
    return true;
  }

  function finishAuxiliaryVideo(video) {
    if (!ownsPlaybackTransport || !isAuxiliaryVideo(video)) {
      return;
    }

    try {
      if (advanceAuxiliaryPlayback(video)) {
        return;
      }

      video.muted = true;
      video.playbackRate = 16;

      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 300) {
        video.currentTime = Math.max(0, video.duration - 0.05);
      }

      log("finished auxiliary playback", video.currentSrc || video.src);
    } catch (error) {
      log("failed to finish auxiliary playback", error);
    }
  }

  function finishAuxiliaryVideos() {
    for (const video of document.querySelectorAll("video")) {
      finishAuxiliaryVideo(video);
    }
  }

  function settlePlaybackInterruptions() {
    if (!document.documentElement) {
      return;
    }

    markAuxiliaryContainers();

    const skipButtons = document.querySelectorAll("button, [role='button']");
    for (const button of skipButtons) {
      if (isInterruptionSkipButton(button)) {
        if (clickElement(button)) {
          log("advanced playback interruption");
          break;
        }
      }
    }

    finishAuxiliaryVideos();

  }

  function startDomWatchers() {
    applyVisualGuard();

    const observer = new MutationObserver(settlePlaybackInterruptions);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    if (ownsPlaybackTransport) {
      for (const eventName of ["loadedmetadata", "durationchange", "play", "playing"]) {
        document.addEventListener(
          eventName,
          (event) => {
            if (event.target instanceof HTMLVideoElement) {
              finishAuxiliaryVideo(event.target);
              if (eventName === "playing" && !isAuxiliaryVideo(event.target)) {
                rememberStablePrimaryUnmuted(event.target);
                setTimeout(() => restorePrimaryMute(event.target), 0);
              }
            }
          },
          true
        );
      }

      document.addEventListener("pointerdown", noteUserVolumeIntent, true);
      document.addEventListener("keydown", noteUserVolumeIntent, true);
      document.addEventListener(
        "volumechange",
        (event) => {
          if (event.target instanceof HTMLVideoElement) {
            rememberPrimaryMute(event.target);
          }
        },
        true
      );
    }

    setInterval(settlePlaybackInterruptions, 2000);
    settlePlaybackInterruptions();
  }

  if (document.documentElement) {
    startDomWatchers();
  } else {
    document.addEventListener("readystatechange", startDomWatchers, { once: true });
  }

  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: "ready",
      settingsDefaults: DEFAULT_SETTINGS
    },
    "*"
  );

  log("injected");
})();
