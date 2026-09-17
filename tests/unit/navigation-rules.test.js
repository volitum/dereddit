const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRules() {
  const context = vm.createContext({ URL, URLSearchParams });
  for (const file of ["shared/core.js", "background/navigation-rules.js"]) {
    vm.runInContext(
      readFileSync(join(__dirname, "..", "..", "src", file), "utf8"),
      context,
      { filename: file },
    );
  }
  return context.DeReddit;
}

function matchingRule(rules, url) {
  return rules
    .filter((rule) => new RegExp(rule.condition.regexFilter, "i").test(url))
    .sort((left, right) => right.priority - left.priority)[0] || null;
}

function applyRedirect(rule, url) {
  const regex = new RegExp(rule.condition.regexFilter, "i");
  const replacement = rule.action.redirect.regexSubstitution.replace("\\0", () => "$&");
  return url.replace(regex, replacement);
}

test("creates no declarative rules for the default settings", () => {
  const DeReddit = loadRules();
  assert.deepEqual(
    Array.from(DeReddit.createNavigationRules({}, "chrome-extension://id/blocked/index.html")),
    [],
  );
});

test("compiles page settings into prioritized main-frame redirects", () => {
  const DeReddit = loadRules();
  const rules = DeReddit.createNavigationRules(
    { blockHomepage: true, blockAll: true, blockPopular: true, blockNew: true, blockTop: true },
    "chrome-extension://id/blocked/index.html",
  );

  assert.equal(rules.length, 5);
  assert.ok(rules.every((rule) => rule.priority === 30));
  assert.ok(rules.every((rule) => rule.condition.resourceTypes[0] === "main_frame"));

  for (const [url, page] of [
    ["https://www.reddit.com/", "homepage"],
    ["https://old.reddit.com/r/all?sort=new", "all"],
    ["http://reddit.com/r/popular/", "popular"],
    ["https://www.reddit.com/new", "new"],
    ["https://www.reddit.com/top/?t=week", "top"],
  ]) {
    const rule = matchingRule(rules, url);
    assert.ok(rule, url);
    const redirect = new URL(applyRedirect(rule, url));
    assert.equal(redirect.searchParams.get("page"), page);
    assert.equal(redirect.hash.slice(1), url);
  }

  assert.equal(matchingRule(rules, "https://www.reddit.com/r/alligator"), null);
  assert.equal(matchingRule(rules, "https://example.com/r/all"), null);
});

test("preserves HOME and ALL subreddit semantics, including wildcards", () => {
  const DeReddit = loadRules();
  const rules = DeReddit.createNavigationRules({
    blockedSubreddits: [
      { name: "fire*", mode: "home" },
      { name: "*news*", mode: "all" },
    ],
  }, "moz-extension://id/blocked/index.html");

  for (const url of [
    "https://www.reddit.com/r/firefox",
    "https://www.reddit.com/r/firefox/top/?t=week",
    "https://www.reddit.com/r/worldnews/comments/abc/title",
  ]) {
    assert.ok(matchingRule(rules, url), url);
  }
  assert.equal(
    matchingRule(rules, "https://www.reddit.com/r/firefox/comments/abc/title"),
    null,
  );
  assert.equal(matchingRule(rules, "https://www.reddit.com/r/pics"), null);

  const worldNews = matchingRule(
    rules,
    "https://www.reddit.com/r/worldnews/comments/abc/title?tl=it",
  );
  const redirect = new URL(applyRedirect(
    worldNews,
    "https://www.reddit.com/r/worldnews/comments/abc/title?tl=it",
  ));
  assert.equal(redirect.searchParams.get("target"), "subreddit");
  assert.equal(redirect.searchParams.get("filter"), "*news*");
});

test("gives global page rules precedence and recognizes owned rule IDs", () => {
  const DeReddit = loadRules();
  const rules = DeReddit.createNavigationRules({
    blockAll: true,
    blockSubHome: true,
    blockedSubreddits: [{ name: "all", mode: "all" }],
  }, "chrome-extension://id/blocked/index.html");
  const match = matchingRule(rules, "https://www.reddit.com/r/all");

  assert.equal(match.priority, 30);
  assert.equal(new URL(applyRedirect(match, "https://www.reddit.com/r/all")).searchParams.get("page"), "all");
  assert.equal(DeReddit.isNavigationRuleId(999), false);
  assert.equal(DeReddit.isNavigationRuleId(1000), true);
  assert.equal(DeReddit.isNavigationRuleId(999999), true);
  assert.equal(DeReddit.isNavigationRuleId(1000000), false);
});

test("matches the shared route model across network-navigation cases", () => {
  const DeReddit = loadRules();
  const configurations = [
    {},
    { blockHomepage: true },
    { blockAll: true, blockPopular: true, blockNew: true, blockTop: true },
    { blockSubHome: true },
    { blockedSubreddits: [{ name: "fire*", mode: "home" }] },
    { blockedSubreddits: [{ name: "*news*", mode: "all" }] },
  ];
  const urls = [
    "https://www.reddit.com/",
    "https://reddit.com:8443/r/all?tl=it",
    "https://old.reddit.com/r/popular/",
    "https://www.reddit.com/new/comments",
    "https://www.reddit.com/top/?t=week",
    "https://www.reddit.com/r/firefox",
    "https://www.reddit.com/r/firefox//",
    "https://www.reddit.com/r/firefox/top/extra",
    "https://www.reddit.com/r/firefox/comments/abc/title",
    "https://www.reddit.com/r/worldnews/comments/abc/title?tl=it",
    "https://www.reddit.com/r/pics",
  ];

  for (const settings of configurations) {
    const rules = DeReddit.createNavigationRules(
      settings,
      "chrome-extension://id/blocked/index.html",
    );
    for (const url of urls) {
      const route = DeReddit.getBlockedRoute(new URL(url).pathname, settings);
      assert.equal(Boolean(matchingRule(rules, url)), Boolean(route), `${url} ${JSON.stringify(settings)}`);
    }
  }
});

test("caps declarative rules while leaving overflow entries to the content fallback", () => {
  const DeReddit = loadRules();
  const blockedSubreddits = Array.from(
    { length: DeReddit.NAVIGATION_RULE_LIMIT + 20 },
    (_, index) => ({ name: `community${index}`, mode: "all" }),
  );
  const rules = DeReddit.createNavigationRules(
    { blockHomepage: true, blockedSubreddits },
    "chrome-extension://id/blocked/index.html",
  );

  assert.equal(rules.length, DeReddit.NAVIGATION_RULE_LIMIT);
  assert.ok(matchingRule(rules, "https://www.reddit.com/"));
  assert.equal(
    DeReddit.getBlockedRoute("/r/community1019/comments/a/title", { blockedSubreddits })?.type,
    "subreddit",
  );
});
