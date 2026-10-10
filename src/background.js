(() => {
  const api = globalThis.browser || chrome;
  const ALARM = "chzzk-ex-live-check";
  const PREFIX = "live-watch:";
  const RESUME_TIMEOUT = 5 * 60 * 1000;
  const RETRY_DELAY = 2 * 60 * 1000;
  let queue = Promise.resolve();
  let checking = false;
  let lastFocusCheck = 0;

  function channelFromUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === "https://chzzk.naver.com"
        ? url.pathname.match(/^\/live\/([a-z0-9_-]+)\/?$/i)?.[1] || ""
        : "";
    } catch {
      return "";
    }
  }

  function enqueue(action) {
    const task = queue.then(action);
    queue = task.catch((error) => console.warn("[CHZZK EX]", error));
    return task;
  }

  async function readState(tabId) {
    return (await api.storage.session.get(`${PREFIX}${tabId}`))[`${PREFIX}${tabId}`];
  }

  async function writeState(tabId, state) {
    await api.storage.session.set({ [`${PREFIX}${tabId}`]: state });
  }

  async function currentTab(tabId, channelId) {
    try {
      const tab = await api.tabs.get(tabId);
      return channelFromUrl(tab.url) === channelId &&
        (!tab.pendingUrl || channelFromUrl(tab.pendingUrl) === channelId)
        ? tab
        : null;
    } catch {
      return null;
    }
  }

  async function releaseMute(tabId, pending) {
    if (!pending || pending.wasMuted) return;
    try {
      const tab = await api.tabs.get(tabId);
      if (tab.mutedInfo?.muted && tab.mutedInfo.extensionId === api.runtime.id) {
        await api.tabs.update(tabId, { muted: false });
      }
    } catch {
      // 이미 닫힌 탭은 정리할 필요가 없다.
    }
  }

  async function clearState(tabId) {
    const state = await readState(tabId);
    await releaseMute(tabId, state?.pending);
    await api.storage.session.remove(`${PREFIX}${tabId}`);
  }

  async function liveStatus(channelId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(
        `https://api.chzzk.naver.com/service/v3.3/channels/${channelId}/live-detail?dt=PC&tm=false`,
        { credentials: "include", cache: "no-store", signal: controller.signal }
      );
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload.code === 200 && payload.content === null) {
        const channelResponse = await fetch(
          `https://api.chzzk.naver.com/service/v1/channels/${channelId}`,
          { credentials: "include", cache: "no-store", signal: controller.signal }
        );
        if (!channelResponse.ok) return null;
        const channel = await channelResponse.json();
        return channel.code === 200 && channel.content?.channelId === channelId &&
          channel.content.openLive === false ? { status: "CLOSE", liveId: "" } : null;
      }
      const detail = payload?.content;
      if (payload.code !== 200 || !["OPEN", "CLOSE"].includes(detail?.status)) return null;
      if (detail.channel?.channelId && detail.channel.channelId !== channelId) return null;
      const liveId = detail.liveId == null ? "" : String(detail.liveId);
      if (detail.status === "OPEN" && !liveId) return null;
      return { status: detail.status, liveId };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkTab(tab, channelId, status) {
    let state = await readState(tab.id);
    if (state && state.channelId !== channelId) {
      await clearState(tab.id);
      state = null;
    }
    if (!await currentTab(tab.id, channelId)) return;
    if (!(await api.storage.local.get({ autoResumeLive: true })).autoResumeLive) {
      await clearState(tab.id);
      return;
    }
    if (state?.pending) {
      if (Date.now() - state.pending.since > RESUME_TIMEOUT || status?.status === "CLOSE") {
        await releaseMute(tab.id, state.pending);
        delete state.pending;
        await writeState(tab.id, state);
      } else {
        await api.tabs.sendMessage(tab.id, {
          type: "resume-live",
          channelId,
          token: state.pending.token
        }).catch(() => {});
      }
    }
    if (!status) return;
    let ended = false;
    if (status.status === "OPEN") {
      let timer;
      try {
        const page = await Promise.race([
          api.tabs.sendMessage(tab.id, { type: "live-page-state" }),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); })
        ]);
        ended = page?.channelId === channelId && page.ended === true;
      } catch {
        // 페이지에 연결할 수 없다는 이유만으로 재생을 중단하지 않는다.
      } finally {
        clearTimeout(timer);
      }
    }
    const changed = state && status.status === "OPEN" &&
      (state.status === "CLOSE" || state.liveId !== status.liveId) &&
      state.resumedLiveId !== status.liveId;
    const attempts = state?.resumedLiveId === status.liveId ? state.resumeAttempts || 1 : 0;
    const recoverEnded = ended && attempts < 2 &&
      (!attempts || Date.now() - (state.lastResumeAt || state.pending?.since || 0) >= RETRY_DELAY);
    const next = { ...state, channelId, ...status };
    if (changed || recoverEnded) {
      if (state?.pending) {
        await releaseMute(tab.id, state.pending);
        delete next.pending;
      }
      const freshTab = await currentTab(tab.id, channelId);
      if (!freshTab || freshTab.status === "loading") return;
      if (!(await api.storage.local.get({ autoResumeLive: true })).autoResumeLive) return;
      // 종료 화면이 남은 경우에만 제한적으로 재시도하며 먼저 횟수를 기록한다.
      next.resumedLiveId = status.liveId;
      next.resumeAttempts = attempts + 1;
      next.lastResumeAt = Date.now();
      next.pending = {
        token: `${status.liveId}:${Date.now()}`,
        since: Date.now(),
        wasMuted: Boolean(freshTab.mutedInfo?.muted)
      };
      await writeState(tab.id, next);
      try {
        await api.tabs.update(tab.id, { muted: true });
        if (!await currentTab(tab.id, channelId)) {
          await clearState(tab.id);
          return;
        }
        await api.tabs.reload(tab.id);
      } catch {
        await releaseMute(tab.id, next.pending);
        delete next.pending;
        // 실패한 요청은 다음 확인 때 다시 시도할 수 있게 되돌린다.
        const previous = { ...state };
        delete previous.pending;
        await writeState(tab.id, previous);
      }
      return;
    }
    await writeState(tab.id, next);
  }

  async function checkTabs() {
    const settings = await api.storage.local.get({ autoResumeLive: true, autoClaimPower: true });
    const tabs = await api.tabs.query({ url: "https://chzzk.naver.com/live/*" });
    const liveTabs = tabs.filter((tab) => channelFromUrl(tab.url));
    const saved = await api.storage.session.get(null);
    for (const key of Object.keys(saved).filter((key) => key.startsWith(PREFIX))) {
      const tabId = Number(key.slice(PREFIX.length));
      if (!settings.autoResumeLive || !liveTabs.some((tab) => tab.id === tabId)) {
        await clearState(tabId);
      }
    }
    if (settings.autoClaimPower) {
      await Promise.all(liveTabs.map((tab) =>
        api.tabs.sendMessage(tab.id, { type: "automation-tick" }).catch(() => {})
      ));
    }
    if (!settings.autoResumeLive) return;
    const channels = [...new Set(liveTabs.map((tab) => channelFromUrl(tab.url)))];
    const statuses = new Map(await Promise.all(channels.map(async (id) => [id, await liveStatus(id)])));
    for (const tab of liveTabs) {
      const channelId = channelFromUrl(tab.url);
      await checkTab(tab, channelId, statuses.get(channelId));
    }
  }

  function requestCheck() {
    if (checking) return;
    checking = true;
    enqueue(checkTabs).catch(() => {}).finally(() => { checking = false; });
  }

  async function handleMessage(message, sender) {
    if (sender.frameId !== 0 || !sender.tab) return null;
    const channelId = channelFromUrl(sender.url);
    if (!channelId || !await currentTab(sender.tab.id, channelId)) return null;
    const state = await readState(sender.tab.id);
    if (state?.channelId !== channelId || !state.pending) return null;
    if (!(await api.storage.local.get({ autoResumeLive: true })).autoResumeLive ||
      Date.now() - state.pending.since > RESUME_TIMEOUT) return null;
    if (message.type === "resume-state") {
      return { channelId, token: state.pending.token };
    }
    if (message.token !== state.pending.token) return null;
    await releaseMute(sender.tab.id, state.pending);
    delete state.pending;
    await writeState(sender.tab.id, state);
    return { ok: true };
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "check-live" && sender.frameId === 0 &&
      sender.tab && channelFromUrl(sender.url)) {
      if (Date.now() - lastFocusCheck >= 30000) {
        lastFocusCheck = Date.now();
        requestCheck();
      }
      sendResponse({ ok: true });
      return false;
    }
    if (!["resume-state", "resume-started", "resume-cancel"].includes(message?.type)) return false;
    enqueue(() => handleMessage(message, sender)).then(sendResponse, () => sendResponse(null));
    return true;
  });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) requestCheck();
  });
  api.tabs.onRemoved.addListener((tabId) => { enqueue(() => clearState(tabId)); });
  api.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url) return;
    enqueue(async () => {
      const state = await readState(tabId);
      if (state && state.channelId !== channelFromUrl(change.url)) await clearState(tabId);
    });
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.autoResumeLive) requestCheck();
  });
  async function start() {
    if (!await api.alarms.get(ALARM)) {
      await api.alarms.create(ALARM, { periodInMinutes: 1 });
    }
    requestCheck();
  }
  api.runtime.onStartup.addListener(() => { start().catch(console.warn); });
  api.runtime.onInstalled.addListener(() => { start().catch(console.warn); });
  start().catch(console.warn);
})();
