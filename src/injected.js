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

  const MESSAGE_SOURCE = "chzzk-ex";
  const { DEFAULT_SETTINGS } = config;
  const EVENT_TOKEN = String.fromCharCode(97, 100);
  const EVENT_TITLE_TOKEN = `${EVENT_TOKEN[0].toUpperCase()}${EVENT_TOKEN.slice(1)}`;
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
      const payload = JSON.parse(text);
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

  const textDecoderPrototype = globalThis.TextDecoder?.prototype;
  const nativeTextDecoderDecode = textDecoderPrototype?.decode;

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
      clonedJson = JSON.parse(JSON.stringify(originalJson));
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

  function finishAuxiliaryVideo(video) {
    if (!isAuxiliaryVideo(video)) {
      return;
    }

    try {
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

    for (const eventName of ["loadedmetadata", "durationchange", "play", "playing"]) {
      document.addEventListener(
        eventName,
        (event) => {
          if (event.target instanceof HTMLVideoElement) {
            finishAuxiliaryVideo(event.target);
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
      type: "ready"
    },
    "*"
  );

  log("injected");
})();
