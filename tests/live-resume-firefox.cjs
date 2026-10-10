const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chzzk-firefox-resume-"));
  const driver = spawn(process.env.GECKODRIVER || "geckodriver", ["--port", "4457", "--profile-root", root, "--allow-system-access"],
    { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(driver, "exit");
  let log = "";
  driver.stdout.on("data", (chunk) => { log += chunk; });
  driver.stderr.on("data", (chunk) => { log += chunk; });
  let id;
  const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`http://127.0.0.1:4457${route}`, {
      method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)
    });
    const result = await response.json();
    if (result.value?.error) throw new Error(JSON.stringify(result.value));
    return result.value;
  };
  const execute = (script, args = [], async = false) => request(`/session/${id}/execute/${async ? "async" : "sync"}`, { script, args });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    for (let i = 0; i < 50; i++) {
      try { await request("/status"); break; } catch { await pause(200); }
    }
    const session = await request("/session", { capabilities: { alwaysMatch: {
      browserName: "firefox", "moz:firefoxOptions": {
        binary: process.env.FIREFOX_BINARY || "/Applications/Firefox.app/Contents/MacOS/firefox", args: ["-headless"]
      }
    } } });
    id = session.sessionId;
    console.log("Firefox", session.capabilities.browserVersion);
    const { version } = require("../manifest.json");
    await request(`/session/${id}/moz/addon/install`, {
      path: process.env.TEST_XPI || path.resolve(__dirname, `../dist/chzzk-ex-firefox-v${version}.xpi`), temporary: true
    });
    await request(`/session/${id}/moz/context`, { context: "chrome" });
    const uuids = JSON.parse(await execute('return Services.prefs.getStringPref("extensions.webextensions.uuids");'));
    await request(`/session/${id}/moz/context`, { context: "content" });
    await request(`/session/${id}/url`, { url: `moz-extension://${uuids["chzzkex@example.local"]}/popup/popup.html` });
    const popup = await request(`/session/${id}/window`);
    const channelId = process.env.TEST_CHANNEL || "a7e175625fdea5a7d98428302b7aa57f";
    const live = await execute(`const [channelId, done] = arguments;
      browser.storage.local.set({autoResumeLive:false}).then(async()=>{
        const p=await (await fetch('https://api.chzzk.naver.com/service/v3.3/channels/'+channelId+'/live-detail?dt=PC&tm=false',
          {cache:'no-store',signal:AbortSignal.timeout(10000)})).json();
        const tab=await browser.tabs.create({url:'https://chzzk.naver.com/live/'+channelId,active:false});
        done({tabId:tab.id,status:p.content?.status,liveId:String(p.content?.liveId)});
      }).catch(e=>done({error:String(e)}));`, [channelId], true);
    assert.equal(live.status, "OPEN", "시험 채널이 방송 중이어야 한다");
    await pause(12000);
    const handles = await request(`/session/${id}/window/handles`);
    const liveWindow = handles.find((handle) => handle !== popup);
    await request(`/session/${id}/window`, { handle: liveWindow });
    await execute(`window.stop(); document.querySelectorAll('video').forEach(v=>v.pause());
      document.body.innerHTML='<div class="_player_test"><strong>라이브 종료</strong><p>다음 방송에서 만나요!</p></div>';
      window.__resumeFixture=true;`);
    await request(`/session/${id}/window`, { handle: popup });
    const before = await execute(`const [tabId,channelId,liveId,done]=arguments;
      browser.storage.session.set({['live-watch:'+tabId]:{channelId,status:'OPEN',liveId}}).then(async()=>{
        const page=await browser.tabs.sendMessage(tabId,{type:'live-page-state'}).catch(()=>null);
        await browser.storage.local.set({autoResumeLive:true});
        await browser.alarms.create('chzzk-ex-live-check',{when:Date.now()+100,periodInMinutes:1});done(page??null);
      }).catch(e=>done({error:String(e)}));`, [live.tabId, channelId, live.liveId], true);
    console.log("종료 화면 확인", before);
    await pause(16000);
    const state = await execute(`const [tabId,done]=arguments;
      Promise.all([browser.storage.session.get('live-watch:'+tabId),browser.tabs.get(tabId)]).then(([state,tab])=>
        done({state:state['live-watch:'+tabId],active:tab.active,muted:tab.mutedInfo.muted}));`, [live.tabId], true);
    await request(`/session/${id}/window`, { handle: liveWindow });
    const page = await execute(`return {fixture:window.__resumeFixture===true,video:Array.from(document.querySelectorAll('video')).map(v=>
      ({paused:v.paused,muted:v.muted,time:v.currentTime,readyState:v.readyState}))};`);
    console.log(JSON.stringify({ state, page }));
    if (process.env.EXPECT_NO_RECOVERY === "1") {
      assert.equal(page.fixture, true);
      assert.equal(state.state.resumedLiveId, undefined);
    } else {
      assert.equal(before.ended, true);
      assert.equal(state.active, false);
      assert.equal(page.fixture, false);
      assert.equal(state.state.resumedLiveId, live.liveId);
      assert.equal(state.state.resumeAttempts, 1);
      assert.ok(page.video.some((video) => video.muted && !video.paused && video.time > 0.1), "음소거 실제 영상 재생 확인");
    }
  } catch (error) {
    console.error(log.slice(-1800));
    throw error;
  } finally {
    if (id) await request(`/session/${id}`, undefined, "DELETE").catch(() => {});
    driver.kill("SIGTERM"); await exited;
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
