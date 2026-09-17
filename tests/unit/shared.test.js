const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadShared(overrides = {}) {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    console,
    ...overrides,
  });
  const source = readFileSync(
    join(__dirname, "..", "..", "src", "shared", "core.js"),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "shared/core.js" });
  return context.DeReddit;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const DeReddit = loadShared();

test("normalizes subreddit names and Reddit URLs", () => {
  assert.equal(DeReddit.normalizeSubredditName(" r/JavaScript/ "), "javascript");
  assert.equal(
    DeReddit.normalizeSubredditName("https://old.reddit.com/r/Firefox/?sort=top"),
    "firefox",
  );
  assert.equal(DeReddit.normalizeSubredditName("*News**"), "*news*");
  assert.equal(DeReddit.normalizeSubredditName("https://example.com/r/firefox"), "");
});

test("rejects invalid subreddit values and normalizes bare Reddit hosts", () => {
  assert.equal(DeReddit.normalizeSubredditName("reddit.com/r/Firefox/comments/123"), "firefox");
  assert.equal(DeReddit.normalizeSubredditName("https://reddit.com/"), "");
  assert.equal(DeReddit.normalizeSubredditName("***"), "");
  assert.equal(DeReddit.normalizeSubredditName(42), "");
});

test("matches exact names and wildcard patterns", () => {
  assert.equal(DeReddit.matchesSubredditPattern("firefox", "Firefox"), true);
  assert.equal(DeReddit.matchesSubredditPattern("*news*", "worldnews"), true);
  assert.equal(DeReddit.matchesSubredditPattern("news*", "worldnews"), false);
  assert.equal(DeReddit.matchesSubredditPattern("*", "worldnews"), false);
  assert.equal(DeReddit.matchesSubredditPattern("", "worldnews"), false);
});

test("normalizes, migrates and deduplicates blocked entries", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.normalizeBlockedSubreddits([
      "Firefox",
      { name: "firefox", mode: "home" },
      { name: "javascript", mode: "all" },
      { name: "javascript", mode: "invalid" },
    ]))),
    [
      { name: "firefox", mode: "home" },
      { name: "javascript", mode: "all" },
      { name: "javascript", mode: "home" },
    ],
  );
});

test("coerces settings without retaining unknown keys", () => {
  const settings = DeReddit.coerceSettings({
    blockHomepage: true,
    blockAll: 0,
    blockNsfw: true,
    unknown: true,
  });

  assert.equal(settings.blockHomepage, true);
  assert.equal(settings.blockAll, false);
  assert.equal("blockNsfw" in settings, false);
  assert.equal("unknown" in settings, false);
});

test("returns an independent blocked-subreddits collection for each config", () => {
  const first = DeReddit.coerceSettings();
  first.blockedSubreddits.push({ name: "firefox", mode: "all" });

  const second = DeReddit.coerceSettings();

  assert.deepEqual(JSON.parse(JSON.stringify(second.blockedSubreddits)), []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.DEFAULT_SETTINGS.blockedSubreddits)),
    [],
  );
});

test("rejects malformed stored values instead of throwing or enabling flags", () => {
  assert.doesNotThrow(() => DeReddit.coerceSettings(null));
  assert.doesNotThrow(() => DeReddit.coerceSettings({ blockedSubreddits: {} }));
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.coerceSettings({
      blockedSubreddits: "firefox",
      blockHomepage: "false",
      blockAll: 1,
    }))),
    {
      blockedSubreddits: [],
      blockHomepage: false,
      blockAll: false,
      blockPopular: false,
      blockNew: false,
      blockTop: false,
      blockSubHome: false,
      hideComments: false,
      hideNavbar: false,
      hideLeftSidebar: false,
      hideRelatedPosts: false,
      limitInfiniteScroll: false,
      scrollLimit: 25,
      scrollMode: "fixed",
    },
  );
});

test("applies only known local-storage changes", () => {
  const settings = DeReddit.applyStorageChanges(
    { blockHomepage: true, blockAll: true },
    {
      blockHomepage: { oldValue: true, newValue: false },
      unknown: { newValue: true },
    },
  );

  assert.equal(settings.blockHomepage, false);
  assert.equal(settings.blockAll, true);
  assert.equal("unknown" in settings, false);
});

test("resets a setting to its default when it is removed from storage", () => {
  const settings = DeReddit.applyStorageChanges(
    { blockHomepage: true, blockedSubreddits: [{ name: "firefox", mode: "all" }] },
    {
      blockHomepage: { oldValue: true },
      blockedSubreddits: { oldValue: [{ name: "firefox", mode: "all" }] },
    },
  );

  assert.equal(settings.blockHomepage, false);
  assert.deepEqual(JSON.parse(JSON.stringify(settings.blockedSubreddits)), []);
});

test("settings store preserves changes received during its initial load", async () => {
  const initialSettings = deferred();
  let readCount = 0;
  const store = DeReddit.createSettingsStore({
    get() {
      readCount += 1;
      return initialSettings.promise;
    },
  });

  const firstLoad = store.load();
  const concurrentLoad = store.load();
  store.applyChanges({
    blockHomepage: { oldValue: true, newValue: false },
  });
  initialSettings.resolve({ blockHomepage: true, blockAll: true });

  assert.equal(firstLoad, concurrentLoad);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await firstLoad)),
    {
      blockedSubreddits: [],
      blockHomepage: false,
      blockAll: true,
      blockPopular: false,
      blockNew: false,
      blockTop: false,
      blockSubHome: false,
      hideComments: false,
      hideNavbar: false,
      hideLeftSidebar: false,
      hideRelatedPosts: false,
      limitInfiniteScroll: false,
      scrollLimit: 25,
      scrollMode: "fixed",
    },
  );
  await store.load();
  assert.equal(readCount, 1);
});

test("settings store keeps valid updates when its initial load fails", async () => {
  const errors = [];
  const store = DeReddit.createSettingsStore(
    { get: async () => { throw new Error("storage unavailable"); } },
    { onLoadError: (error) => errors.push(error.message) },
  );
  store.applyChanges({ blockTop: { newValue: true } });

  const settings = await store.load();

  assert.equal(settings.blockTop, true);
  assert.deepEqual(errors, ["storage unavailable"]);
});

test("accepts only HTTP(S) Reddit URLs", () => {
  assert.equal(
    DeReddit.getRedditUrl("/r/firefox", "https://old.reddit.com").href,
    "https://old.reddit.com/r/firefox",
  );
  assert.equal(DeReddit.getRedditUrl("https://example.com/r/firefox"), null);
  assert.equal(DeReddit.getRedditUrl("ftp://reddit.com/r/firefox"), null);
  assert.equal(DeReddit.getRedditUrl("https://reddit.com.evil.example/r/firefox"), null);
  assert.equal(DeReddit.getRedditUrl("not a URL"), null);
});

test("parses subreddit paths and their remaining segments", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.getSubredditPath("/r/Firefox/TOP/week/"))),
    { name: "firefox", rest: "top/week" },
  );
  assert.equal(DeReddit.getSubredditPath("/user/firefox"), null);
  assert.equal(DeReddit.getSubredditPath("/r/***"), null);
  assert.equal(DeReddit.getSubredditPath(null), null);
});

test("recognizes page and subreddit blocking routes", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.getBlockedRoute("/r/popular/new", {
      blockPopular: true,
    }))),
    { type: "page", page: "popular", filter: "r/popular" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.getBlockedRoute("/r/firefox/comments/abc/post", {
      blockedSubreddits: [{ name: "fire*", mode: "all" }],
    }))),
    { type: "subreddit", subreddit: "firefox", filter: "fire*" },
  );
  assert.equal(
    DeReddit.getBlockedRoute("/r/firefox/comments/abc/post", {
      blockedSubreddits: [{ name: "firefox", mode: "home" }],
    }),
    null,
  );
});

test("covers every main-page route without matching similar paths", () => {
  const cases = [
    ["/", { blockHomepage: true }, "homepage"],
    ["/r/all/top", { blockAll: true }, "all"],
    ["/r/popular/new", { blockPopular: true }, "popular"],
    ["/new/rising", { blockNew: true }, "new"],
    ["/top/week", { blockTop: true }, "top"],
  ];

  for (const [pathname, settings, page] of cases) {
    assert.equal(DeReddit.getBlockedRoute(pathname, settings).page, page);
  }

  assert.equal(DeReddit.getBlockedRoute("/r/alligator", { blockAll: true }), null);
  assert.equal(DeReddit.getBlockedRoute("/newest", { blockNew: true }), null);
});

test("distinguishes subreddit fronts from posts for HOME and ALL modes", () => {
  const homeSettings = {
    blockedSubreddits: [{ name: "firefox", mode: "home" }],
  };

  for (const pathname of ["/r/firefox", "/r/firefox/hot", "/r/firefox/top/week"]) {
    assert.equal(DeReddit.getBlockedRoute(pathname, homeSettings)?.subreddit, "firefox");
  }
  assert.equal(
    DeReddit.getBlockedRoute("/r/firefox/comments/abc/post", homeSettings),
    null,
  );
  assert.equal(
    DeReddit.getBlockedRoute("/r/firefox/comments/abc/post", {
      blockedSubreddits: [{ name: "firefox", mode: "all" }],
    })?.subreddit,
    "firefox",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(DeReddit.getBlockedRoute("/r/firefox/rising", {
      blockSubHome: true,
    }))),
    {
      type: "page",
      page: "subhome",
      subreddit: "firefox",
      filter: "All Sub Fronts",
    },
  );
});

test("serializes block details into a query string", () => {
  const query = DeReddit.blockedRouteToQuery(
    { type: "subreddit", subreddit: "firefox", filter: "fire*" },
    "https://www.reddit.com/r/firefox",
  );
  const params = new URLSearchParams(query);

  assert.equal(params.get("subreddit"), "firefox");
  assert.equal(params.get("filter"), "fire*");
  assert.equal(params.get("returnUrl"), "https://www.reddit.com/r/firefox");
  assert.equal(DeReddit.blockedRouteToQuery(null), "");
});

test("normalizes typed scroll settings and resets removed values", () => {
  assert.equal(DeReddit.coerceSettings({ scrollLimit: 1 }).scrollLimit, 1);
  for (const value of [0, -1, 2.5, "10", null, true, Infinity, NaN, 2 ** 53]) {
    assert.equal(DeReddit.coerceSettings({ scrollLimit: value }).scrollLimit, 25);
  }
  assert.equal(DeReddit.coerceSettings({ scrollMode: "button" }).scrollMode, "button");
  assert.equal(DeReddit.coerceSettings({ scrollMode: "other" }).scrollMode, "fixed");
  const settings = DeReddit.applyStorageChanges({ scrollLimit: 10, scrollMode: "button" }, {
    scrollLimit: { oldValue: 10 }, scrollMode: { oldValue: "button" },
  });
  assert.equal(settings.scrollLimit, 25);
  assert.equal(settings.scrollMode, "fixed");
});

test("limits listing routes without treating comments, wiki or settings as feeds", () => {
  for (const path of ["/", "/best", "/top/", "/r/popular/", "/r/all", "/r/firefox", "/r/firefox/new/"]) {
    assert.equal(DeReddit.isFeedPath(path), true, path);
  }
  for (const path of ["/r/firefox/comments/abc/post", "/r/firefox/wiki", "/settings", "/message/inbox", "/r/firefox/top/extra"]) {
    assert.equal(DeReddit.isFeedPath(path), false, path);
  }
});
