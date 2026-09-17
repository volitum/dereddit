const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function loadContent({ querySelectorAll = () => [], settings, startUrl }) {
  const redirects = [];
  const injectedStyles = [];
  const location = {
    href: startUrl,
    origin: new URL(startUrl).origin,
    pathname: new URL(startUrl).pathname,
    replace(url) {
      redirects.push(url);
    },
  };
  const document = {
    body: {},
    documentElement: { appendChild(style) { injectedStyles.push(style); } },
    createElement: () => ({ id: "", style: {}, textContent: "" }),
    getElementById: (id) => injectedStyles.find((style) => style.id === id) || null,
    querySelectorAll(selector) {
      queriedSelectors.push(selector);
      return querySelectorAll(selector);
    },
  };
  const queriedSelectors = [];
  const storageListeners = [];
  const chrome = {
    storage: {
      local: { get: async () => settings },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
    runtime: {
      getURL: (path) => `moz-extension://dereddit/${path}`,
    },
  };
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
  }
  const window = {
    location,
    addEventListener() {},
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    chrome,
    console,
    document,
    MutationObserver,
    requestAnimationFrame: (callback) => callback(),
    setInterval: () => 0,
    window,
  });

  // This harness isolates legacy filtering. The limiter has its own DOM tests.
  vm.runInContext('var DeRedditFeedStub = { update() {} };', context);

  for (const file of ["shared/core.js", "content/main.js"]) {
    const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
    vm.runInContext(source, context, { filename: file });
    if (file === "shared/core.js") {
      vm.runInContext('DeReddit.createFeedLimiter = () => DeRedditFeedStub;', context);
    }
  }
  await new Promise((resolve) => setImmediate(resolve));

  return {
    checkCurrentPage: context.checkCurrentPage,
    location,
    redirects,
    storageListeners,
    queriedSelectors,
    injectedStyles,
  };
}

function createPost({ subreddit = "" } = {}) {
  return {
    dataset: {},
    getAttribute(name) {
      if (name === "data-subreddit") return subreddit;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function isPostCollectionSelector(selector) {
  return selector.includes('[data-testid="post-container"]')
    && selector.includes('[data-click-id="body"]');
}

test("does not scan the Reddit DOM when feed filters are inactive", async () => {
  const content = await loadContent({
    fetch: async () => ({ ok: false }),
    settings: {},
    startUrl: "https://www.reddit.com/",
  });

  assert.deepEqual(content.queriedSelectors, []);
  assert.doesNotMatch(content.injectedStyles[0].textContent, /shreddit-comment/);
  assert.doesNotMatch(content.injectedStyles[0].textContent, /reddit-header|#header/);
  assert.doesNotMatch(content.injectedStyles[0].textContent, /pdp-right-rail/);
});

test("ignores legacy translation settings on load, storage changes and SPA navigations", async () => {
  const content = await loadContent({
    settings: { disableAutoTranslation: true },
    startUrl: "https://www.reddit.com/r/firefox/?tl=it#comments",
  });
  assert.deepEqual(content.redirects, []);
  content.storageListeners[0]({ disableAutoTranslation: { newValue: true } }, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(content.redirects, []);

  content.location.href = "https://www.reddit.com/r/javascript/?tl=ja&sort=top";
  content.location.pathname = "/r/javascript/";
  await content.checkCurrentPage();
  assert.deepEqual(content.redirects, []);

  content.storageListeners[0]({ disableAutoTranslation: { newValue: false } }, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(content.redirects, []);
});

test("blocking rules apply to translated pages", async () => {
  const blocked = await loadContent({
    settings: { blockAll: true },
    startUrl: "https://www.reddit.com/r/all?tl=it",
  });
  assert.equal(new URL(blocked.redirects[0]).searchParams.get("page"), "all");
});

test("loads right-sidebar filtering without reading page text or blocking navigation", async () => {
  const content = await loadContent({
    settings: { hideRelatedPosts: true },
    startUrl: "https://www.reddit.com/r/firefox/comments/abc/post",
    querySelectorAll() { throw new Error("This filter must not scan page text"); },
  });
  const styleText = content.injectedStyles[0].textContent;

  assert.match(styleText, /pdp-right-rail/);
  assert.match(styleText, /#right-sidebar-container/);
  assert.match(styleText, /\.right-sidebar/);
  assert.match(styleText, /\.side,/);
  assert.doesNotMatch(styleText, /listing-below|shreddit-related-posts|#related-posts|aria-label|:lang\(|:has-text\(|shreddit-comment|reddit-header|#left-sidebar/);
  assert.deepEqual(content.redirects, []);
});

test("restores the right sidebar without changing active comment, navbar or post filters", async () => {
  const post = createPost({ subreddit: "firefox" });
  const content = await loadContent({
    querySelectorAll: (selector) => isPostCollectionSelector(selector) ? [post] : [],
    settings: {
      hideComments: true,
      hideNavbar: true,
      blockedSubreddits: [{ name: "firefox", mode: "all" }],
    },
    startUrl: "https://www.reddit.com/",
  });
  const style = content.injectedStyles[0];
  const originalRules = style.textContent;

  for (const enabled of [true, false, true]) {
    content.storageListeners[0]({ hideRelatedPosts: { newValue: enabled } }, "local");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(style.textContent.includes("#right-sidebar-container"), enabled);
    assert.ok(style.textContent.startsWith(originalRules));
    assert.equal(post.dataset.deredditPostHidden, "true");
    assert.equal(content.injectedStyles.length, 1);
    assert.deepEqual(content.redirects, []);
  }

  content.storageListeners[0]({ hideRelatedPosts: { oldValue: true } }, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(style.textContent, originalRules);
});

test("loads navbar hiding as a persistent CSS rule without scanning or redirecting", async () => {
  const content = await loadContent({
    settings: { hideNavbar: true },
    startUrl: "https://www.reddit.com/r/firefox/comments/abc/post",
  });
  const navbarRule = content.injectedStyles[0].textContent.split("\n")[1];

  for (const selector of [
    "#header", "#shreddit-header", "reddit-header-large", "reddit-header-small",
    "shreddit-app > header", 'header[role="banner"]',
  ]) {
    assert.ok(navbarRule.includes(selector));
  }
  assert.match(navbarRule, /\{ display: none !important; \}/);
  assert.doesNotMatch(content.injectedStyles[0].textContent, /shreddit-comment/);
  assert.deepEqual(content.redirects, []);
  assert.deepEqual(content.queriedSelectors, []);
});

test("toggles navbar and comments independently while retaining feed filters", async () => {
  const post = createPost({ subreddit: "firefox" });
  const content = await loadContent({
    querySelectorAll: (selector) => isPostCollectionSelector(selector) ? [post] : [],
    settings: { blockedSubreddits: [{ name: "firefox", mode: "all" }] },
    startUrl: "https://www.reddit.com/",
  });
  const style = content.injectedStyles[0];
  const originalRules = style.textContent;

  for (const [hideNavbar, hideComments] of [
    [true, false], [true, true], [false, true], [true, true], [true, false],
  ]) {
    content.storageListeners[0]({
      hideNavbar: { newValue: hideNavbar },
      hideComments: { newValue: hideComments },
    }, "local");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(style.textContent.includes("reddit-header-large"), hideNavbar);
    assert.equal(style.textContent.includes("shreddit-comment"), hideComments);
    assert.ok(style.textContent.startsWith(originalRules));
    assert.equal(post.dataset.deredditPostHidden, "true");
    assert.equal(content.injectedStyles.length, 1);
    assert.deepEqual(content.redirects, []);
  }

  content.storageListeners[0]({ hideNavbar: { oldValue: true } }, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(style.textContent, originalRules);
});

test("hides comment layouts with a persistent CSS rule without blocking the post", async () => {
  const content = await loadContent({
    settings: { hideComments: true },
    startUrl: "https://www.reddit.com/r/firefox/comments/abc/post",
  });

  const style = content.injectedStyles[0];
  const commentRule = style.textContent.split("\n")[1];
  for (const selector of [
    "shreddit-comment", "shreddit-comment-tree",
    '[data-testid="comment"]', '[data-testid="comment-tree"]',
    ".Comment", ".comment",
  ]) {
    assert.ok(commentRule.includes(selector));
  }
  assert.match(commentRule, /\{ display: none !important; \}/);
  assert.deepEqual(content.redirects, []);
  assert.deepEqual(content.queriedSelectors, []);
});

test("toggles comment visibility live while preserving post and community filters", async () => {
  const post = createPost({ subreddit: "firefox" });
  const content = await loadContent({
    querySelectorAll: (selector) => isPostCollectionSelector(selector) ? [post] : [],
    settings: { blockedSubreddits: [{ name: "firefox", mode: "all" }] },
    startUrl: "https://www.reddit.com/",
  });
  const style = content.injectedStyles[0];
  const originalRules = style.textContent;

  for (const enabled of [true, false, true]) {
    content.storageListeners[0]({ hideComments: { newValue: enabled } }, "local");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(style.textContent.includes("shreddit-comment"), enabled);
    assert.ok(style.textContent.startsWith(originalRules));
    assert.equal(post.dataset.deredditPostHidden, "true");
    assert.equal(content.injectedStyles.length, 1);
    assert.deepEqual(content.redirects, []);
  }

  content.storageListeners[0]({ hideComments: { oldValue: true } }, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(style.textContent, originalRules);
});

test("hides posts from ALL-mode subreddits using post attributes", async () => {
  const blockedPost = createPost({ subreddit: "r/Firefox" });
  const allowedPost = createPost({ subreddit: "javascript" });

  await loadContent({
    fetch: async () => ({ ok: false }),
    querySelectorAll: (selector) => isPostCollectionSelector(selector)
      ? [blockedPost, allowedPost]
      : [],
    settings: {
      blockedSubreddits: [{ name: "fire*", mode: "all" }],
    },
    startUrl: "https://www.reddit.com/",
  });

  assert.equal(blockedPost.dataset.deredditPostHidden, "true");
  assert.equal("deredditPostHidden" in allowedPost.dataset, false);
});

test("does not hide feed posts for HOME-mode subreddit entries", async () => {
  const post = createPost({ subreddit: "firefox" });

  await loadContent({
    fetch: async () => ({ ok: false }),
    querySelectorAll: (selector) => isPostCollectionSelector(selector) ? [post] : [],
    settings: {
      blockedSubreddits: [{ name: "firefox", mode: "home" }],
    },
    startUrl: "https://www.reddit.com/",
  });

  assert.equal("deredditPostHidden" in post.dataset, false);
});

test("uses post permalinks when a Reddit layout has no known post selector", async () => {
  const post = createPost();
  const link = {
    getAttribute: () => "/r/firefox/comments/abc/a-post",
    closest(selector) {
      return selector.includes("shreddit-comment") ? null : post;
    },
  };

  await loadContent({
    fetch: async () => ({ ok: false }),
    querySelectorAll(selector) {
      if (selector === 'a[href*="/comments/"]') return [link];
      return [];
    },
    settings: {
      blockedSubreddits: [{ name: "firefox", mode: "all" }],
    },
    startUrl: "https://www.reddit.com/",
  });

  assert.equal(post.dataset.deredditPostHidden, "true");
});

test("hides individual blocked communities inside popular panels", async () => {
  const blockedItem = { dataset: {} };
  const allowedItem = { dataset: {} };
  const panel = {
    contains: () => true,
    querySelectorAll: () => [blockedLink, allowedLink],
  };
  const blockedLink = {
    getAttribute: () => "/r/firefox",
    closest: () => blockedItem,
  };
  const allowedLink = {
    getAttribute: () => "/r/javascript",
    closest: () => allowedItem,
  };

  await loadContent({
    fetch: async () => ({ ok: false }),
    querySelectorAll: (selector) => selector.includes("popular-communities")
      ? [panel]
      : [],
    settings: {
      blockedSubreddits: [{ name: "firefox", mode: "home" }],
    },
    startUrl: "https://www.reddit.com/",
  });

  assert.equal(blockedItem.dataset.deredditCommunityHidden, "true");
  assert.equal("deredditCommunityHidden" in allowedItem.dataset, false);
});

test("reveals posts after the last active feed filter is disabled", async () => {
  const hiddenPost = { dataset: { deredditPostHidden: "true" } };
  const content = await loadContent({
    querySelectorAll: (selector) => selector === '[data-dereddit-post-hidden="true"]'
      ? [hiddenPost]
      : [],
    settings: { blockedSubreddits: [{ name: "firefox", mode: "all" }] },
    startUrl: "https://www.reddit.com/",
  });

  content.storageListeners[0](
    { blockedSubreddits: { oldValue: [{ name: "firefox", mode: "all" }], newValue: [] } },
    "local",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal("deredditPostHidden" in hiddenPost.dataset, false);
});

test("clears stale hidden markers while filters remain active", async () => {
  const hiddenPost = { dataset: { deredditPostHidden: "true" } };
  const hiddenCommunity = {
    dataset: { deredditCommunityHidden: "true" },
  };

  await loadContent({
    fetch: async () => ({ ok: false }),
    querySelectorAll(selector) {
      if (selector === '[data-dereddit-post-hidden="true"]') {
        return [hiddenPost];
      }
      if (selector === '[data-dereddit-community-hidden="true"]') {
        return [hiddenCommunity];
      }
      return [];
    },
    settings: {
      blockSubHome: true,
      blockedSubreddits: [{ name: "firefox", mode: "all" }],
    },
    startUrl: "https://www.reddit.com/",
  });

  assert.equal("deredditPostHidden" in hiddenPost.dataset, false);
  assert.equal(
    "deredditCommunityHidden" in hiddenCommunity.dataset,
    false,
  );
});

test("reveals a current post candidate when its blocking entry changes", async () => {
  const post = createPost({ subreddit: "firefox" });
  const content = await loadContent({
    fetch: async () => ({ ok: false }),
    querySelectorAll: (selector) => isPostCollectionSelector(selector) ? [post] : [],
    settings: {
      blockedSubreddits: [{ name: "firefox", mode: "all" }],
    },
    startUrl: "https://www.reddit.com/",
  });
  assert.equal(post.dataset.deredditPostHidden, "true");

  content.storageListeners[0]({
    blockedSubreddits: {
      oldValue: [{ name: "firefox", mode: "all" }],
      newValue: [{ name: "javascript", mode: "all" }],
    },
  }, "local");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal("deredditPostHidden" in post.dataset, false);
});

test("merges storage changes received while the initial config is loading", async () => {
  const initialSettings = deferred();
  const content = await loadContent({
    fetch: async () => ({ ok: false }),
    settings: initialSettings.promise,
    startUrl: "https://www.reddit.com/r/all",
  });

  content.storageListeners[0](
    { blockAll: { oldValue: true, newValue: false } },
    "local",
  );
  initialSettings.resolve({ blockAll: true, blockHomepage: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(content.redirects, []);

  content.location.href = "https://www.reddit.com/";
  content.location.pathname = "/";
  await content.checkCurrentPage({ force: true });

  assert.equal(content.redirects.length, 1);
  assert.equal(new URL(content.redirects[0]).searchParams.get("page"), "homepage");

  content.location.href = "https://www.reddit.com/r/all";
  content.location.pathname = "/r/all";
  await content.checkCurrentPage({ force: true });

  assert.equal(content.redirects.length, 1);
});
