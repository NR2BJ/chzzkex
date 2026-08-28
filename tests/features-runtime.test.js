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
  const documentListeners = new Map();
  const windowListeners = new Map();
  let nextTimerId = 1;
  let nowMs = 0;
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

    if (trimmed === "*") {
      return true;
    }

    if (trimmed.startsWith("#")) {
      return element.getAttribute("id") === trimmed.slice(1);
    }

    const classAttributeMatch = trimmed.match(/^(\.[\w-]+)(\[.+\])$/);
    if (classAttributeMatch) {
      return (
        matchesSimpleSelector(element, classAttributeMatch[1]) &&
        matchesSimpleSelector(element, classAttributeMatch[2])
      );
    }

    if (trimmed.startsWith(".")) {
      return element.classList.contains(trimmed.slice(1));
    }

    const attributeMatch = trimmed.match(
      /^(?:([a-z]+))?\[([\w-]+)(?:(\*=|\^=|=)('[^']*'|"[^"]*"))?\]$/i
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
      if (operator === "*=") {
        return String(value || "").includes(expected);
      }
      if (operator === "^=") {
        return String(value || "").startsWith(expected);
      }
      return value === expected;
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
      this.style = {
        values: new Map(),
        setProperty: (name, value) => {
          this.style.values.set(name, String(value));
        }
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

    append(...children) {
      for (const child of children) {
        this.appendChild(child);
      }
    }

    contains(candidate) {
      let current = candidate;
      while (current) {
        if (current === this) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
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

    hasAttribute(name) {
      return this.getAttribute(name) !== null;
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

    getBoundingClientRect() {
      return this.bounds || {
        left: 0,
        right: 100,
        top: 0,
        bottom: 20,
        width: 100,
        height: 20
      };
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

    removeAttribute(name) {
      if (name === "class") {
        this._classNames.clear();
      } else if (name.startsWith("data-")) {
        delete this.dataset[dataName(name)];
      } else {
        this.attributes.delete(name);
      }
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

    disconnect() {
      this.target = null;
      this.options = null;
    }
  }

  const document = {
    visibilityState: "visible",
    addEventListener(type, listener) {
      const current = documentListeners.get(type) || [];
      current.push(listener);
      documentListeners.set(type, current);
    },
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
    clearInterval(id) {
      const index = intervals.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        intervals.splice(index, 1);
      }
    },
    console,
    document,
    HTMLElement: FakeHTMLElement,
    HTMLMediaElement: {
      HAVE_METADATA: 1,
      HAVE_CURRENT_DATA: 2
    },
    HTMLVideoElement: FakeHTMLElement,
    location: {
      href: "https://chzzk.naver.com/live/channel",
      pathname: "/live/channel"
    },
    MutationObserver: FakeMutationObserver,
    performance: { now: () => nowMs },
    getComputedStyle(element) {
      if (element === nickname) {
        nicknameStyleReads += 1;
        return currentNicknameStyle;
      }
      return {
        color: "rgb(20, 21, 23)",
        backgroundImage: "none",
        backgroundClip: "border-box",
        display: "block",
        visibility: "visible"
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

  function timeRanges(entries) {
    return {
      length: entries.length,
      start(index) {
        return entries[index][0];
      },
      end(index) {
        return entries[index][1];
      }
    };
  }

  function addPlayer({
    currentTime = 99.5,
    seekable = [[0, 100]],
    buffered = [[0, 100]],
    nativeTimeline = false,
    onLive = false
  } = {}) {
    const player = new FakeHTMLElement("div");
    player.className = `pzp-pc pzp-pc--controls${onLive ? " pzp-pc--onlive" : ""}`;
    const video = new FakeHTMLElement("video");
    video.readyState = 4;
    video.currentTime = currentTime;
    video.currentSrc = "https://example.test/live.m3u8";
    video.src = video.currentSrc;
    video.paused = false;
    video.ended = false;
    video.seekable = timeRanges(seekable);
    video.buffered = timeRanges(buffered);
    video.volume = 1;
    video.muted = false;
    const controls = new FakeHTMLElement("div");
    controls.className = "pzp-pc__bottom-buttons-left";
    player.append(video, controls);

    let nativeSlider = null;
    if (nativeTimeline) {
      nativeSlider = new FakeHTMLElement("div");
      nativeSlider.className = "pzp-pc-progress-slider";
      nativeSlider.setAttribute("role", "slider");
      nativeSlider.bounds = {
        left: 0,
        right: 800,
        top: 0,
        bottom: 14,
        width: 800,
        height: 14
      };
      player.appendChild(nativeSlider);
    }
    document.body.appendChild(player);
    return { controls, nativeSlider, player, video };
  }

  function addSidebarLink() {
    const sidebar = new FakeHTMLElement("aside");
    sidebar.setAttribute("id", "sidebar");
    const link = new FakeHTMLElement("a");
    link.setAttribute(
      "href",
      "/live/0123456789abcdef0123456789abcdef"
    );
    link.setAttribute("title", "테스트 방송");
    link.textContent = "테스트 방송";
    sidebar.appendChild(link);
    document.body.appendChild(sidebar);
    return link;
  }

  function dispatchDocumentEvent(type, event = {}) {
    const payload = {
      button: 0,
      isTrusted: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      stopImmediatePropagation() {
        this.propagationStopped = true;
        this.immediatePropagationStopped = true;
      },
      ...event
    };
    for (const listener of documentListeners.get(type) || []) {
      listener(payload);
      if (payload.immediatePropagationStopped) {
        break;
      }
    }
    return payload;
  }

  function chatObserver() {
    return mutationObservers.find((observer) => observer.target === document.body);
  }

  function currentSidebarObserver() {
    return mutationObservers.find((observer) => observer.target === document);
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
    addPlayer,
    addSidebarLink,
    chatLog,
    chatObserverOptions() {
      const options = chatObserver()?.options;
      return options ? JSON.parse(JSON.stringify(options)) : null;
    },
    dispatchSettings,
    dispatchDocumentEvent,
    document,
    flushTimeouts,
    item,
    intervalCount(delay) {
      return intervals.filter((entry) => entry.delay === delay).length;
    },
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
    setNow(value) {
      nowMs = value;
    },
    sidebarObserver() {
      return currentSidebarObserver();
    },
    setNicknameStyle(style) {
      currentNicknameStyle = style;
    },
    setLocation(pathname) {
      context.location.pathname = pathname;
      context.location.href = `https://chzzk.naver.com${pathname}`;
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

test("restores the fallback timeline when a native slider disappears", () => {
  const runtime = createRuntime();
  const { nativeSlider, player } = runtime.addPlayer({ nativeTimeline: true });
  runtime.dispatchSettings({ timelineAssist: true });

  runtime.runIntervals(250);
  assert.equal(player.querySelector(".cng-timeline-assist"), null);

  nativeSlider.remove();
  runtime.runIntervals(250);
  assert.ok(player.querySelector(".cng-timeline-assist"));
});

test("protects trusted native timeline seeks from initial live synchronization", () => {
  for (const interaction of [
    { type: "pointerdown", event: { button: 0 } },
    { type: "keydown", event: { key: "Home" } }
  ]) {
    const runtime = createRuntime();
    const { nativeSlider, video } = runtime.addPlayer({
      currentTime: 50,
      nativeTimeline: true
    });
    runtime.dispatchSettings({ timelineAssist: true });
    runtime.runIntervals(250);

    runtime.dispatchDocumentEvent(interaction.type, {
      ...interaction.event,
      isTrusted: true,
      target: nativeSlider
    });
    video.currentTime = 40;
    runtime.setNow(1000);
    runtime.runIntervals(250);
    assert.equal(video.currentTime, 40);
  }

  const disabledRuntime = createRuntime();
  const { video } = disabledRuntime.addPlayer({ currentTime: 40 });
  disabledRuntime.dispatchSettings({ timelineAssist: false });
  disabledRuntime.runIntervals(250);
  disabledRuntime.setNow(1000);
  disabledRuntime.runIntervals(250);
  assert.equal(video.currentTime, 40);

  const untrustedRuntime = createRuntime();
  const untrustedPlayer = untrustedRuntime.addPlayer({
    currentTime: 50,
    nativeTimeline: true
  });
  untrustedRuntime.dispatchSettings({ timelineAssist: true });
  untrustedRuntime.runIntervals(250);
  untrustedRuntime.dispatchDocumentEvent("pointerdown", {
    button: 0,
    isTrusted: false,
    target: untrustedPlayer.nativeSlider
  });
  untrustedPlayer.video.currentTime = 40;
  untrustedRuntime.setNow(1000);
  untrustedRuntime.runIntervals(250);
  assert.equal(untrustedPlayer.video.currentTime, 99.75);

  const routeRuntime = createRuntime();
  const routePlayer = routeRuntime.addPlayer({
    currentTime: 50,
    nativeTimeline: true
  });
  routeRuntime.dispatchSettings({ timelineAssist: true });
  routeRuntime.runIntervals(250);
  routeRuntime.dispatchDocumentEvent("pointerdown", {
    button: 0,
    isTrusted: true,
    target: routePlayer.nativeSlider
  });
  routePlayer.video.currentTime = 40;
  routeRuntime.setLocation("/live/channel-b");
  routeRuntime.setNow(100);
  routeRuntime.runIntervals(250);
  routeRuntime.setNow(1000);
  routeRuntime.runIntervals(250);
  assert.equal(routePlayer.video.currentTime, 99.75);
});

test("keeps a native seek made after an SPA URL change before the next tick", () => {
  const runtime = createRuntime();
  const { nativeSlider, video } = runtime.addPlayer({
    currentTime: 50,
    nativeTimeline: true
  });
  runtime.dispatchSettings({ timelineAssist: true });
  runtime.runIntervals(250);

  runtime.setLocation("/live/channel-b");
  runtime.dispatchDocumentEvent("pointerdown", {
    button: 0,
    isTrusted: true,
    target: nativeSlider
  });
  video.currentTime = 40;
  runtime.setNow(100);
  runtime.runIntervals(250);
  runtime.setNow(1000);
  runtime.runIntervals(250);

  assert.equal(video.currentTime, 40);
});

test("treats external seeking and focused-player keys as restore intent", () => {
  const seekingRuntime = createRuntime();
  const seekingPlayer = seekingRuntime.addPlayer({
    currentTime: 50,
    nativeTimeline: true
  });
  seekingRuntime.dispatchSettings({ timelineAssist: true });
  seekingRuntime.setNow(100);
  seekingRuntime.runIntervals(250);
  seekingPlayer.video.currentTime = 40;
  seekingRuntime.dispatchDocumentEvent("seeking", {
    target: seekingPlayer.video
  });
  seekingRuntime.setNow(1000);
  seekingRuntime.runIntervals(250);
  assert.equal(seekingPlayer.video.currentTime, 40);

  for (const { focusedTarget, key } of [
    { focusedTarget: "video", key: "j" },
    { focusedTarget: "player", key: "L" },
    { focusedTarget: "body", key: "l" }
  ]) {
    const runtime = createRuntime();
    const playerState = runtime.addPlayer({
      currentTime: 50,
      nativeTimeline: true
    });
    runtime.dispatchSettings({ timelineAssist: true });
    runtime.setNow(100);
    runtime.runIntervals(250);
    runtime.dispatchDocumentEvent("keydown", {
      isTrusted: true,
      key,
      target:
        focusedTarget === "video"
          ? playerState.video
          : focusedTarget === "player"
            ? playerState.player
            : runtime.document.body
    });
    playerState.video.currentTime = 40;
    runtime.setNow(1000);
    runtime.runIntervals(250);
    assert.equal(playerState.video.currentTime, 40, `${focusedTarget}:${key}`);
  }
});

test("does not treat the initial LIVE synchronization write as user seeking", () => {
  const runtime = createRuntime();
  const { controls, video } = runtime.addPlayer({
    currentTime: 50,
    nativeTimeline: true,
    onLive: true
  });
  runtime.dispatchSettings({ timelineAssist: true, videoLatency: true });
  runtime.setNow(100);
  runtime.runIntervals(250);
  runtime.setNow(1000);
  runtime.runIntervals(250);
  assert.equal(video.currentTime, 99.75);

  runtime.dispatchDocumentEvent("seeking", { target: video });
  runtime.runIntervals(500);
  const status = controls.querySelector(".cng-video-latency");
  assert.ok(status);
  assert.match(status.textContent, /지연 0\.3초/);
  assert.doesNotMatch(status.textContent, /LIVE까지/);
});

test("cancels a custom timeline drag without a final seek", () => {
  const runtime = createRuntime();
  const { player, video } = runtime.addPlayer({ currentTime: 99.5 });
  runtime.dispatchSettings({ timelineAssist: true });
  runtime.runIntervals(250);
  const slider = player.querySelector(".cng-timeline-assist");
  assert.ok(slider);

  runtime.dispatchDocumentEvent("pointerdown", {
    button: 0,
    clientX: 25,
    isTrusted: true,
    pointerId: 7,
    target: slider
  });
  const positionAfterPointerDown = video.currentTime;
  runtime.dispatchDocumentEvent("pointercancel", {
    clientX: 90,
    isTrusted: true,
    pointerId: 7,
    target: slider
  });
  assert.equal(video.currentTime, positionAfterPointerDown);

  runtime.dispatchDocumentEvent("pointerdown", {
    button: 0,
    clientX: 30,
    isTrusted: true,
    pointerId: 8,
    target: slider
  });
  const positionBeforeDisable = video.currentTime;
  runtime.dispatchSettings({ timelineAssist: false });
  runtime.dispatchDocumentEvent("pointermove", {
    clientX: 80,
    isTrusted: true,
    pointerId: 8,
    target: slider
  });
  assert.equal(video.currentTime, positionBeforeDisable);
  assert.equal(player.querySelector(".cng-timeline-assist"), null);
});

test("keeps a sidebar preview alive across a quick same-link re-entry", () => {
  const runtime = createRuntime();
  const link = runtime.addSidebarLink();
  runtime.dispatchSettings({ sidebarPreview: true });
  assert.ok(runtime.sidebarObserver());

  runtime.dispatchDocumentEvent("pointerover", { target: link });
  runtime.dispatchDocumentEvent("pointerout", {
    clientX: 0,
    clientY: 0,
    relatedTarget: null,
    target: link
  });
  assert.equal(runtime.pendingTimeouts(120), 1);
  runtime.dispatchDocumentEvent("pointerover", { target: link });
  assert.equal(runtime.pendingTimeouts(120), 0);

  runtime.dispatchSettings({ sidebarPreview: false });
  assert.equal(runtime.sidebarObserver(), undefined);
  const disabledPointerOut = runtime.dispatchDocumentEvent("pointerout", {
    relatedTarget: null,
    target: link
  });
  assert.equal(disabledPointerOut.propagationStopped, undefined);
});

test("shows LIVE distance and only the contiguous buffered time ahead", () => {
  const runtime = createRuntime();
  const { controls } = runtime.addPlayer({
    currentTime: 60,
    seekable: [[0, 100]],
    buffered: [
      [0, 62],
      [70, 90]
    ]
  });
  runtime.dispatchSettings({ timelineAssist: false, videoLatency: true });
  runtime.runIntervals(500);

  const status = controls.querySelector(".cng-video-latency");
  assert.ok(status);
  assert.match(status.textContent, /LIVE까지 40\.0초/);
  assert.match(status.textContent, /미리 받음 2\.0초/);
});

test("skips chat DOM work while every chat option is disabled", () => {
  const runtime = createRuntime();
  const baseHundredMsIntervals = runtime.intervalCount(100);

  assert.equal(runtime.queryCount("[role='log']"), 0);
  assert.equal(runtime.chatObserverOptions(), null);
  assert.equal(runtime.intervalCount(3000), 0);
  const queriesBeforeVerifier = runtime.totalDocumentQueryCount();
  runtime.runIntervals(100);
  assert.equal(runtime.totalDocumentQueryCount(), queriesBeforeVerifier);

  runtime.dispatchSettings({ chatTimestamp: true });
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
      "aria-posinset",
      "role"
    ]
  });
  assert.equal(runtime.intervalCount(3000), 1);
  assert.equal(runtime.intervalCount(100), baseHundredMsIntervals + 1);
  assert.equal(runtime.pendingTimeouts(50), 1);
  runtime.flushTimeouts(50);
  assert.ok(runtime.timestamp());

  runtime.dispatchSettings({ chatTimestamp: false });
  assert.equal(runtime.chatObserverOptions(), null);
  assert.equal(runtime.intervalCount(3000), 0);
  assert.equal(runtime.intervalCount(100), baseHundredMsIntervals);

  runtime.dispatchSettings({ restoreTransparentNicknames: true });
  assert.ok(runtime.chatObserverOptions());
  assert.equal(runtime.intervalCount(3000), 1);
  assert.equal(runtime.intervalCount(100), baseHundredMsIntervals + 1);
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
  assert.equal(runtime.chatObserverOptions(), null);
  assert.equal(runtime.intervalCount(3000), 0);
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
