const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scripts = ["src/settings.js", "src/feature-core.js", "src/features.js"].map(
  (file) => ({
    file,
    source: fs.readFileSync(path.join(root, file), "utf8")
  })
);
const BLIND_PLACEHOLDER = "메시지가 블라인드 처리되었습니다.";

function createRuntime({
  message,
  renderedText = "hello",
  nativeHidden,
  nicknameStyle = {
    color: "rgb(20, 21, 23)",
    backgroundImage: "none",
    backgroundClip: "border-box"
  }
} = {}) {
  const intervals = [];
  const mutationObservers = [];
  const queryCounts = new Map();
  const timeoutCallbacks = new Map();
  const windowListeners = new Map();
  let nextTimerId = 1;
  let currentNicknameStyle = nicknameStyle;
  let nicknameStyleReads = 0;

  function dataName(attribute) {
    return attribute
      .slice("data-".length)
      .replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  }

  function matchesSimpleSelector(element, selector) {
    const trimmed = selector.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed.startsWith(".")) {
      return element.classList.contains(trimmed.slice(1));
    }

    const attributeMatch = trimmed.match(
      /^(?:([a-z]+))?\[([\w-]+)(?:(\*=|=)('[^']*'|"[^"]*"))?\]$/i
    );
    if (attributeMatch) {
      const [, tagName, attribute, operator, quotedValue] = attributeMatch;
      if (tagName && element.tagName !== tagName.toUpperCase()) {
        return false;
      }
      const value = element.getAttribute(attribute);
      if (quotedValue === undefined) {
        return value !== null;
      }
      const expected = quotedValue.slice(1, -1);
      return operator === "*="
        ? String(value || "").includes(expected)
        : value === expected;
    }

    return element.tagName === trimmed.toUpperCase();
  }

  class FakeHTMLElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.parentElement = null;
      this.children = [];
      this.classWriteCount = 0;
      this.datasetWriteCount = 0;
      const datasetValues = {};
      this.dataset = new Proxy(datasetValues, {
        deleteProperty: (target, property) => {
          if (Object.prototype.hasOwnProperty.call(target, property)) {
            this.datasetWriteCount += 1;
            delete target[property];
          }
          return true;
        },
        set: (target, property, value) => {
          const nextValue = String(value);
          if (target[property] !== nextValue) {
            this.datasetWriteCount += 1;
            target[property] = nextValue;
          }
          return true;
        }
      });
      this.attributes = new Map();
      this._classNames = new Set();
      this._textContent = "";
      this.removeCount = 0;
      this.textWriteCount = 0;
      this.classList = {
        add: (...names) => {
          for (const name of names) {
            if (!this._classNames.has(name)) {
              this.classWriteCount += 1;
              this._classNames.add(name);
            }
          }
        },
        contains: (name) => this._classNames.has(name),
        remove: (...names) => {
          for (const name of names) {
            if (this._classNames.delete(name)) {
              this.classWriteCount += 1;
            }
          }
        },
        [Symbol.iterator]: () => this._classNames.values()
      };
    }

    get className() {
      return Array.from(this._classNames).join(" ");
    }

    set className(value) {
      this._classNames = new Set(String(value || "").split(/\s+/).filter(Boolean));
    }

    get firstChild() {
      return this.children[0] || null;
    }

    get isConnected() {
      let current = this;
      while (current) {
        if (current === document.documentElement) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    get textContent() {
      return (
        this._textContent +
        this.children.map((child) => child.textContent || "").join("")
      );
    }

    set textContent(value) {
      this.textWriteCount += 1;
      this._textContent = String(value ?? "");
      for (const child of this.children) {
        child.parentElement = null;
      }
      this.children = [];
    }

    appendChild(child) {
      return this.insertBefore(child, null);
    }

    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches(selector)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    getAttribute(name) {
      if (name === "class") {
        return this.className || null;
      }
      if (name.startsWith("data-")) {
        const value = this.dataset[dataName(name)];
        return value === undefined ? null : String(value);
      }
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    insertBefore(child, reference) {
      if (child.parentElement) {
        const previousIndex = child.parentElement.children.indexOf(child);
        if (previousIndex >= 0) {
          child.parentElement.children.splice(previousIndex, 1);
        }
      }
      const index = reference ? this.children.indexOf(reference) : -1;
      if (index >= 0) {
        this.children.splice(index, 0, child);
      } else {
        this.children.push(child);
      }
      child.parentElement = this;
      return child;
    }

    matches(selector) {
      return String(selector)
        .split(",")
        .some((part) => matchesSimpleSelector(this, part));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const matches = [];
      const visit = (element) => {
        for (const child of element.children) {
          if (child.matches(selector)) {
            matches.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return matches;
    }

    remove() {
      this.removeCount += 1;
      if (!this.parentElement) {
        return;
      }
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) {
        this.parentElement.children.splice(index, 1);
      }
      this.parentElement = null;
    }

    setAttribute(name, value) {
      if (name === "class") {
        this.className = value;
      } else if (name.startsWith("data-")) {
        this.dataset[dataName(name)] = String(value);
      } else {
        this.attributes.set(name, String(value));
      }
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.options = null;
      this.target = null;
      mutationObservers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }

  const document = {
    addEventListener() {},
    createElement(tagName) {
      return new FakeHTMLElement(tagName);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      queryCounts.set(selector, (queryCounts.get(selector) || 0) + 1);
      const matches = [];
      if (this.documentElement.matches(selector)) {
        matches.push(this.documentElement);
      }
      if (this.body.matches(selector)) {
        matches.push(this.body);
      }
      return [...matches, ...this.body.querySelectorAll(selector)];
    }
  };
  document.documentElement = new FakeHTMLElement("html");
  document.body = new FakeHTMLElement("body");
  document.documentElement.appendChild(document.body);

  const chatLog = new FakeHTMLElement("div");
  chatLog.setAttribute("role", "log");
  const item = new FakeHTMLElement("div");
  item.className = "_item_test";
  const nickname = new FakeHTMLElement("button");
  nickname.className = "nickname_test";
  nickname.textContent = message?.profile?.nickname || "tester";
  const messageElement = new FakeHTMLElement("p");
  const hiddenByDefault = message?.status
    ? !["NORMAL", "CANCEL"].includes(String(message.status).toUpperCase())
    : renderedText === BLIND_PLACEHOLDER;
  messageElement.className =
    nativeHidden ?? hiddenByDefault
      ? "_text_test _is_hidden_test"
      : "_text_test";
  messageElement.textContent = renderedText;
  item.appendChild(nickname);
  item.appendChild(messageElement);
  chatLog.appendChild(item);
  document.body.appendChild(chatLog);

  function setMessage(nextMessage) {
    item.__reactProps$test = { chatMessage: nextMessage };
  }
  setMessage(
    message || {
      key: "message-a",
      time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
      user: "tester",
      content: renderedText,
      originalContent: renderedText,
      profile: { nickname: "tester" }
    }
  );

  const context = {
    __windowListeners: windowListeners,
    clearTimeout(id) {
      timeoutCallbacks.delete(id);
    },
    console,
    document,
    HTMLElement: FakeHTMLElement,
    location: {
      href: "https://chzzk.naver.com/live/channel",
      pathname: "/live/channel"
    },
    MutationObserver: FakeMutationObserver,
    performance: { now: () => 0 },
    getComputedStyle(element) {
      if (element === nickname) {
        nicknameStyleReads += 1;
        return currentNicknameStyle;
      }
      return {
        color: "rgb(20, 21, 23)",
        backgroundImage: "none",
        backgroundClip: "border-box"
      };
    },
    setInterval(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      intervals.push({ callback, delay, id });
      return id;
    },
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timeoutCallbacks.set(id, { callback, delay });
      return id;
    }
  };
  context.globalThis = context;
  context.window = context;
  context.addEventListener = (type, listener) => {
    const current = windowListeners.get(type) || [];
    current.push(listener);
    windowListeners.set(type, current);
  };
  context.postMessage = () => {};

  vm.createContext(context);
  for (const script of scripts) {
    vm.runInContext(script.source, context, { filename: script.file });
  }

  function chatObserver() {
    return mutationObservers.find((observer) => observer.target === document.body);
  }

  function dispatchSettings(settings) {
    context.__nextSettings = settings;
    vm.runInContext(
      `__windowListeners.get("message")[0]({
        source: window,
        data: {
          source: "chzzk-ex",
          type: "settings",
          settings: __nextSettings
        }
      })`,
      context
    );
    delete context.__nextSettings;
  }

  function flushTimeouts(delay) {
    const scheduled = Array.from(timeoutCallbacks.entries()).filter(
      ([, timer]) => timer.delay === delay
    );
    for (const [id, timer] of scheduled) {
      timeoutCallbacks.delete(id);
      timer.callback();
    }
  }

  function notifyChat(mutations) {
    const observer = chatObserver();
    assert.ok(observer, "chat observer must be attached to document.body");
    observer.callback(mutations);
  }

  function runInterval(delay) {
    const interval = intervals.find((entry) => entry.delay === delay);
    assert.ok(interval, `expected a ${delay}ms interval`);
    interval.callback();
  }

  function runIntervals(delay) {
    const matching = intervals.filter((entry) => entry.delay === delay);
    assert.ok(matching.length > 0, `expected at least one ${delay}ms interval`);
    for (const interval of matching) {
      interval.callback();
    }
  }

  return {
    BLIND_PLACEHOLDER,
    FakeHTMLElement,
    chatLog,
    chatObserverOptions() {
      const options = chatObserver()?.options;
      return options ? JSON.parse(JSON.stringify(options)) : null;
    },
    dispatchSettings,
    document,
    flushTimeouts,
    item,
    messageElement,
    nickname,
    notifyChat,
    nicknameStyleReads() {
      return nicknameStyleReads;
    },
    pendingTimeouts(delay) {
      return Array.from(timeoutCallbacks.values()).filter(
        (timer) => timer.delay === delay
      ).length;
    },
    queryCount(selector) {
      return queryCounts.get(selector) || 0;
    },
    runInterval,
    runIntervals,
    setNicknameStyle(style) {
      currentNicknameStyle = style;
    },
    setMessage,
    timestamp() {
      return item.querySelector(".cng-chat-timestamp");
    },
    totalDocumentQueryCount() {
      return Array.from(queryCounts.values()).reduce(
        (total, count) => total + count,
        0
      );
    }
  };
}

test("skips chat DOM work while every chat option is disabled", () => {
  const runtime = createRuntime();

  assert.equal(runtime.queryCount("[role='log']"), 0);
  runtime.runInterval(3000);
  assert.equal(runtime.queryCount("[role='log']"), 0);
  const queriesBeforeVerifier = runtime.totalDocumentQueryCount();
  runtime.runIntervals(100);
  assert.equal(runtime.totalDocumentQueryCount(), queriesBeforeVerifier);

  assert.deepEqual(runtime.chatObserverOptions(), {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "data-index",
      "data-key",
      "data-virtual-index",
      "aria-posinset"
    ]
  });

  const addedNode = new runtime.FakeHTMLElement("span");
  runtime.notifyChat([
    {
      addedNodes: [addedNode],
      removedNodes: [],
      target: runtime.chatLog,
      type: "childList"
    }
  ]);
  assert.equal(runtime.pendingTimeouts(50), 0);
  assert.equal(runtime.queryCount("[role='log']"), 0);

  runtime.dispatchSettings({ chatTimestamp: true });
  assert.equal(runtime.pendingTimeouts(50), 1);
  runtime.flushTimeouts(50);

  assert.equal(runtime.queryCount("[role='log']"), 1);
  assert.ok(runtime.timestamp());
});

test("removes an owned timestamp immediately when the last chat option turns off", () => {
  const runtime = createRuntime();
  runtime.dispatchSettings({ chatTimestamp: true });
  runtime.flushTimeouts(50);
  const timestamp = runtime.timestamp();
  assert.ok(timestamp);
  const scansBeforeDisable = runtime.queryCount("[role='log']");

  runtime.notifyChat([
    {
      addedNodes: [timestamp],
      removedNodes: [],
      target: runtime.item,
      type: "childList"
    }
  ]);
  assert.equal(runtime.pendingTimeouts(50), 1);

  runtime.dispatchSettings({ chatTimestamp: false });

  assert.equal(timestamp.removeCount, 1);
  assert.equal(runtime.timestamp(), null);
  assert.equal(runtime.pendingTimeouts(50), 0);
  assert.equal(runtime.queryCount("[role='log']"), scansBeforeDisable);
});

test("restores the new original when a blinded row is reused without a DOM rewrite", () => {
  const messageA = {
    key: "message-a",
    time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
    user: "tester",
    status: "BLIND",
    content: BLIND_PLACEHOLDER,
    originalContent: "original A",
    profile: { nickname: "tester" }
  };
  const runtime = createRuntime({
    message: messageA,
    renderedText: BLIND_PLACEHOLDER
  });
  runtime.dispatchSettings({ restoreBlindedMessages: true });
  runtime.flushTimeouts(50);

  assert.equal(runtime.messageElement.textContent, "original A");
  assert.equal(runtime.messageElement.dataset.cngBlindedRestored, "message-a");

  const messageB = {
    ...messageA,
    key: "message-b",
    time: messageA.time + 1000,
    originalContent: "original B"
  };
  runtime.setMessage(messageB);
  runtime.runIntervals(100);

  assert.equal(runtime.messageElement.textContent, "original B");
  assert.equal(runtime.messageElement.dataset.cngBlindedRestored, "message-b");
  assert.equal(runtime.messageElement.dataset.cngRestoredText, "original B");
  assert.equal(runtime.messageElement.textContent.includes("original A"), false);
});

test("removes a stale original when the reused blind row has no recoverable text", () => {
  const messageA = {
    key: "message-a",
    time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
    user: "tester",
    status: "BLIND",
    content: BLIND_PLACEHOLDER,
    originalContent: "original A",
    profile: { nickname: "tester" }
  };
  const runtime = createRuntime({
    message: messageA,
    renderedText: BLIND_PLACEHOLDER
  });
  runtime.dispatchSettings({ restoreBlindedMessages: true });
  runtime.flushTimeouts(50);
  assert.equal(runtime.messageElement.textContent, "original A");

  runtime.setMessage({
    ...messageA,
    key: "message-b",
    time: messageA.time + 1000,
    originalContent: ""
  });
  runtime.runIntervals(100);

  assert.equal(runtime.messageElement.textContent, BLIND_PLACEHOLDER);
  assert.equal(runtime.messageElement.dataset.cngBlindedRestored, undefined);
  assert.equal(runtime.messageElement.textContent.includes("original A"), false);
});

test("uses an exact notice element when a legacy message has no status", () => {
  const runtime = createRuntime({
    message: {
      key: "legacy-blind",
      time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
      user: "tester",
      content: BLIND_PLACEHOLDER,
      originalContent: "legacy original",
      profile: { nickname: "tester" }
    },
    renderedText: BLIND_PLACEHOLDER
  });
  runtime.dispatchSettings({ restoreBlindedMessages: true });
  runtime.flushTimeouts(50);

  assert.equal(runtime.messageElement.textContent, "legacy original");
  assert.equal(
    runtime.messageElement.dataset.cngBlindedRestored,
    "legacy-blind"
  );
});

test("does not restore a NORMAL message that quotes a blind notice", () => {
  const runtime = createRuntime({
    message: {
      key: "normal-message",
      time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
      user: "tester",
      status: "NORMAL",
      content: BLIND_PLACEHOLDER,
      originalContent: BLIND_PLACEHOLDER,
      profile: { nickname: "tester" }
    },
    renderedText: BLIND_PLACEHOLDER
  });
  runtime.dispatchSettings({ restoreBlindedMessages: true });
  runtime.flushTimeouts(50);

  assert.equal(runtime.messageElement.textContent, BLIND_PLACEHOLDER);
  assert.equal(runtime.messageElement.dataset.cngBlindedRestored, undefined);
});

test("keeps a restored nickname stable and rechecks a hydrated gradient", () => {
  const runtime = createRuntime({
    nicknameStyle: {
      color: "rgba(255, 255, 255, 0)",
      backgroundImage: "none",
      backgroundClip: "border-box"
    }
  });
  runtime.dispatchSettings({ restoreTransparentNicknames: true });
  runtime.flushTimeouts(50);

  assert.equal(runtime.nickname.classList.contains("cng-restored-nickname"), true);
  assert.equal(runtime.nicknameStyleReads(), 1);
  runtime.runInterval(3000);
  assert.equal(runtime.nicknameStyleReads(), 1);

  runtime.nickname.setAttribute(
    "style",
    "background-image: linear-gradient(red, blue)"
  );
  runtime.setNicknameStyle({
    color: "transparent",
    backgroundImage: "linear-gradient(red, blue)",
    backgroundClip: "text"
  });
  runtime.runInterval(3000);

  assert.equal(runtime.nicknameStyleReads(), 2);
  assert.equal(runtime.nickname.classList.contains("cng-restored-nickname"), false);
});

test("restores a transparent nickname when the profile name is unavailable", () => {
  const runtime = createRuntime({
    message: {
      key: "missing-profile-name",
      time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
      user: "tester",
      status: "NORMAL",
      content: "hello",
      originalContent: "hello",
      profile: {}
    },
    nicknameStyle: {
      color: "rgba(255, 255, 255, 0)",
      backgroundImage: "none",
      backgroundClip: "border-box"
    }
  });
  runtime.dispatchSettings({ restoreTransparentNicknames: true });
  runtime.flushTimeouts(50);

  assert.equal(runtime.nickname.classList.contains("cng-restored-nickname"), true);
});

test("a follow-up scan after extension-owned mutations is idempotent", () => {
  const runtime = createRuntime({
    message: {
      key: "self-mutation",
      time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
      user: "tester",
      status: "BLIND",
      content: BLIND_PLACEHOLDER,
      originalContent: "restored once",
      profile: { nickname: "tester" }
    },
    renderedText: BLIND_PLACEHOLDER
  });
  runtime.dispatchSettings({ restoreBlindedMessages: true });
  runtime.flushTimeouts(50);
  const writesAfterRestore = runtime.messageElement.textWriteCount;
  const classWritesAfterRestore = runtime.messageElement.classWriteCount;
  const datasetWritesAfterRestore = runtime.messageElement.datasetWriteCount;

  runtime.notifyChat([
    {
      addedNodes: [],
      removedNodes: [],
      target: runtime.messageElement,
      type: "attributes"
    }
  ]);
  assert.equal(runtime.pendingTimeouts(50), 1);
  runtime.flushTimeouts(50);

  assert.equal(runtime.messageElement.textContent, "restored once");
  assert.equal(runtime.messageElement.textWriteCount, writesAfterRestore);
  assert.equal(runtime.messageElement.classWriteCount, classWritesAfterRestore);
  assert.equal(
    runtime.messageElement.datasetWriteCount,
    datasetWritesAfterRestore
  );
  assert.equal(runtime.pendingTimeouts(50), 0);
});

test("clears its marker when CleanBot shows the native original", () => {
  const original = "cleanbot original";
  const runtime = createRuntime({
    message: {
      key: "cleanbot-message",
      time: new Date(2026, 7, 29, 12, 0, 0).getTime(),
      user: "tester",
      status: "CBOTBLIND",
      content: BLIND_PLACEHOLDER,
      originalContent: original,
      profile: { nickname: "tester" }
    },
    renderedText: BLIND_PLACEHOLDER
  });
  runtime.dispatchSettings({ restoreBlindedMessages: true });
  runtime.flushTimeouts(50);
  assert.equal(runtime.messageElement.dataset.cngBlindedRestored, "cleanbot-message");

  runtime.messageElement.className = "_text_test";
  runtime.runIntervals(100);

  assert.equal(runtime.messageElement.textContent, original);
  assert.equal(runtime.messageElement.dataset.cngBlindedRestored, undefined);
  assert.equal(runtime.messageElement.classList.contains("cng-restored-message"), false);
});
