const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor() {
    this.children = [];
    this.hidden = true;
    this.listeners = {};
    this.textContent = "";
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  click() {
    return this.listeners.click?.();
  }
}

async function loadBlockPage({
  historyLength = 1,
  hash = "",
  search = "",
  sendMessage = async () => ({ success: true }),
  storedSettings = {},
} = {}) {
  const elements = {
    "block-message": new FakeElement(),
    "block-reason": new FakeElement(),
    "go-back": new FakeElement(),
    "go-to-settings": new FakeElement(),
  };
  let readyListener;
  const redirects = [];
  const location = {
    href: "moz-extension://dereddit/blocked/index.html",
    hash,
    search,
    replace: (url) => redirects.push(url),
  };
  let historyBackCount = 0;
  let storageListener;
  const document = {
    addEventListener(type, listener) {
      if (type === "DOMContentLoaded") readyListener = listener;
    },
    createElement: () => new FakeElement(),
    createTextNode: (textContent) => ({ textContent }),
    getElementById: (id) => elements[id],
  };
  const chrome = {
    runtime: {
      getURL: (path) => `moz-extension://dereddit/${path}`,
      sendMessage,
    },
    storage: {
      local: { get: async () => storedSettings },
      onChanged: { addListener(listener) { storageListener = listener; } },
    },
  };
  const window = {
    history: {
      back() { historyBackCount += 1; },
      length: historyLength,
    },
    location,
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    chrome,
    console,
    document,
    window,
  });

  for (const file of ["shared/core.js", "blocked/blocked.js"]) {
    const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  readyListener();

  return {
    context,
    elements,
    get historyBackCount() { return historyBackCount; },
    location,
    redirects,
    storageListener,
  };
}

test("renders the blocked target and applied filter from the query string", async () => {
  const { elements } = await loadBlockPage({
    search: "?subreddit=firefox&filter=fire*",
  });

  assert.equal(elements["block-message"].textContent, "r/firefox is blocked");
  assert.equal(elements["block-reason"].hidden, false);
  assert.equal(elements["block-reason"].children[0].textContent, "Applied filter: ");
  assert.equal(elements["block-reason"].children[1].textContent, "fire*");
});

test("renders a DNR-blocked subreddit using the original URL fragment", async () => {
  const { elements } = await loadBlockPage({
    hash: "#https://www.reddit.com/r/firefox/comments/abc/title?tl=it",
    search: "?target=subreddit&filter=fire*",
  });

  assert.equal(elements["block-message"].textContent, "r/firefox is blocked");
  assert.equal(elements["block-reason"].children[1].textContent, "fire*");
});

test("renders known page messages and a safe fallback for unknown pages", async () => {
  const known = await loadBlockPage({ search: "?page=popular" });
  const unknown = await loadBlockPage({ search: "?page=unexpected" });

  assert.equal(known.elements["block-message"].textContent, "Popular page is blocked");
  assert.equal(unknown.elements["block-message"].textContent, "This content is blocked");
});

test("rejects non-web return URLs even when the hostname is Reddit", async () => {
  const { context } = await loadBlockPage();
  assert.equal(context.getSafeReturnUrl("ftp://reddit.com/r/firefox"), "");
  assert.equal(
    context.getSafeReturnUrl("https://old.reddit.com/r/firefox"),
    "https://old.reddit.com/r/firefox",
  );
});

test("falls back to standalone settings when the background reports failure", async () => {
  const { elements, location } = await loadBlockPage({
    sendMessage: async () => ({ success: false, error: "tabs unavailable" }),
  });

  await elements["go-to-settings"].click();
  assert.equal(
    location.href,
    "moz-extension://dereddit/popup/index.html?standalone=true",
  );
});

test("keeps the block page open when settings open successfully", async () => {
  const { elements, location } = await loadBlockPage();

  await elements["go-to-settings"].click();

  assert.equal(location.href, "moz-extension://dereddit/blocked/index.html");
});

test("goes back when history exists and otherwise returns to Reddit", async () => {
  const withHistory = await loadBlockPage({ historyLength: 2 });
  withHistory.elements["go-back"].click();
  assert.equal(withHistory.historyBackCount, 1);

  const withoutHistory = await loadBlockPage({ historyLength: 1 });
  withoutHistory.elements["go-back"].click();
  assert.equal(withoutHistory.location.href, "https://www.reddit.com");
});

test("restores the original Reddit URL after a local setting unblocks it", async () => {
  const returnUrl = "https://www.reddit.com/r/all";
  const page = await loadBlockPage({
    search: `?page=all&returnUrl=${encodeURIComponent(returnUrl)}`,
    storedSettings: {},
  });

  page.storageListener({}, "sync");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(page.redirects, []);

  page.storageListener({}, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(page.redirects, [returnUrl]);
});

test("does not restore a URL that remains blocked by route settings", async () => {
  const returnUrl = "https://www.reddit.com/r/firefox";
  const routeBlocked = await loadBlockPage({
    search: `?subreddit=firefox&returnUrl=${encodeURIComponent(returnUrl)}`,
    storedSettings: {
      blockedSubreddits: [{ name: "firefox", mode: "home" }],
    },
  });
  routeBlocked.storageListener({}, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(routeBlocked.redirects, []);
});
