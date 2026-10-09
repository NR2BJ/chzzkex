(() => {
  const api = globalThis.browser || chrome;
  let pending = null;
  let timer = null;
  let observer = null;
  let video = null;
  let startingTime = 0;
  let playPending = false;
  let completedToken = "";
  const AUXILIARY = "[data-role='adVideoContainerEl'], [data-role='imaAdContainerEl'], [data-role='gvAdContainerEl'], #midAdVideoContainer, #midAdPlayerWrapper";

  function channelId() {
    return location.pathname.match(/^\/live\/([a-z0-9_-]+)\/?$/i)?.[1] || "";
  }

  function stop() {
    clearInterval(timer);
    observer?.disconnect();
    timer = null;
    observer = null;
    pending = null;
    video = null;
  }

  function finish(type) {
    if (!pending) return;
    const token = pending.token;
    completedToken = token;
    stop();
    api.runtime.sendMessage({ type, token }).catch(() => {});
  }

  function tick() {
    if (!pending) return;
    if (pending.channelId !== channelId() || Date.now() - pending.since > 60000) {
      finish("resume-cancel");
      return;
    }
    const current = Array.from(document.querySelectorAll("video"))
      .find((element) => !element.closest(AUXILIARY));
    if (!current) return;
    if (video !== current) {
      video = current;
      startingTime = video.currentTime;
    }
    video.muted = true;
    if (!video.paused && !video.ended && video.currentTime > startingTime + 0.1) {
      finish("resume-started");
      return;
    }
    if (video.readyState >= 2 && video.paused && !playPending) {
      playPending = true;
      Promise.resolve(video.play()).catch(() => {}).finally(() => { playPending = false; });
    }
  }

  function begin(state) {
    if (!state || state.channelId !== channelId() || !state.token) return;
    if (state.token === completedToken) return;
    if (pending?.token === state.token) {
      tick();
      return;
    }
    stop();
    pending = { ...state, since: Date.now() };
    observer = new MutationObserver(tick);
    observer.observe(document, { childList: true, subtree: true });
    timer = setInterval(tick, 1000);
    tick();
  }

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "resume-live") begin(message);
    if (message?.type === "automation-tick") {
      window.postMessage({ source: "chzzk-ex", type: "automation-tick" }, "*");
      tick();
    }
  });
  for (const event of ["loadeddata", "canplay", "playing", "timeupdate"]) {
    document.addEventListener(event, tick, true);
  }
  for (const event of ["pointerdown", "keydown"]) {
    document.addEventListener(event, (event) => {
      if (event.isTrusted) finish("resume-cancel");
    }, true);
  }
  window.addEventListener("pagehide", stop);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.autoResumeLive?.newValue === false) finish("resume-cancel");
  });
  api.runtime.sendMessage({ type: "resume-state" }).then(begin).catch(() => {});
})();
