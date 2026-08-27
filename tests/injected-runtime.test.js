const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const EVENT_FIELDS = Object.freeze({
  bootstrap: [
    "skip",
    "Pre",
    "Roll",
    String.fromCharCode(65, 100)
  ].join(""),
  state: String.fromCharCode(100, 97, 98)
});
const CONNECTION_TOKEN = String.fromCharCode(112, 50, 112);
const scripts = ["src/settings.js", "src/rewrite-core.js", "src/injected.js"].map(
  (file) => fs.readFileSync(path.join(root, file), "utf8")
);
const XHR_PROBE_PROPERTIES = [
  "status",
  "statusText",
  "readyState",
  "response",
  "responseURL",
  "responseXML"
];

function hasUnexpectedXhrSurface(xhr, XhrClass) {
  const prototype = XhrClass.prototype;
  const hasOwn = (property) =>
    Object.prototype.hasOwnProperty.call(xhr, property);

  return (
    hasOwn("setRequestHeader") ||
    xhr.setRequestHeader !== prototype.setRequestHeader ||
    XHR_PROBE_PROPERTIES.some(hasOwn)
  );
}

function createRuntime(options = {}) {
  const listeners = new Map();
  const documentListeners = new Map();
  const fetchCalls = [];
  const intervalCallbacks = [];
  const timeoutCallbacks = [];
  const videos = [];
  const classNames = new Set();
  const auxiliaryClassNames = new Set();
  let noticeCloseClicks = 0;
  const auxiliaryElement = {
    classList: {
      add(name) {
        auxiliaryClassNames.add(name);
      }
    }
  };

  class FakeMutationObserver {
    observe() {}
  }

  class FakeTextDecoder extends TextDecoder {}

  class FakeXhr {
    static DONE = 4;
    static OPENED = 1;

    constructor() {
      this._readyState = 0;
      this._responseType = "";
      this.sentBodies = [];
      this._responseText = "";
      this._response = "";
    }

    open() {
      this._readyState = FakeXhr.OPENED;
    }

    send(body) {
      this.sentBodies.push(body);
    }

    abort() {
      this._readyState = 0;
    }

    setRequestHeader() {}

    get readyState() {
      return this._readyState;
    }

    get responseType() {
      return this._responseType;
    }

    set responseType(value) {
      this._responseType = value;
    }

    get responseText() {
      return this._responseText;
    }

    get response() {
      return this._response;
    }
  }

  class FakeVideoElement {
    constructor({ auxiliary = true, paused = false, readyState = 4 } = {}) {
      this.auxiliary = auxiliary;
      this.currentSrc = auxiliary
        ? "https://api.chzzk.naver.com/service/t/media"
        : "blob:https://chzzk.naver.com/live";
      this.currentTime = 0;
      this.duration = 30;
      this.muted = false;
      this.paused = paused;
      this.playbackRate = 1;
      this.readyState = readyState;
      this.src = this.currentSrc;
    }

    closest() {
      return this.auxiliary ? auxiliaryElement : null;
    }
  }

  const document = {
    documentElement: {
      classList: {
        toggle(name, enabled) {
          if (enabled) {
            classNames.add(name);
          } else {
            classNames.delete(name);
          }
        }
      }
    },
    addEventListener(type, listener) {
      const current = documentListeners.get(type) || [];
      current.push(listener);
      documentListeners.set(type, current);
    },
    querySelector(selector) {
      if (selector.includes("_block_title")) {
        return {};
      }
      if (selector.includes("popup_cell")) {
        return {
          disabled: false,
          click() {
            noticeCloseClicks += 1;
          }
        };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "video") {
        return videos;
      }
      if (selector.includes("VideoContainerEl")) {
        return [auxiliaryElement];
      }
      return [];
    }
  };

  const context = {
    AbortController,
    Headers,
    HTMLVideoElement: FakeVideoElement,
    MutationObserver: FakeMutationObserver,
    Request,
    Response,
    TextDecoder: FakeTextDecoder,
    URL,
    XMLHttpRequest: FakeXhr,
    atob,
    console,
    document,
    location: { href: "https://chzzk.naver.com/live/channel" },
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return 1;
    },
    setTimeout(callback, delay) {
      timeoutCallbacks.push({ callback, delay });
      return 1;
    }
  };
  context.globalThis = context;
  context.window = context;
  context.addEventListener = (type, listener) => {
    const current = listeners.get(type) || [];
    current.push(listener);
    listeners.set(type, current);
  };
  context.postMessage = () => {};
  const nativeXhrSend = FakeXhr.prototype.send;
  context.fetch = async (input) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/service/t/binary")) {
      return new Response(new Uint8Array([255, 0, 254, 1]), {
        headers: { "content-type": "application/octet-stream" }
      });
    }
    return new Response(
      JSON.stringify({
        code: 200,
        content: {
          [EVENT_FIELDS.state]: true,
          [EVENT_FIELDS.bootstrap]: false
        }
      }),
      { headers: { "content-type": "application/json" } }
    );
  };
  const nativeFetch = context.fetch;
  const nativeXhrOpen = FakeXhr.prototype.open;
  if (options.filterActive) {
    context[Symbol.for("chzzkfilter")] = true;
  }
  if (options.filterPlaybackActive) {
    context[Symbol.for("chzzkfilter-playback")] = true;
  }

  vm.createContext(context);
  for (const source of scripts) {
    vm.runInContext(source, context);
  }

  return {
    auxiliaryClassNames,
    classNames,
    context,
    createVideo(options) {
      const video = new FakeVideoElement(options);
      videos.push(video);
      return video;
    },
    dispatchDocumentEvent(type, target, properties = {}) {
      for (const listener of documentListeners.get(type) || []) {
        listener({ type, target, ...properties });
      }
    },
    fetchCalls,
    intervalCallbacks,
    flushTimeouts(delay) {
      for (const entry of timeoutCallbacks.filter((entry) => entry.delay === delay)) {
        entry.callback();
      }
    },
    nativeFetch,
    nativeXhrOpen,
    nativeXhrSend,
    noticeCloseClicks() {
      return noticeCloseClicks;
    }
  };
}

test("handles classified fetches before stored settings arrive", async () => {
  const runtime = createRuntime();
  const response = await runtime.context.fetch(
    "https://api.chzzk.naver.com/service/v3.3/channels/id/live-detail"
  );

  assert.equal(runtime.fetchCalls.length, 1);
  assert.deepEqual(await response.json(), {
    code: 200,
    content: {
      [EVENT_FIELDS.state]: false,
      [EVENT_FIELDS.bootstrap]: true
    }
  });
  assert.equal(runtime.classNames.has("chzzk-ex-playback-active"), true);
  assert.equal(runtime.auxiliaryClassNames.has("chzzk-ex-auxiliary"), true);
});

test("restores the direct path when the player parses playback data", () => {
  const runtime = createRuntime();
  const direct1080 =
    "https://nvelop-livecloud.pstatic.net/channel/1080p/playlist.m3u8?token=test";
  const encoded1080 = Buffer.from(direct1080).toString("base64url");
  runtime.context.playbackText = JSON.stringify({
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: `${CONNECTION_TOKEN}-config`,
        path: `https://apis.naver.com/${CONNECTION_TOKEN}/config`
      },
      { name: "qoeConfig", path: "https://apis.naver.com/policy" }
    ],
    media: [
      {
        mediaId: "LLHLS",
        encodingTrack: [
          {
            encodingTrackId: "1080p",
            [`${CONNECTION_TOKEN}Path`]: `/channel/1080p?cdn_url=${encoded1080}`
          }
        ]
      }
    ]
  });

  const playback = vm.runInContext("JSON.parse(playbackText)", runtime.context);

  assert.equal(playback.media[0].encodingTrack[0].path, direct1080);
  assert.equal(
    playback.media[0].encodingTrack[0][`${CONNECTION_TOKEN}Path`],
    ""
  );
  assert.equal(playback.meta[CONNECTION_TOKEN], true);
  assert.equal(playback.api.length, 2);
});

test("suppresses only the playback rejection listener slot", () => {
  const runtime = createRuntime();
  const result = vm.runInContext(
    `(() => {
      const eventName = ["AD", "NOT", "DISPLAYED"].join("_");
      const eventNames = {};
      eventNames[eventName] = eventName;
      const listenerTable = {};
      listenerTable[eventName] = [() => {}];
      return {
        enumValue: eventNames[eventName],
        enumOwn: Object.prototype.hasOwnProperty.call(eventNames, eventName),
        listenerValue: listenerTable[eventName],
        listenerOwn: Object.prototype.hasOwnProperty.call(
          listenerTable,
          eventName
        )
      };
    })()`,
    runtime.context
  );

  assert.equal(result.enumValue, ["AD", "NOT", "DISPLAYED"].join("_"));
  assert.equal(result.enumOwn, true);
  assert.equal(result.listenerValue, undefined);
  assert.equal(result.listenerOwn, false);
});

test("advances auxiliary playback after the player settles once", () => {
  const runtime = createRuntime();
  runtime.context.advanceCalls = [];
  const registration = vm.runInContext(
    `(() => {
      const eventName = ["ui", "ad", "skip"].join("_");
      const listenerTable = {};
      listenerTable[eventName] = [];
      listenerTable[eventName].push(
        () => advanceCalls.push("tracking"),
        () => advanceCalls.push("complete")
      );
      return {
        listenerOwn: Object.prototype.hasOwnProperty.call(
          listenerTable,
          eventName
        ),
        listenerCount: listenerTable[eventName].length
      };
    })()`,
    runtime.context
  );
  const video = runtime.createVideo();

  runtime.dispatchDocumentEvent("playing", video);
  runtime.dispatchDocumentEvent("playing", video);

  assert.equal(registration.listenerOwn, true);
  assert.equal(registration.listenerCount, 2);
  assert.deepEqual(Array.from(runtime.context.advanceCalls), []);

  runtime.flushTimeouts(150);

  assert.deepEqual(Array.from(runtime.context.advanceCalls), [
    "tracking",
    "complete"
  ]);
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1);
  assert.equal(video.currentTime, 0);
});

test("keeps the auxiliary media fallback when no player listener is available", () => {
  const runtime = createRuntime();
  const video = runtime.createVideo();

  runtime.dispatchDocumentEvent("playing", video);

  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);
  assert.equal(video.currentTime, 29.95);
});

test("restores the observed primary mute state after auxiliary playback", () => {
  const runtime = createRuntime();
  runtime.context.advanceCalls = [];
  vm.runInContext(
    `(() => {
      const eventName = ["ui", "ad", "skip"].join("_");
      const listenerTable = {};
      listenerTable[eventName] = [() => advanceCalls.push("complete")];
    })()`,
    runtime.context
  );
  const primary = runtime.createVideo({ auxiliary: false });
  runtime.dispatchDocumentEvent("playing", primary);
  runtime.flushTimeouts(750);
  const auxiliary = runtime.createVideo();

  primary.muted = true;
  runtime.dispatchDocumentEvent("volumechange", primary);
  runtime.dispatchDocumentEvent("playing", auxiliary);
  runtime.flushTimeouts(150);
  runtime.flushTimeouts(500);

  assert.equal(primary.muted, false);
  assert.deepEqual(Array.from(runtime.context.advanceCalls), ["complete"]);
});

test("keeps an explicit user mute choice across auxiliary playback", () => {
  const runtime = createRuntime();
  runtime.context.advanceCalls = [];
  vm.runInContext(
    `(() => {
      const eventName = ["ui", "ad", "skip"].join("_");
      const listenerTable = {};
      listenerTable[eventName] = [() => advanceCalls.push("complete")];
    })()`,
    runtime.context
  );
  const primary = runtime.createVideo({ auxiliary: false });
  runtime.dispatchDocumentEvent("playing", primary);
  runtime.flushTimeouts(750);
  runtime.dispatchDocumentEvent("pointerdown", {
    localName: "pzp-pc-volume-button",
    className: "pzp-pc__volume-button",
    getAttribute() {
      return null;
    }
  }, {
    composedPath() {
      return [this.target];
    }
  });
  primary.muted = true;
  runtime.dispatchDocumentEvent("volumechange", primary);
  const auxiliary = runtime.createVideo();

  runtime.dispatchDocumentEvent("playing", auxiliary);
  primary.muted = false;
  runtime.flushTimeouts(150);
  runtime.flushTimeouts(500);

  assert.equal(primary.muted, true);
  assert.deepEqual(Array.from(runtime.context.advanceCalls), ["complete"]);
});

test("yields auxiliary playback handling to an active filter runtime", () => {
  const runtime = createRuntime({ filterPlaybackActive: true });
  const video = runtime.createVideo();

  runtime.dispatchDocumentEvent("playing", video);
  for (const callback of runtime.intervalCallbacks) {
    callback();
  }

  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1);
  assert.equal(video.currentTime, 0);
});

test("keeps transport handling active when a filter marker exists", async () => {
  const runtime = createRuntime({ filterActive: true });

  assert.notEqual(runtime.context.fetch, runtime.nativeFetch);
  assert.notEqual(
    runtime.context.XMLHttpRequest.prototype.open,
    runtime.nativeXhrOpen
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      runtime.context.TextDecoder.prototype,
      "decode"
    ),
    true
  );
  const response = await runtime.context.fetch(
    "https://api.chzzk.naver.com/service/v1/ad/display-status"
  );
  assert.deepEqual((await response.json()).content.playerAdDisplayResponse, {
    preRoll: false,
    midRoll: false
  });
  assert.equal(runtime.fetchCalls.length, 0);
  assert.equal(runtime.classNames.has("chzzk-ex-playback-active"), true);
});

test("sends XHR immediately without waiting for stored settings", () => {
  const runtime = createRuntime();
  const sent = new runtime.context.XMLHttpRequest();
  sent.open(
    "GET",
    "https://api.chzzk.naver.com/service/v3.3/channels/id/live-detail"
  );
  sent.send("body");

  const aborted = new runtime.context.XMLHttpRequest();
  aborted.open(
    "GET",
    "https://api.chzzk.naver.com/service/v3.3/channels/id/live-detail"
  );
  aborted.send("discarded");
  aborted.abort();

  const synchronous = new runtime.context.XMLHttpRequest();
  synchronous.open(
    "GET",
    "https://api.chzzk.naver.com/service/v3.3/channels/id/live-detail",
    false
  );
  synchronous.send("sync");

  assert.deepEqual(sent.sentBodies, ["body"]);
  assert.deepEqual(aborted.sentBodies, ["discarded"]);
  assert.deepEqual(synchronous.sentBodies, ["sync"]);
  assert.equal(runtime.context.XMLHttpRequest.prototype.send, runtime.nativeXhrSend);
  assert.equal(runtime.classNames.has("chzzk-ex-playback-active"), true);
});

test("keeps unrelated XHR instances indistinguishable from the native surface", () => {
  const runtime = createRuntime();
  const xhr = new runtime.context.XMLHttpRequest();

  xhr.open("OPTIONS", "https://nam.veta.naver.com/vas");

  assert.equal(
    hasUnexpectedXhrSurface(xhr, runtime.context.XMLHttpRequest),
    false
  );
  for (const property of XHR_PROBE_PROPERTIES) {
    assert.equal(Object.prototype.hasOwnProperty.call(xhr, property), false);
  }
  assert.equal(
    xhr.setRequestHeader,
    runtime.context.XMLHttpRequest.prototype.setRequestHeader
  );
  assert.equal(Object.prototype.hasOwnProperty.call(xhr, "responseText"), false);
});

test("removes the response facade when a classified XHR is reused elsewhere", () => {
  const runtime = createRuntime();
  const xhr = new runtime.context.XMLHttpRequest();

  xhr.open(
    "GET",
    "https://api.chzzk.naver.com/service/v3.3/channels/id/live-detail"
  );
  assert.equal(Object.prototype.hasOwnProperty.call(xhr, "response"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(xhr, "responseText"), true);

  xhr.open("OPTIONS", "https://nam.veta.naver.com/vas");
  assert.equal(Object.prototype.hasOwnProperty.call(xhr, "response"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(xhr, "responseText"), false);
});

test("keeps protected tunnel XHR instances on the native response surface", () => {
  const runtime = createRuntime();
  const xhr = new runtime.context.XMLHttpRequest();

  xhr.open("POST", "https://api.chzzk.naver.com/service/t/opaque-token");

  assert.equal(
    hasUnexpectedXhrSurface(xhr, runtime.context.XMLHttpRequest),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(xhr, "responseText"), false);
});

test("rewrites only decoded protected tunnel payloads", () => {
  const runtime = createRuntime();
  const playback = {
    meta: { [CONNECTION_TOKEN]: true },
    api: [
      {
        name: `${CONNECTION_TOKEN}-config`,
        path: `https://apis.naver.com/${CONNECTION_TOKEN}/config`
      },
      { name: "qoeConfig", path: "https://apis.naver.com/policy" }
    ],
    media: [{ encodingTrack: [{ encodingTrackId: "1080p" }] }]
  };
  const originalText = JSON.stringify({
    code: 200,
    content: {
      dab: true,
      skipPreRollAd: false,
      [`${CONNECTION_TOKEN}Quality`]: ["1080p"],
      livePlaybackJson: JSON.stringify(playback)
    }
  });
  const bytes = new TextEncoder().encode(originalText);

  const ordinaryDecoder = new runtime.context.TextDecoder("utf-8");
  assert.equal(ordinaryDecoder.decode(bytes), originalText);

  const tunnelDecoder = new runtime.context.TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false
  });
  const rewritten = JSON.parse(tunnelDecoder.decode(bytes));
  const rewrittenPlayback = JSON.parse(rewritten.content.livePlaybackJson);

  assert.equal(rewritten.content.dab, false);
  assert.equal(rewritten.content.skipPreRollAd, true);
  assert.equal(`${CONNECTION_TOKEN}Quality` in rewritten.content, false);
  assert.equal(rewrittenPlayback.meta[CONNECTION_TOKEN], false);
  assert.equal(rewrittenPlayback.api.length, 1);
  assert.equal(rewrittenPlayback.media[0].encodingTrack[0].encodingTrackId, "1080p");
});

test("preserves opaque tunnel responses byte-for-byte", async () => {
  const runtime = createRuntime();
  const response = await runtime.context.fetch(
    "https://api.chzzk.naver.com/service/t/binary"
  );

  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    [255, 0, 254, 1]
  );
});

test("does not dismiss the playback notice automatically", () => {
  const runtime = createRuntime();

  for (const callback of runtime.intervalCallbacks) {
    callback();
  }

  assert.equal(runtime.noticeCloseClicks(), 0);
});
