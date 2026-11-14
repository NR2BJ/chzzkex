const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/firefox-clip-editor.js"), "utf8");
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0";
const editor = "https://chzzk.naver.com/clip-editor?contentType=live&contentId=123&offsetTime=0";

function run(url, userAgent) {
  const navigator = Object.create({ userAgent });
  vm.runInNewContext(source, { location: new URL(url), navigator });
  return navigator;
}

test("desktop Firefox editor keeps Gecko and does not claim a different engine", () => {
  assert.equal(run(editor, ua).userAgent, ua.replace(" Firefox/158.0", ""));
});

test("does not change live pages, other origins, mobile or other browsers", () => {
  for (const [url, agent] of [
    [editor.replace("/clip-editor", "/live/channel"), ua],
    [editor.replace("chzzk.naver.com", "example.org"), ua],
    [editor, ua.replace("Macintosh", "Android")],
    [editor, ua.replace("Firefox/158.0", "Chrome/130.0")]
  ]) assert.equal(Object.hasOwn(run(url, agent), "userAgent"), false);
});
