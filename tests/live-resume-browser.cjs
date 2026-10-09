const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "chzzk-ex-resume-"));
  let context;
  let browser;
  let processHandle;
  let exited;
  try {
    const extension = path.join(temporary, "extension");
    await fs.mkdir(extension);
    const { version } = require("../manifest.json");
    execFileSync("unzip", ["-q", path.resolve(__dirname, `../dist/chzzk-ex-chrome-v${version}.zip`), "-d", extension]);
    const profile = path.join(temporary, "profile");
    processHandle = spawn(chromium.executablePath(), [
      `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
      `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank"
    ], { stdio: "ignore" });
    exited = once(processHandle, "exit");
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(port, "시험 브라우저 시작 실패");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    context = browser.contexts()[0];
    const worker = context.serviceWorkers().find((item) => item.url().endsWith("/src/background.js")) ||
      await context.waitForEvent("serviceworker", { predicate: (item) => item.url().endsWith("/src/background.js") });
    console.log("시험 확장", worker.url());
    if (process.env.CHECK_LIVE_API === "1") {
      const actual = await worker.evaluate(async () => {
        const channelId = "a7e175625fdea5a7d98428302b7aa57f";
        const response = await fetch(`https://api.chzzk.naver.com/service/v3.3/channels/${channelId}/live-detail?dt=PC&tm=false`,
          { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10000) });
        const payload = await response.json();
        return { http: response.status, code: payload.code, status: payload.content?.status, liveId: payload.content?.liveId };
      });
      console.log("실제 확장 환경의 치지직 응답", actual);
      assert.equal(actual.code, 200);
    }
    await worker.evaluate(() => {
      globalThis.testStatus = "CLOSE";
      const nativeFetch = fetch;
      globalThis.fetch = (url, options) => String(url).startsWith("https://api.chzzk.naver.com/")
        ? Promise.resolve(new Response(JSON.stringify({ code: 200, content: { status: globalThis.testStatus, liveId: 123 } }), { status: 200 }))
        : nativeFetch(url, options);
    });
    let live = false;
    let loads = 0;
    await context.route("https://chzzk.naver.com/live/streamer", async (route) => {
      loads++;
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <h1>${live ? "방송 중" : "다음 라이브를 기다리는 중"}</h1>
        <button onclick="this.dataset.claimed='yes'">통나무 파워 받기</button>
        ${live ? `<video width="640" height="360"></video><script>
          const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=360;
          const painter=canvas.getContext('2d');
          setInterval(()=>{painter.fillStyle='green';painter.fillRect(0,0,640,360);painter.fillStyle='white';painter.fillText(Date.now(),20,20)},200);
          document.querySelector('video').srcObject=canvas.captureStream(5);
        </script>` : ""}
      </body></html>` });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log("페이지 오류", error.message));
    await page.goto("https://chzzk.naver.com/live/streamer");
    await worker.evaluate(() => chrome.alarms.create("chzzk-ex-live-check", { when: Date.now() + 100 }));
    await page.waitForTimeout(2000);
    const initial = await worker.evaluate(() => chrome.storage.session.get(null));
    assert.ok(Object.values(initial).some((state) => state.status === "CLOSE"));
    const front = await context.newPage();
    await front.goto("about:blank");
    await front.bringToFront();
    assert.equal(await page.evaluate(() => document.hidden), true);
    live = true;
    await worker.evaluate((delay) => {
      globalThis.testStatus = "OPEN";
      return chrome.alarms.create("chzzk-ex-live-check", { when: Date.now() + delay, periodInMinutes: 1 });
    }, Number(process.env.CHECK_DELAY_MS) || 60000);
    console.log(`종료 상태 확인. 다른 탭을 앞에 두고 ${(Number(process.env.CHECK_DELAY_MS) || 60000) / 1000}초 알람 대기.`);
    await page.waitForFunction(() => {
      const video = document.querySelector("video");
      return video && !video.paused && video.currentTime > 0.2 && video.muted;
    }, null, { timeout: 80000, polling: 500 });
    await page.waitForTimeout(1500);
    const playback = await page.evaluate(() => {
      const video = document.querySelector("video");
      return { hidden: document.hidden, muted: video.muted, paused: video.paused, time: video.currentTime,
        claimed: document.querySelector("button").dataset.claimed,
        button: document.querySelector("button").outerHTML, features: window.__CHZZK_EX_FEATURES__ };
    });
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: "https://chzzk.naver.com/live/*" }));
    console.log(JSON.stringify({ loads, playback, active: tabs[0].active, temporaryTabMute: tabs[0].mutedInfo.muted }));
    assert.equal(playback.hidden, true);
    assert.equal(playback.muted, true);
    assert.equal(playback.paused, false);
    assert.equal(tabs[0].active, false);
    assert.equal(tabs[0].mutedInfo.muted, false);
    assert.equal(loads, 2);
    await worker.evaluate(() => chrome.alarms.create("chzzk-ex-live-check", { when: Date.now() + 100 }));
    try {
      await page.waitForFunction(() => document.querySelector("button").dataset.claimed === "yes", null,
        { timeout: 10000, polling: 500 });
    } catch (error) {
      console.log("수령 버튼 상태", await page.locator("button").evaluate((button) => button.outerHTML));
      throw error;
    }
    assert.equal(loads, 2);
    console.log("숨겨진 탭의 수령 버튼 클릭 확인. 추가 확인에서도 중복 새로고침 없음.");
  } finally {
    await browser?.close();
    if (processHandle) {
      processHandle.kill("SIGTERM");
      await exited;
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
