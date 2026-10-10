const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const background = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "../src/live-resume.js"), "utf8");
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const liveUrl = (channel = "streamer") => `https://chzzk.naver.com/live/${channel}`;

function event() {
  const listeners = [];
  return { listeners, addListener(fn) { listeners.push(fn); }, emit(...args) { return listeners.map((fn) => fn(...args)); } };
}

function storage(data = {}) {
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
      return { ...keys, ...Object.fromEntries(Object.keys(keys).filter((key) => key in data).map((key) => [key, data[key]])) };
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; }
  };
}

function backgroundRuntime({ session = {}, tabs, status = "CLOSE", ended = false } = {}) {
  const calls = { reload: [], update: [], messages: [], fetch: [] };
  const tabMap = new Map((tabs || [{ id: 1, url: liveUrl(), status: "complete", active: false, mutedInfo: { muted: false } }]).map((tab) => [tab.id, tab]));
  let response = { code: 200, content: { status, liveId: 100 } };
  let fetchOverride;
  const api = {
    storage: { local: storage(), session: storage(session), onChanged: event() },
    runtime: { id: "extension-id", onMessage: event(), onStartup: event(), onInstalled: event() },
    alarms: { onAlarm: event(), async get() { return null; }, async create(name, opts) { calls.alarm = { name, ...opts }; } },
    tabs: {
      onUpdated: event(), onRemoved: event(),
      async query() { return [...tabMap.values()].filter((tab) => tab.url.startsWith(liveUrl(""))).map((tab) => ({ ...tab })); },
      async get(id) { if (!tabMap.has(id)) throw Error("closed"); return { ...tabMap.get(id) }; },
      async update(id, changes) {
        calls.update.push([id, changes]);
        tabMap.get(id).mutedInfo = { muted: changes.muted, extensionId: api.runtime.id };
      },
      async reload(id) { calls.reload.push(id); },
      async sendMessage(id, message) {
        calls.messages.push([id, message]);
        if (message.type === "live-page-state") return { channelId: "streamer", ended };
      }
    }
  };
  vm.runInNewContext(background, {
    chrome: api, URL, AbortController, setTimeout, clearTimeout, console,
    fetch: async (url, options) => {
      calls.fetch.push([url, options]);
      if (fetchOverride) return fetchOverride(url);
      return { ok: true, async json() { return structuredClone(response); } };
    }
  });
  return {
    api, calls, tabMap,
    setStatus(status, liveId = 100) { response = { code: 200, content: { status, liveId } }; },
    setFetch(fn) { fetchOverride = fn; },
    async tick() { api.alarms.onAlarm.emit({ name: "chzzk-ex-live-check" }); await flush(); },
    async message(type, token, tabId = 1) {
      return new Promise((resolve) => api.runtime.onMessage.emit({ type, token }, { frameId: 0, url: tabMap.get(tabId).url, tab: tabMap.get(tabId) }, resolve));
    }
  };
}

test("checks an unfocused closed tab and reloads once, muted, when it opens", async () => {
  const r = backgroundRuntime();
  await flush();
  assert.equal(r.calls.alarm.periodInMinutes, 1);
  assert.deepEqual(r.calls.reload, []);
  r.setStatus("OPEN", 101);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
  assert.equal(r.calls.update[0][1].muted, true);
  const state = await r.message("resume-state");
  assert.equal(state.channelId, "streamer");
  assert.ok(state.token);
  await r.message("resume-started", "wrong-token");
  assert.equal(r.calls.update.length, 1);
  await r.message("resume-started", state.token);
  assert.equal(r.calls.update[1][1].muted, false);
  await r.tick();
  r.setStatus("CLOSE", 101);
  await r.tick();
  r.setStatus("OPEN", 101);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
  r.setStatus("OPEN", 102);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1, 1]);
});

test("does not reload or mute an already open broadcast on initial observation", async () => {
  const r = backgroundRuntime({ status: "OPEN" });
  await flush();
  await r.tick();
  assert.equal(r.calls.reload.length, 0);
  assert.equal(r.calls.update.length, 0);
  assert.ok(r.calls.messages.some(([, message]) => message.type === "automation-tick"));
});

test("recovers an ended page even when the first API observation is already OPEN", async () => {
  const r = backgroundRuntime({ status: "OPEN", ended: true });
  await flush();
  assert.deepEqual(r.calls.reload, [1]);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
});

test("recovers an ended page whose saved live ID already matches the server", async () => {
  const r = backgroundRuntime({ status: "OPEN", ended: true, session: {
    "live-watch:1": { channelId: "streamer", status: "OPEN", liveId: "100" }
  } });
  await flush();
  assert.deepEqual(r.calls.reload, [1]);
});

test("limits ended-page recovery to two attempts per broadcast with a cooldown", async () => {
  const r = backgroundRuntime({ status: "OPEN", ended: true });
  await flush();
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
  r.api.storage.session.data["live-watch:1"].lastResumeAt = Date.now() - 120001;
  await r.tick();
  assert.deepEqual(r.calls.reload, [1, 1]);
  r.api.storage.session.data["live-watch:1"].lastResumeAt = Date.now() - 120001;
  await r.tick();
  assert.deepEqual(r.calls.reload, [1, 1]);
});

test("retains waiting state across background shutdown and groups identical channel requests", async () => {
  const first = backgroundRuntime();
  await flush();
  const second = backgroundRuntime({ session: first.api.storage.session.data, status: "OPEN" });
  await flush();
  assert.deepEqual(second.calls.reload, [1]);
  const third = backgroundRuntime({ session: second.api.storage.session.data, status: "OPEN" });
  await flush();
  assert.equal(third.calls.reload.length, 0);
  const grouped = backgroundRuntime({ tabs: [1, 2].map((id) => ({ id, url: liveUrl(), status: "complete" })) });
  await flush();
  assert.equal(grouped.calls.fetch.length, 1);
});

test("ignores network failures, unknown states and missing live identifiers", async () => {
  const r = backgroundRuntime();
  await flush();
  r.setFetch(async () => { throw Error("offline"); });
  await r.tick();
  r.setFetch(null);
  r.setStatus("UNKNOWN");
  await r.tick();
  r.setStatus("OPEN", null);
  await r.tick();
  assert.equal(r.calls.reload.length, 0);
  r.setStatus("OPEN", 200);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
});

test("does not reload a tab navigated away during the status request", async () => {
  const r = backgroundRuntime();
  await flush();
  r.setFetch(async () => {
    r.tabMap.get(1).pendingUrl = liveUrl("someone-else");
    return { ok: true, json: async () => ({ code: 200, content: { status: "OPEN", liveId: 200 } }) };
  });
  await r.tick();
  assert.equal(r.calls.reload.length, 0);
  assert.equal(r.calls.update.length, 0);
});

test("confirms an empty offline response using the channel information", async () => {
  const r = backgroundRuntime();
  await flush();
  await r.api.storage.session.remove("live-watch:1");
  r.setFetch(async (url) => ({ ok: true, json: async () => ({
    code: 200, content: url.includes("live-detail") ? null : { channelId: "streamer", openLive: false }
  }) }));
  await r.tick();
  assert.equal(r.api.storage.session.data["live-watch:1"].status, "CLOSE");
  r.setFetch(null);
  r.setStatus("OPEN", 201);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
});

test("cleans waiting state when disabled and does not undo preexisting tab mute", async () => {
  const r = backgroundRuntime({ tabs: [{ id: 1, url: liveUrl(), status: "complete", mutedInfo: { muted: true } }] });
  await flush();
  r.setStatus("OPEN");
  await r.tick();
  const state = await r.message("resume-state");
  await r.message("resume-started", state.token);
  assert.equal(r.calls.update.length, 1);
  r.api.storage.local.data.autoResumeLive = false;
  await r.tick();
  assert.equal(Object.keys(r.api.storage.session.data).length, 0);
  r.setStatus("OPEN", 201);
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
});

test("defers reload during navigation loading and retries after reload failure", async () => {
  const r = backgroundRuntime();
  await flush();
  r.tabMap.get(1).status = "loading";
  r.setStatus("OPEN");
  await r.tick();
  assert.equal(r.calls.reload.length, 0);
  r.tabMap.get(1).status = "complete";
  const reload = r.api.tabs.reload;
  r.api.tabs.reload = async () => { throw Error("temporarily unavailable"); };
  await r.tick();
  assert.equal(r.tabMap.get(1).mutedInfo.muted, false);
  r.api.tabs.reload = reload;
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
});

test("turning off auto resume during a request prevents a late reload", async () => {
  const r = backgroundRuntime();
  await flush();
  r.setFetch(async () => {
    r.api.storage.local.data.autoResumeLive = false;
    return { ok: true, json: async () => ({ code: 200, content: { status: "OPEN", liveId: 200 } }) };
  });
  await r.tick();
  assert.equal(r.calls.reload.length, 0);
  assert.equal(Object.keys(r.api.storage.session.data).length, 0);
});

test("an expired resume cannot cause a reload loop and route changes clear temporary mute", async () => {
  const r = backgroundRuntime();
  await flush();
  r.setStatus("OPEN");
  await r.tick();
  r.api.storage.session.data["live-watch:1"].pending.since = 0;
  await r.tick();
  assert.deepEqual(r.calls.reload, [1]);
  assert.equal(r.tabMap.get(1).mutedInfo.muted, false);
  r.setStatus("OPEN", 200);
  await r.tick();
  r.tabMap.get(1).url = "https://chzzk.naver.com/";
  r.api.tabs.onUpdated.emit(1, { url: "https://chzzk.naver.com/" });
  await flush();
  assert.equal(r.tabMap.get(1).mutedInfo.muted, false);
  assert.equal(Object.keys(r.api.storage.session.data).length, 0);
});

test("a rapid new broadcast does not inherit the previous temporary tab mute", async () => {
  const r = backgroundRuntime();
  await flush();
  r.setStatus("OPEN", 200);
  await r.tick();
  r.setStatus("OPEN", 201);
  await r.tick();
  const state = await r.message("resume-state");
  await r.message("resume-started", state.token);
  assert.equal(r.tabMap.get(1).mutedInfo.muted, false);
});

function contentRuntime({ resume = { channelId: "streamer", token: "101:0" }, players = [] } = {}) {
  const messages = [], intervals = new Map(), listeners = new Map();
  const observers = [];
  const video = {
    currentTime: 0, readyState: 4, paused: true, ended: false, muted: false,
    closest() { return null; },
    play() { this.paused = false; return Promise.resolve(); }
  };
  const api = {
    runtime: { onMessage: event(), async sendMessage(message) { messages.push(message); return message.type === "resume-state" ? resume : { ok: true }; } },
    storage: { onChanged: event() }
  };
  const location = { pathname: "/live/streamer" };
  let videos = [video];
  vm.runInNewContext(content, {
    chrome: api, location, Date, console,
    setInterval(fn) { const id = Symbol(); intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.stopped = true; } },
    getComputedStyle: (node) => ({ visibility: node.visibility || "visible" }),
    document: { visibilityState: "visible", querySelectorAll(selector) { return selector === "video" ? videos : players; }, addEventListener(name, fn) { listeners.set(name, fn); } },
    window: { addEventListener(name, fn) { listeners.set(name, fn); }, postMessage() {} }
  });
  return { api, location, video, messages, intervals, observers, listeners, setVideos(next) { videos = next; } };
}

test("reports only visible player end notices, not pauses or hidden notices", async () => {
  const notice = (textContent, visible = true) => ({ textContent, getClientRects: () => visible ? [{}] : [], closest: () => null });
  for (const [messages, ended] of [
    [[notice("라이브 종료"), notice("다음 방송에서 만나요!")], true],
    [[notice("다음 라이브를 기대해 주세요!")], true],
    [[notice("다음 라이브를 기대해 주세요!", false)], false],
    [[notice("일시정지")], false],
    [[notice("방송 정보를 불러오는 중")], false],
    [[notice("광고 차단 중이신가요?")], false]
  ]) {
    const r = contentRuntime({ resume: null, players: [{ querySelectorAll: () => messages }] });
    await flush();
    let response;
    r.api.runtime.onMessage.emit({ type: "live-page-state" }, {}, (value) => { response = value; });
    assert.equal(response.channelId, "streamer");
    assert.equal(response.ended, ended);
  }
});

test("requests a throttled fresh check when returning to a live tab", async () => {
  const r = contentRuntime({ resume: null });
  await flush();
  r.listeners.get("focus")();
  r.listeners.get("visibilitychange")();
  assert.equal(r.messages.filter((message) => message.type === "check-live").length, 1);
});

test("starts muted in the background and only acknowledges actual playback progress", async () => {
  const r = contentRuntime();
  await flush();
  assert.equal(r.video.muted, true);
  assert.equal(r.video.paused, false);
  assert.equal(r.messages.length, 1);
  r.video.currentTime = 1;
  r.listeners.get("timeupdate")();
  assert.equal(r.messages[1].type, "resume-started");
  assert.equal(r.intervals.size, 0);
  r.video.muted = false;
  r.listeners.get("playing")();
  r.api.runtime.onMessage.emit({ type: "resume-live", channelId: "streamer", token: "101:0" });
  assert.equal(r.video.muted, false);
});

test("leaves normal visits untouched and cancels on user interaction or a different channel", async () => {
  const normal = contentRuntime({ resume: null });
  await flush();
  assert.equal(normal.video.paused, true);
  assert.equal(normal.video.muted, false);
  const interacted = contentRuntime();
  await flush();
  interacted.listeners.get("pointerdown")({ isTrusted: true });
  assert.equal(interacted.messages.at(-1).type, "resume-cancel");
  const navigated = contentRuntime();
  await flush();
  navigated.location.pathname = "/live/someone-else";
  navigated.video.muted = false;
  navigated.listeners.get("timeupdate")();
  assert.equal(navigated.video.muted, false);
  assert.equal(navigated.intervals.size, 0);
});

test("waits for a late video element and tolerates blocked autoplay", async () => {
  const r = contentRuntime();
  r.setVideos([]);
  await flush();
  assert.equal(r.video.muted, false);
  r.video.play = () => Promise.reject(Error("autoplay blocked"));
  r.setVideos([r.video]);
  r.observers[0].fn();
  await flush();
  assert.equal(r.video.muted, true);
  assert.equal(r.messages.length, 1);
  r.api.storage.onChanged.emit({ autoResumeLive: { newValue: false } }, "local");
  assert.equal(r.messages.at(-1).type, "resume-cancel");
  assert.equal(r.intervals.size, 0);
});
