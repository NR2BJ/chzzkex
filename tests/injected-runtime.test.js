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

function createRuntime() {
  const listeners = new Map();
  const fetchCalls = [];
  const intervalCallbacks = [];
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

  class FakeVideoElement {}

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
    addEventListener() {},
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
    console,
    document,
    location: { href: "https://chzzk.naver.com/live/channel" },
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return 1;
    },
    setTimeout() {
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

  vm.createContext(context);
  for (const source of scripts) {
    vm.runInContext(source, context);
  }

  return {
    auxiliaryClassNames,
    classNames,
    context,
    fetchCalls,
    intervalCallbacks,
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
