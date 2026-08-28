const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "features.css"),
  "utf8"
);

test("uses the current theme token for restored chat text", () => {
  const nicknameRule = css.match(/\.cng-restored-nickname\s*\{([^}]+)\}/)?.[1] || "";
  const messageRule =
    css.match(
      /\[data-cng-restored-text\]\.cng-restored-message\s*\{([^}]+)\}/
    )?.[1] || "";

  assert.match(nicknameRule, /--sem-color-content-neutral-cool-stronger/);
  assert.match(messageRule, /--sem-color-content-neutral-cool-stronger/);
  assert.match(messageRule, /-webkit-text-fill-color/);
});

test("gives restored blind text enough specificity to beat the native hidden rule", () => {
  assert.match(
    css,
    /\[role="log"\]\s+\[data-cng-blinded-restored\]\[data-cng-blind-placeholder\]\[data-cng-restored-text\]\.cng-restored-message/
  );
});
