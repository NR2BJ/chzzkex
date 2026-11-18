// Run with GECKODRIVER and FFMPEG on PATH (or set GECKODRIVER to its full path).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chzzk-rewind-"));
const source = path.resolve(__dirname, "../src");
let driver, server, session, endpoint;
async function request(url, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(endpoint + url, { method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const { value } = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
const evaluate = script => request("/session/" + session + "/execute/sync", { script, args: [] });
async function wait(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw Error("시간 초과");
}
async function run() {
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const encode = ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=4",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000", "-c:a", "aac", "-b:a", "32k",
    "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-g", "16", "-sc_threshold", "0"];
  execFileSync(ffmpeg, [...encode, "-t", "1080", "-f", "hls", "-hls_time", "4", "-hls_list_size", "0", "-hls_segment_type", "fmp4", "fixture.m3u8"], { cwd: tmp });
  execFileSync(ffmpeg, [...encode.map(s => s.startsWith("testsrc2=") ? "color=black:size=96x64:rate=4" : s), "-t", "90", "-movflags", "+faststart", "native.mp4"], { cwd: tmp });
  let index = 0;
  const startMs = Date.now() - 1080 * 1000;
  const playlist = fs.readFileSync(path.join(tmp, "fixture.m3u8"), "utf8").replace(/#EXTINF:[^\n]+\n[^\n]+/g, segment => {
    const seconds = 4 * index++;
    return seconds >= 540 && seconds < 600 ? "" :
      "#EXT-X-PROGRAM-DATE-TIME:" + new Date(startMs + seconds * 1000).toISOString() + "\n" + segment;
  });
  assert.equal(index, 270);
  let freshWindowOnly = false, denySegments = false;
  const tail = playlist.slice(0, playlist.indexOf("#EXT-X-PROGRAM-DATE-TIME:")) +
    playlist.slice(playlist.lastIndexOf("#EXT-X-PROGRAM-DATE-TIME:", playlist.indexOf("fixture249.m4s")));
  const scripts = ["hls.min.js", "settings.js", "feature-core.js", "features.js"];
  const html = `<link rel="stylesheet" href="/features.css"><style>
    .surface{position:absolute;inset:0}.surface video{width:100%;height:100%}
    .pzp-pc__bottom-buttons{position:absolute;bottom:0;z-index:3;width:100%;display:flex;justify-content:space-between}
    .pzp-pc__bottom-buttons-left,.pzp-pc__bottom-buttons-right{display:flex;align-items:center}
    .pzp-pc--filter #native{filter:contrast(1.4)}
    .pzp-pc:not(.pzp-pc--controls) .pzp-pc__bottom-buttons{visibility:hidden}
    </style><div class="pzp-pc pzp-pc--controls" style="position:relative;height:360px;width:720px">
    <div class="surface pzp-pc__video"><video id="native" muted autoplay loop src="/native.mp4"></video></div><div class="pzp-pc__poster"></div>
    <div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left">
    <button class="pzp-pc__playback-switch" onclick="native.paused?native.play():native.pause()">P</button>
    <div class="pzp-pc__volume-control"><button id="mute" onclick="native.muted=!native.muted">M</button><input id="level" type="range" min="0" max="1" step=".1" oninput="native.volume=this.value"></div>
    <button class="live_time">실시간</button></div><div class="pzp-pc__bottom-buttons-right">
    <button class="custom__clip-button">C</button><button id="sharp" onclick="this.closest('.pzp-pc').classList.toggle('pzp-pc--filter')">S</button>
    <button id="wide" onclick="this.closest('.pzp-pc').style.width='800px'">W</button>
    <button id="full" onclick="this.closest('.pzp-pc').requestFullscreen()">F</button></div></div></div>
    <script>const nativeFetch = window.fetch.bind(window);
    window.fetch = (url, options) => String(url).includes("live-playback-json-meta") ?
      Promise.resolve(Response.json({code:200,content:{playbackJson:{meta:{liveId:"fixture"},live:{timeMachine:false},media:[{protocol:"HLS",path:location.origin+"/fixture.m3u8"}]}}})) : nativeFetch(url, options);
    </script>` + scripts.map(s => '<script src="/'+s+'"></script>').join("") +
    '<script>postMessage({source:"chzzk-ex",type:"settings",settings:{timelineAssist:true,timeMachine:true,watchTimer:true,videoLatency:true,normalizeVolume:true}},"*")</script>';
  server = http.createServer((req, res) => {
    const name = req.url.slice(1);
    if (name === "live/fixture") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.end(html); }
    if (name === "fixture.m3u8") return res.end(freshWindowOnly ? tail : playlist);
    if (denySegments && name.endsWith(".m4s")) {res.writeHead(410); return res.end();}
    const file = scripts.includes(name) || name === "features.css" ? path.join(source, name) :
      /^(native\.mp4|init\.mp4|fixture\d+\.m4s)$/.test(name) ? path.join(tmp,name) : null;
    if (!file || !fs.existsSync(file)) {res.writeHead(404); return res.end();}
    const data = name === "features.js"
      ? Buffer.from(fs.readFileSync(file, "utf8").replace("const loudness = {", "const loudness = window.testAudio = {"))
      : fs.readFileSync(file);
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const headers = {"Content-Type":name.endsWith(".css")?"text/css":name.endsWith(".js")?"text/javascript":"video/mp4","Accept-Ranges":"bytes","Cache-Control":"no-store"};
    if (m) {
      const a=+m[1], b=m[2]?Math.min(+m[2],data.length-1):data.length-1;
      res.writeHead(206,{...headers,"Content-Range":`bytes ${a}-${b}/${data.length}`});return res.end(data.subarray(a,b+1));
    }
    res.writeHead(200,headers);res.end(data);
  }).listen(0,"127.0.0.1");
  await once(server,"listening");
  driver = spawn(process.env.GECKODRIVER || "geckodriver", ["--port","0","--profile-root",tmp], {stdio:["ignore","pipe","inherit"]});
  await Promise.race([new Promise(resolve => driver.stdout.on("data", chunk => {
    const match = /Listening on (127\.0\.0\.1:\d+)/.exec(chunk);
    if (match) {endpoint="http://"+match[1];resolve();}
  })), once(driver,"exit").then(()=>{throw Error("geckodriver 종료");})]);
  const cap=await request("/session",{capabilities:{alwaysMatch:{browserName:"firefox","moz:firefoxOptions":{binary:process.env.FIREFOX_BINARY,args:["-headless"],prefs:{"media.autoplay.default":0}}}}});
  session=cap.sessionId;
  await request("/session/"+session+"/url",{url:"http://127.0.0.1:"+server.address().port+"/live/fixture"});
  const state=()=>evaluate(`const v=document.querySelector(".cng-tm-video"),t=document.querySelector("[aria-label][role=slider]");
    return {max:-Number(t?.getAttribute("aria-valuemin")),behind:-Number(t?.getAttribute("aria-valuenow")),pos:v?.currentTime??null,ready:v?.readyState,paused:v?.paused,native:document.querySelector("#native")?.currentTime,status:document.querySelector(".cng-tm-status")?.textContent,overlayCount:Number(document.body.dataset.overlays)};`);
  await wait(async()=>(await state()).max===1080);
  freshWindowOnly = true;
  await request("/session/"+session+"/refresh",{});
  await wait(async()=>(await state()).max===1080);
  await evaluate('document.body.dataset.overlays=0;new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.matches?.(".cng-tm-overlay"))document.body.dataset.overlays=Number(document.body.dataset.overlays)+1;}).observe(document.body,{childList:true,subtree:true});');
  async function mouse(type,behind) {
    const {x,y}=await evaluate('const r=document.querySelector(".cng-timeline-assist__track").getBoundingClientRect();return {x:Math.round(r.right-r.width*'+behind+'/1080),y:Math.round(r.y+r.height/2)};');
    if(type==="click"||type==="down") await wait(()=>evaluate('return !!document.elementFromPoint('+x+','+y+')?.closest(".cng-timeline-assist__track")'));
    const actions=[{type:"pointerMove",x,y,duration:0}];
    if (type==="click"||type==="down") actions.push({type:"pointerDown",button:0});
    if (type==="click"||type==="up") actions.push({type:"pointerUp",button:0});
    await request("/session/"+session+"/actions",{actions:[{type:"pointer",id:"mouse",parameters:{pointerType:"mouse"},actions}]});
  }
  async function playing(behind, count) {
    try {
      const initial = await wait(async()=>{const s=await state();return s.max===1080&&s.ready>=2&&s.pos>0&&!s.paused&&Math.abs(s.behind-behind)<4&&s;});
      assert.ok(Math.abs(initial.pos - (1080 - behind - (behind <= 480 ? 600 : 0))) < 4, "실제 영상 위치 "+initial.pos);
      await wait(async()=>{const s=await state();return s.pos>initial.pos+0.35&&Math.abs(s.behind-behind)<5;});
      assert.equal((await state()).overlayCount,count);
    } catch(e){throw Error("재생 실패 -"+behind+": "+JSON.stringify(await state()),{cause:e});}
  }
  await mouse("click",180);await playing(180,1);
  const frame = Buffer.from(await request("/session/"+session+"/screenshot"), "base64");
  const rgb = execFileSync(ffmpeg, ["-loglevel","error","-i","pipe:0","-vf","crop=240:120:200:85,scale=24:12","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"], {input:frame});
  assert.ok(rgb.some((v,i)=>i%3===0 && Math.max(v,rgb[i+1],rgb[i+2])-Math.min(v,rgb[i+1],rgb[i+2])>60),"검은 기본 영상 위에 과거 영상의 색이 보여야 한다");
  await evaluate('document.querySelector(".pzp-pc").className="pzp-pc";');
  await wait(()=>evaluate('return [".cng-tm-speed",".cng-timeline-assist"].every(s=>getComputedStyle(document.querySelector(s)).visibility==="hidden")'));
  assert.equal(await evaluate('return getComputedStyle(document.querySelector(".custom__clip-button")).display'),"none");
  await evaluate('document.querySelector(".pzp-pc").classList.add("pzp-pc--controls")');
  await mouse("click",120);await playing(120,1);
  assert.equal(await evaluate('return getComputedStyle(document.querySelector(".custom__clip-button")).display'),"none");
  await mouse("click",240);await playing(240,1);
  await mouse("click",660);await playing(660,2);
  await mouse("click",510);assert.equal((await state()).overlayCount,2);
  assert.ok((await state()).behind>650,"빈 구간 클릭은 현재 영상을 유지한다");
  await mouse("click",542);
  await wait(async()=> (await state()).status === "이어서 재생할 구간이 없습니다");
  assert.equal((await state()).overlayCount,2,"빈 구간 앞에서 플레이어를 반복 생성하지 않는다");
  await mouse("click",660);await playing(660,2);
  await mouse("down",600);
  await evaluate('document.querySelector(".pzp-pc").classList.remove("pzp-pc--controls")');
  await pause(250);
  assert.equal(await evaluate('return getComputedStyle(document.querySelector(".cng-timeline-assist")).visibility'),"visible");
  await mouse("move",240);await mouse("move",30);
  assert.equal((await state()).overlayCount,2);
  await mouse("up",300);await playing(300,3);
  await evaluate('document.querySelector(".pzp-pc").classList.add("pzp-pc--controls")');
  await mouse("click",30);
  await wait(async()=>{const s=await state();return s.pos===null&&Math.abs(s.native-60)<4&&s.max===1080;});
  const setAssist = enabled => evaluate('postMessage({source:"chzzk-ex",type:"settings",settings:{timelineAssist:'+enabled+'}},"*")');
  await setAssist(false);
  await wait(()=>evaluate('return !document.querySelector(".cng-timeline-assist") && !!document.querySelector(".cng-tm-toggle")'));
  await evaluate('document.querySelector(".pzp-pc").classList.remove("pzp-pc--controls");document.querySelector(".cng-tm-toggle").click()');
  await wait(async()=>(await state()).max===1080);
  assert.equal(await evaluate('return getComputedStyle(document.querySelector(".cng-timeline-assist")).visibility'), "visible");
  await mouse("click",180);await playing(180,4);
  await evaluate('document.querySelector(".pzp-pc").classList.add("pzp-pc--controls")');
  const click = async selector => {
    const control=await request("/session/"+session+"/element",{using:"css selector",value:selector});
    return request("/session/"+session+"/element/"+Object.values(control)[0]+"/click",{});
  };
  await wait(()=>evaluate('return !!document.querySelector(".pzp-pc__bottom-buttons-right .cng-tm-speed") && !document.querySelector(".cng-tm-play")'));
  assert.equal(await evaluate('return !!document.querySelector(".cng-watch-timer") && document.querySelector(".cng-video-latency").textContent.includes("음량")'),true);
  await click("#wide");
  assert.equal(await evaluate('return document.querySelector(".cng-tm-video").clientWidth'),800);
  await click("#sharp");
  await wait(()=>evaluate('return getComputedStyle(document.querySelector(".cng-tm-video")).filter===getComputedStyle(native).filter && getComputedStyle(native).filter!=="none"'));
  await click("#full");
  await wait(()=>evaluate('return document.fullscreenElement?.contains(document.querySelector(".cng-tm-video"))'));
  await evaluate('document.exitFullscreen()');
  await click(".pzp-pc__playback-switch");
  await wait(()=>evaluate('return document.querySelector(".cng-tm-video").paused'));
  await pause(350);
  const time=await evaluate('return document.querySelector(".cng-watch-timer").textContent');
  await pause(1100);
  assert.equal(await evaluate('return document.querySelector(".cng-watch-timer").textContent'),time);
  await click(".pzp-pc__playback-switch");
  await click("#mute");
  await evaluate('const s=document.querySelector("#level");s.value=".4";s.dispatchEvent(new Event("input"))');
  await wait(()=>evaluate('const v=document.querySelector(".cng-tm-video");return !v.paused && !v.muted && Math.abs(v.volume-.4)<.01'));
  await evaluate('const s=document.querySelector(".cng-tm-speed");s.value="1.5";s.dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('return document.querySelector(".cng-tm-video").playbackRate'),1.5);
  const effects = (normalizeVolume,compressAudio) => evaluate(
    'postMessage({source:"chzzk-ex",type:"settings",settings:'+JSON.stringify({normalizeVolume,compressAudio})+'},"*")');
  async function hasAudio(selector) {
    return evaluate('const a=window.testAudio; if(!a.graph || a.video!==document.querySelector('+JSON.stringify(selector)+'))return false;'+
      'if(window.tapOwner!==a.graph){window.tapOwner=a.graph;window.tap=a.context.createAnalyser();a.graph.limiterTrim.connect(window.tap);}'+
      'const samples=new Float32Array(window.tap.fftSize);window.tap.getFloatTimeDomainData(samples);return samples.some(x=>Math.abs(x)>0.001);');
  }
  await effects(true,true);
  await wait(()=>hasAudio(".cng-tm-video"));
  await wait(()=>evaluate('return testAudio.activeBlockCount>=3 && testAudio.compressor.ratio.value>1.5'));
  await setAssist(true);await setAssist(false);
  await mouse("down",600);await mouse("move",300);await mouse("up",660);
  await wait(async()=>{const s=await state();return s.ready>=2&&Math.abs(s.behind-660)<5&&s.overlayCount===5});
  await wait(()=>hasAudio(".cng-tm-video"));
  await evaluate('document.querySelector(".cng-timeline-assist__live").click()');
  await wait(()=>evaluate('return !document.querySelector(".cng-tm-overlay, .cng-timeline-assist") && document.querySelector("#native").currentTime>85'));
  await wait(()=>hasAudio("#native"));
  assert.equal(await evaluate('return !native.muted && Math.abs(native.volume-.4)<.01 && getComputedStyle(document.querySelector(".custom__clip-button")).display!=="none" && !document.querySelector(".cng-tm-bar")'),true);
  await effects(false,false);
  await wait(()=>evaluate('return testAudio.compressor.ratio.value<1.01 && testAudio.limiter.ratio.value<1.01'));
  await wait(()=>hasAudio("#native"));
  await evaluate('testAudio.parkLiveAudio=()=>null');
  await setAssist(true);
  await wait(async()=>(await state()).max===1080);
  await mouse("click",180);
  await wait(()=>evaluate('return !!document.querySelector(".pzp-pc__bottom-buttons-left .cng-tm-play") && document.querySelector(".cng-tm-video").readyState>=2'));
  assert.equal(await evaluate('return native.muted && getComputedStyle(document.querySelector(".pzp-pc__playback-switch")).display==="none" && getComputedStyle(document.querySelector("#wide")).display!=="none"'),true);
  await click(".cng-tm-play");
  await wait(()=>evaluate('return document.querySelector(".cng-tm-video").paused'));
  await evaluate('window.liveClicks=[];for(const e of ["pointerdown","pointerup","click"]){window.addEventListener(e,x=>window.liveClicks.push([e,x.target.className]),true)}');
  const fallbackAudio = () => evaluate('const v=document.querySelector(".cng-tm-video"),b=document.querySelector(".cng-timeline-assist__live").getBoundingClientRect();return {native:native.muted, past:v?.muted,bar:!!document.querySelector(".cng-tm-bar"),hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.className, clicks:window.liveClicks}');
  const beforeReturn = await fallbackAudio();
  await click(".cng-timeline-assist__live");
  try {
    await wait(()=>evaluate('return !document.querySelector(".cng-tm-bar") && !native.muted'));
  } catch (e) {
    throw Error("대체 조작 종료 전후: "+JSON.stringify([beforeReturn,await fallbackAudio()]),{cause:e});
  }
  const beforeSnap = (await state()).overlayCount;
  await evaluate('native.addEventListener("seeking",()=>{native.currentTime=88},{once:true})');
  await mouse("click",60);
  await playing(60,beforeSnap+1);
  await click(".cng-timeline-assist__live");
  denySegments=true;
  await mouse("click",800);
  try {
    await wait(async()=>/이 구간을|과거 영상을/.test((await state()).status||""));
  } catch(e) { throw Error("만료된 영상 응답: "+JSON.stringify(await state()),{cause:e}); }
  await click(".cng-timeline-assist__live");
  await wait(()=>evaluate('return !document.querySelector(".cng-tm-overlay")'));
  console.log("Firefox "+cap.capabilities.browserVersion+": 새로고침 뒤 과거 영상 표시, 가위·배속 숨김, 드래그, 구간 만료 안내, 기본 조작 및 음량 복귀 확인");
}
(async()=>{try{await run();}finally{
  if(session)await request("/session/"+session,undefined,"DELETE").catch(()=>{});
  if(driver&&driver.exitCode===null){const done=once(driver,"exit");driver.kill();await done;}
  if(server)server.close();
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}})().catch(error=>{console.error(error);process.exitCode=1});
