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
const scripts = ["src/settings.js", "src/rewrite-core.js", "src/injected.js"].map(
  (file) => fs.readFileSync(path.join(root, file), "utf8")
);

function createRuntime() {
  const listeners = new Map();
  const fetchCalls = [];
  const classNames = new Set();
  const auxiliaryClassNames = new Set();
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

  class FakeXhr {
    static DONE = 4;
    static OPENED = 1;

    constructor() {
      this.readyState = 0;
      this.responseType = "";
      this.sentBodies = [];
      this._responseText = "";
      this._response = "";
    }

    open() {
      this.readyState = FakeXhr.OPENED;
    }

    send(body) {
      this.sentBodies.push(body);
    }

    abort() {
      this.readyState = 0;
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
    querySelector() {
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
    URL,
    XMLHttpRequest: FakeXhr,
    console,
    document,
    location: { href: "https://chzzk.naver.com/live/channel" },
    setInterval() {
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
  context.fetch = async (input) => {
    fetchCalls.push(String(input));
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
    fetchCalls
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
  assert.equal(runtime.classNames.has("chzzk-ex-playback-active"), true);
});
