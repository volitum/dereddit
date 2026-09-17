const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const popup = readFileSync(
  join(__dirname, "..", "..", "src", "popup", "index.html"),
  "utf8",
);

const links = [
  ["GitHub", "https://github.com/volitum/dereddit"],
  ["Report a bug", "https://github.com/volitum/dereddit/issues"],
  ["Support", "https://ko-fi.com/volitum/donate"],
];

test("renders the project footer links safely in new tabs", () => {
  assert.doesNotMatch(popup, /Changes saved automatically/);

  for (const [label, url] of links) {
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchor = popup.match(
      new RegExp(`<a\\s+[^>]*href="${escapedUrl}"[^>]*>\\s*${label}\\s*</a>`),
    )?.[0];

    assert.ok(anchor, `${label} link is missing`);
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
  }
});
