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
  const EVENT_NOTICE_TITLE_SELECTOR = [
    `[class^='${EVENT_TOKEN}_block_title']`,
    `[class*='${EVENT_TOKEN}_block_title']`
  ].join(", ");
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
      return JSON.stringify(core.rewritePayload(requestKind, payload));
    } catch (error) {
      log("json rewrite skipped", requestKind, error);
      return text;
    }
  }

  async function rewriteResponse(response, requestKind) {
    const text = await response.clone().text();
    if (!text) {
      return response;
    }

    return new Response(rewriteJsonText(text, requestKind), {
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
  const nativeSend = xhrPrototype.send;
  const nativeResponseTextGetter = Object.getOwnPropertyDescriptor(
    xhrPrototype,
    "responseText"
  )?.get;
  const nativeResponseGetter = Object.getOwnPropertyDescriptor(
    xhrPrototype,
    "response"
  )?.get;
  const xhrRewriteCache = new WeakMap();

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

    const rewritten = rewriteJsonText(originalText, requestKind);
    xhrRewriteCache.set(xhr, { key, original: originalText, rewritten });
    log("rewrote XHR response", requestKind);
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

    const rewritten = core.rewritePayload(requestKind, clonedJson);
    xhrRewriteCache.set(xhr, { key, original: originalJson, rewritten });
    log("rewrote XHR JSON response", requestKind);
    return rewritten;
  }

  function installXhrFacade(xhr) {
    if (xhr.__chzzkExFacadeInstalled) {
      return;
    }

    xhr.__chzzkExFacadeInstalled = true;

    if (nativeResponseTextGetter) {
      Object.defineProperty(xhr, "responseText", {
        configurable: true,
        get() {
          const originalText = nativeResponseTextGetter.call(this);
          const requestKind = this.__chzzkExRequestKind;
          return rewrittenXhrText(this, requestKind, originalText);
        }
      });
    }

    if (nativeResponseGetter) {
      Object.defineProperty(xhr, "response", {
        configurable: true,
        get() {
          const originalResponse = nativeResponseGetter.call(this);
          const requestKind = this.__chzzkExRequestKind;

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

  xhrPrototype.open = function patchedOpen(method, url) {
    const result = nativeOpen.apply(this, arguments);
    this.__chzzkExRequestKind = core.classifyRequest(requestUrl(url));
    xhrRewriteCache.delete(this);
    installXhrFacade(this);
    return result;
  };

  xhrPrototype.send = function patchedSend(body) {
    return nativeSend.apply(this, arguments);
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

    const playbackNoticeTitle = document.querySelector(EVENT_NOTICE_TITLE_SELECTOR);
    if (playbackNoticeTitle) {
      const closeButton = document.querySelector(
        "[class^='popup_cell'] button, [class*='popup_cell'] button"
      );
      if (clickElement(closeButton)) {
        log("closed playback notice");
      }
    }
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
