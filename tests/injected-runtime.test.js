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
const EVENT_TOKEN = String.fromCharCode(97, 100);
const EVENT_TITLE_TOKEN =
  EVENT_TOKEN[0].toUpperCase() + EVENT_TOKEN.slice(1);
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
  const subtleDecryptCalls = [];
  const intervalCallbacks = [];
  const mutationCallbacks = [];
  const timeoutCallbacks = [];
  const videos = [];
  const classNames = new Set();
  const auxiliaryClassNames = new Set();
  const playbackRejectionClassNames = new Set();
  const playbackRejectionAttributes = new Map();
  const playbackRejectionBackdropClassNames = new Set();
  const playbackRejectionBackdropAttributes = new Map();
  let playbackRejectionPresent = Boolean(options.playbackRejectionPresent);
  let noticeCloseClicks = 0;
  const auxiliaryElement = {
    classList: {
      add(name) {
        auxiliaryClassNames.add(name);
      }
    }
  };
  const bodyElement = {};
  const playbackRejectionBackdropParent =
    options.playbackRejectionBackdropNested ? {} : bodyElement;
  const playbackRejectionBackdrop = {
    parentElement: playbackRejectionBackdropParent,
    classList: {
      add(name) {
        playbackRejectionBackdropClassNames.add(name);
      }
    },
    setAttribute(name, value) {
      playbackRejectionBackdropAttributes.set(name, value);
    }
  };
  const playbackRejectionElement = {
    parentElement: playbackRejectionBackdrop,
    classList: {
      add(name) {
        playbackRejectionClassNames.add(name);
      }
    },
    getAttribute(name) {
      const baseAttributes = {
        "aria-modal": "true",
        "data-nlog-area": "ad_blocking_info_layer",
        role: "alertdialog"
      };
      return playbackRejectionAttributes.has(name)
        ? playbackRejectionAttributes.get(name)
        : baseAttributes[name] ?? null;
    },
    setAttribute(name, value) {
      playbackRejectionAttributes.set(name, value);
    }
  };
  playbackRejectionBackdrop.childElementCount =
    options.playbackRejectionBackdropHasSibling ? 2 : 1;
  playbackRejectionBackdrop.firstElementChild = playbackRejectionElement;

  class FakeMutationObserver {
    constructor(callback) {
      mutationCallbacks.push(callback);
    }

    observe() {}
  }

  class FakeEventTarget {
    constructor() {
      this.listeners = [];
    }

    addEventListener(type, listener) {
      this.listeners.push({ type, listener });
    }
  }

  class FakeSubtleCrypto {
    decrypt(algorithm, key, data) {
      subtleDecryptCalls.push({ algorithm, key, data });
      if (data instanceof ArrayBuffer) {
        return Promise.resolve(data.slice(0));
      }

      return Promise.resolve(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      );
    }
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
    body: bodyElement,
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
      if (selector.includes("_blocking_info_layer")) {
        return playbackRejectionPresent ? [playbackRejectionElement] : [];
      }
      return [];
    }
  };

  const context = {
    AbortController,
    crypto: { subtle: new FakeSubtleCrypto() },
    EventTarget: FakeEventTarget,
    Headers,
    HTMLVideoElement: FakeVideoElement,
    MutationObserver: FakeMutationObserver,
    Request,
    Response,
    SubtleCrypto: FakeSubtleCrypto,
    TextDecoder: FakeTextDecoder,
    TextEncoder,
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
    const payload = options.fetchPayload || {
      code: 200,
      content: {
        [EVENT_FIELDS.state]: true,
        [EVENT_FIELDS.bootstrap]: false
      }
    };
    return new Response(
      JSON.stringify(payload),
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
    flushMutations() {
      for (const callback of mutationCallbacks) {
        callback([]);
      }
    },
    flushTimeouts(delay) {
      for (const entry of timeoutCallbacks.filter((entry) => entry.delay === delay)) {
        entry.callback();
      }
    },
    nativeFetch,
    nativeXhrOpen,
    nativeXhrSend,
    playbackRejectionAttributes,
    playbackRejectionBackdropAttributes,
    playbackRejectionBackdropClassNames,
    playbackRejectionClassNames,
    setPlaybackRejectionPresent(present) {
      playbackRejectionPresent = present;
    },
    subtleDecryptCalls,
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

test("rewrites playback-source fetch responses before Response.json", async () => {
  const direct720 =
    "https://nvelop-livecloud.pstatic.net/channel/720p/playlist.m3u8?token=A~A";
  const encoded720 = Buffer.from(direct720).toString("base64");
  const runtime = createRuntime({
    fetchPayload: {
      code: 200,
      content: {
        playbackJson: JSON.stringify({
          meta: { [CONNECTION_TOKEN]: true },
          api: [
            {
              name: CONNECTION_TOKEN + "-config",
              path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
            }
          ],
          media: [
            {
              mediaId: "LLHLS",
              encodingTrack: [
                {
                  encodingTrackId: "720p",
                  [CONNECTION_TOKEN + "Path"]:
                    "/channel/720p?cdn_url=" + encoded720
                }
              ]
            }
          ]
        }),
        [CONNECTION_TOKEN + "Quality"]: ["720p"]
      }
    }
  });

  const response = await runtime.context.fetch(
    "https://api.chzzk.naver.com/service/v1.1/channels/id/live-playback-json?tm=true"
  );
  const payload = await response.json();
  const playback = JSON.parse(payload.content.playbackJson);
  const track = playback.media[0].encodingTrack[0];

  assert.equal(track.path, direct720);
  assert.equal(CONNECTION_TOKEN + "Path" in track, false);
  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 0);
  assert.equal(CONNECTION_TOKEN + "Quality" in payload.content, false);
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
    CONNECTION_TOKEN + "Path" in playback.media[0].encodingTrack[0],
    false
  );
  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 1);
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

test("suppresses the rejection signal across alternate listener stores", () => {
  const runtime = createRuntime();
  const result = vm.runInContext(
    `(() => {
      const eventName = ["AD", "NOT", "DISPLAYED"].join("_");
      const listenerMap = new Map();
      listenerMap.set(eventName, [() => {}]);
      const target = new EventTarget();
      target.addEventListener(eventName, () => {});
      target.addEventListener("ordinary", () => {});
      return {
        mappedListeners: listenerMap.get(eventName).length,
        storedTypes: target.listeners.map((entry) => entry.type)
      };
    })()`,
    runtime.context
  );

  assert.equal(result.mappedListeners, 0);
  assert.deepEqual(Array.from(result.storedTypes), ["ordinary"]);
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

test("rewrites playback-source XHR text and JSON responses", () => {
  const runtime = createRuntime();
  const sourcePayload = {
    code: 200,
    content: {
      playbackJson: JSON.stringify({
        meta: { [CONNECTION_TOKEN]: true },
        api: [
          {
            name: CONNECTION_TOKEN + "-config",
            path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
          }
        ],
        media: [
          {
            mediaId: "HLS",
            encodingTrack: [
              {
                encodingTrackId: "720p",
                [CONNECTION_TOKEN + "Path"]:
                  "/channel/720p?cdn_url=invalid"
              }
            ]
          }
        ]
      }),
      [CONNECTION_TOKEN + "Quality"]: ["720p"]
    }
  };
  const responses = [];

  for (const responseType of ["", "json"]) {
    const xhr = new runtime.context.XMLHttpRequest();
    xhr.open(
      "GET",
      "https://api.chzzk.naver.com/manage/v1/channels/channel-id/watch-party/source/source-id"
    );
    xhr.responseType = responseType;
    xhr._readyState = runtime.context.XMLHttpRequest.DONE;
    if (responseType === "json") {
      xhr._response = sourcePayload;
      responses.push(xhr.response);
    } else {
      xhr._responseText = JSON.stringify(sourcePayload);
      responses.push(JSON.parse(xhr.responseText));
    }
  }

  for (const payload of responses) {
    const playback = JSON.parse(payload.content.playbackJson);
    assert.equal(playback.meta[CONNECTION_TOKEN], false);
    assert.equal(playback.api.length, 0);
    assert.equal(
      CONNECTION_TOKEN + "Path" in playback.media[0].encodingTrack[0],
      false
    );
    assert.equal(CONNECTION_TOKEN + "Quality" in payload.content, false);
  }
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

test("rewrites playback-source data in decoded protected tunnels", () => {
  const runtime = createRuntime();
  const originalText = JSON.stringify({
    code: 200,
    content: {
      playbackJson: JSON.stringify({
        meta: { [CONNECTION_TOKEN]: true },
        api: [
          {
            name: CONNECTION_TOKEN + "-config",
            path: "https://apis.naver.com/" + CONNECTION_TOKEN + "/config"
          }
        ],
        media: [
          {
            mediaId: "LLHLS",
            encodingTrack: [
              {
                encodingTrackId: "720p",
                [CONNECTION_TOKEN + "Path"]:
                  "/channel/720p?cdn_url=invalid"
              }
            ]
          }
        ]
      }),
      [CONNECTION_TOKEN + "Quality"]: ["720p"]
    }
  });
  const bytes = new TextEncoder().encode(originalText);
  const tunnelDecoder = new runtime.context.TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false
  });

  const rewritten = JSON.parse(tunnelDecoder.decode(bytes));
  const playback = JSON.parse(rewritten.content.playbackJson);

  assert.equal(playback.meta[CONNECTION_TOKEN], false);
  assert.equal(playback.api.length, 0);
  assert.equal(
    CONNECTION_TOKEN + "Path" in playback.media[0].encodingTrack[0],
    false
  );
  assert.equal(CONNECTION_TOKEN + "Quality" in rewritten.content, false);
});

test("rewrites protected schedules when the player creates transport bytes", () => {
  const runtime = createRuntime();
  const schedule = {
    head: {
      version: "0.0.1",
      description: ["GFP", "Video", EVENT_TITLE_TOKEN, "Schedule"].join(" ")
    },
    requestId: "vas-12345678-1234-1234-9234-123456789abc",
    [`video${EVENT_TITLE_TOKEN}ScheduleId`]: "LIVE_CHZZK_NDP_SCH",
    [`${EVENT_TOKEN}Breaks`]: [
      {
        id: "MID-0",
        startDelay: 0,
        preFetch: 0,
        [`${EVENT_TOKEN}UnitId`]: "w_live_chzzk_naver_va_mid",
        [`${EVENT_TOKEN}Sources`]: [{ id: "MID-0-0", withRemindAd: 0 }]
      }
    ]
  };
  runtime.context.protectedBytes = Array.from(
    new TextEncoder().encode(JSON.stringify(schedule))
  );

  const rewrittenBytes = vm.runInContext(
    "Array.from(new Uint8Array(protectedBytes))",
    runtime.context
  );
  const rewritten = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(rewrittenBytes))
  );

  assert.equal(rewritten.requestId, schedule.requestId);
  assert.deepEqual(rewritten[`${EVENT_TOKEN}Breaks`], [
    {
      id: "",
      startDelay: 0,
      preFetch: 0,
      [`${EVENT_TOKEN}UnitId`]: "",
      [`${EVENT_TOKEN}Sources`]: []
    }
  ]);
});

test("rewrites authenticated tunnel plaintext immediately after decrypt", async () => {
  const runtime = createRuntime();
  const schedule = {
    head: {
      version: "0.0.1",
      description: ["GFP", "Video", EVENT_TITLE_TOKEN, "Schedule"].join(" ")
    },
    requestId: "vas-12345678-1234-1234-9234-123456789abc",
    [`video${EVENT_TITLE_TOKEN}ScheduleId`]: "LIVE_CHZZK_NDP_SCH",
    [`${EVENT_TOKEN}Breaks`]: [
      {
        id: "MID-0",
        [`${EVENT_TOKEN}UnitId`]: "w_live_chzzk_naver_va_mid",
        [`${EVENT_TOKEN}Sources`]: [{ id: "MID-0-0" }]
      }
    ]
  };
  const source = new TextEncoder().encode(JSON.stringify(schedule)).buffer;

  const rewrittenBuffer = await runtime.context.crypto.subtle.decrypt(
    { name: "AES-GCM" },
    {},
    source
  );
  const rewritten = JSON.parse(
    new TextDecoder().decode(new Uint8Array(rewrittenBuffer))
  );

  assert.equal(runtime.subtleDecryptCalls.length, 1);
  assert.deepEqual(rewritten[`${EVENT_TOKEN}Breaks`], [
    {
      id: "",
      startDelay: 0,
      preFetch: 0,
      [`${EVENT_TOKEN}UnitId`]: "",
      [`${EVENT_TOKEN}Sources`]: []
    }
  ]);
});

test("leaves unrelated crypto algorithms and plaintext unchanged", async () => {
  const runtime = createRuntime();
  const sourceText = JSON.stringify({ purpose: "ordinary" });
  const source = new TextEncoder().encode(sourceText).buffer;

  const cbcBuffer = await runtime.context.crypto.subtle.decrypt(
    { name: "AES-CBC" },
    {},
    source
  );
  const gcmBuffer = await runtime.context.crypto.subtle.decrypt(
    { name: "AES-GCM" },
    {},
    source
  );

  assert.equal(new TextDecoder().decode(new Uint8Array(cbcBuffer)), sourceText);
  assert.equal(new TextDecoder().decode(new Uint8Array(gcmBuffer)), sourceText);
});

test("rewrites protected waterfall bytes before playback consumes them", () => {
  const runtime = createRuntime();
  const waterfall = {
    requestId: "0123456789abcdef0123456789abcdef",
    head: {
      version: "0.0.1",
      description: "Naver SSP Waterfall List"
    },
    eventTracking: {
      completions: [{ url: "https://example.test/complete" }]
    },
    [`${EVENT_TOKEN}UnitId`]: "w_live_chzzk_naver_va_mid",
    [`${EVENT_TOKEN}s`]: [{ encrypted: "payload" }]
  };
  runtime.context.protectedBytes = Array.from(
    new TextEncoder().encode(`\n${JSON.stringify(waterfall)}`)
  );

  const rewrittenBytes = vm.runInContext(
    "Array.from(new Uint8Array(protectedBytes))",
    runtime.context
  );
  const rewritten = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(rewrittenBytes))
  );

  assert.deepEqual(rewritten[`${EVENT_TOKEN}s`], []);
  assert.equal(rewritten.requestId, waterfall.requestId);
});

test("preserves unrelated typed-array construction", () => {
  const runtime = createRuntime();
  const source = new TextEncoder().encode(
    JSON.stringify({ head: { version: "0.0.1", description: "ordinary" } })
  );
  runtime.context.protectedBytes = Array.from(source);

  const result = vm.runInContext(
    `({
      bytes: Array.from(new Uint8Array(protectedBytes)),
      instance: new Uint8Array(1) instanceof Uint8Array,
      width: Uint8Array.BYTES_PER_ELEMENT
    })`,
    runtime.context
  );

  assert.deepEqual(Array.from(result.bytes), Array.from(source));
  assert.equal(result.instance, true);
  assert.equal(result.width, 1);
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

test("hides the dedicated playback rejection layer without clicking generic notices", () => {
  const runtime = createRuntime({ playbackRejectionPresent: true });

  runtime.playbackRejectionClassNames.clear();
  runtime.playbackRejectionAttributes.clear();
  runtime.playbackRejectionBackdropClassNames.clear();
  runtime.playbackRejectionBackdropAttributes.clear();
  runtime.flushMutations();

  assert.equal(
    runtime.playbackRejectionClassNames.has(
      "chzzk-ex-playback-rejection-hidden"
    ),
    true
  );
  assert.equal(runtime.playbackRejectionAttributes.get("aria-hidden"), "true");
  assert.equal(runtime.playbackRejectionAttributes.get("inert"), "");
  assert.equal(
    runtime.playbackRejectionBackdropClassNames.has(
      "chzzk-ex-playback-rejection-hidden"
    ),
    true
  );
  assert.equal(
    runtime.playbackRejectionBackdropAttributes.get("aria-hidden"),
    "true"
  );
  assert.equal(
    runtime.classNames.has("chzzk-ex-playback-rejection-active"),
    true
  );
  assert.equal(runtime.noticeCloseClicks(), 0);

  runtime.setPlaybackRejectionPresent(false);
  runtime.flushMutations();
  assert.equal(
    runtime.classNames.has("chzzk-ex-playback-rejection-active"),
    false
  );
});

for (const [structure, options] of [
  ["nested backdrop", { playbackRejectionBackdropNested: true }],
  ["backdrop with a sibling", { playbackRejectionBackdropHasSibling: true }]
]) {
  test(`hides only the playback rejection layer for a ${structure}`, () => {
    const runtime = createRuntime({
      playbackRejectionPresent: true,
      ...options
    });

    runtime.playbackRejectionClassNames.clear();
    runtime.playbackRejectionAttributes.clear();
    runtime.playbackRejectionBackdropClassNames.clear();
    runtime.playbackRejectionBackdropAttributes.clear();
    runtime.flushMutations();

    assert.equal(
      runtime.playbackRejectionClassNames.has(
        "chzzk-ex-playback-rejection-hidden"
      ),
      true
    );
    assert.equal(runtime.playbackRejectionAttributes.get("aria-hidden"), "true");
    assert.equal(runtime.playbackRejectionAttributes.get("inert"), "");
    assert.equal(runtime.playbackRejectionBackdropClassNames.size, 0);
    assert.equal(runtime.playbackRejectionBackdropAttributes.size, 0);
    assert.equal(
      runtime.classNames.has("chzzk-ex-playback-rejection-active"),
      false
    );
    assert.equal(runtime.noticeCloseClicks(), 0);
  });
}

test("keeps auxiliary containers measurable for the current player guard", () => {
  const css = fs.readFileSync(path.join(root, "src/playback.css"), "utf8");

  assert.match(css, /visibility:\s*hidden/);
  assert.doesNotMatch(css, /opacity:\s*0/);
});

test("hides the dedicated playback rejection layer before it can be shown", () => {
  const css = fs.readFileSync(path.join(root, "src/playback.css"), "utf8");

  assert.match(
    css,
    /^\[data-nlog-area=["']ad_blocking_info_layer["']\]/m
  );
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /pointer-events:\s*none\s*!important/);
  assert.match(css, /chzzk-ex-playback-rejection-active\s+body/);
  assert.match(css, /overflow:\s*auto\s*!important/);
  assert.match(css, /padding-right:\s*0\s*!important/);
});
