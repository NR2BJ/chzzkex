const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rules = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "rules", "chzzk.json"), "utf8")
);

test("blocks both current CHZZK peer-distribution routes", () => {
  const expectedFilters = [
    "||apis.naver.com/livecloud/livecloud/quantum/p2p/",
    "||apis.naver.com/livecloud/livecloud/xray/p2p/"
  ];

  assert.deepEqual(
    rules.map((rule) => rule.id),
    [1, 2]
  );
  assert.deepEqual(
    rules.map((rule) => rule.condition.urlFilter),
    expectedFilters
  );
  for (const rule of rules) {
    assert.equal(rule.priority, 1);
    assert.deepEqual(rule.action, { type: "block" });
    assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest", "other"]);
  }
});
