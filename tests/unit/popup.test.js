const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

class FakeElement {
  constructor(tagName = "") {
    this.tagName = tagName.toUpperCase();
    this.checked = false;
    this.children = [];
    this.className = "";
    this.disabled = false;
    this.files = [];
    this.focused = false;
    this.listeners = {};
    this.attributes = {};
    this.parentElement = null;
    this.textContent = "";
    this.value = "";
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === "") this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || "";
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  click() {
    this.clickCount = (this.clickCount || 0) + 1;
    return this.listeners.click?.({ target: this });
  }

  dispatch(type, event = {}) {
    return this.listeners[type]?.({ target: this, ...event });
  }

  focus() {
    this.focused = true;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const descendants = [];
    const visit = (element) => {
      for (const child of element.children || []) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);

    if (selector === ".blocked-item") {
      return descendants.filter((element) => element.className === "blocked-item");
    }
    if (selector === "input") {
      return descendants.filter((element) => element.tagName === "INPUT");
    }
    if (selector === "input, select, button") {
      return descendants.filter((element) => ["INPUT", "SELECT", "BUTTON"].includes(
        element.tagName,
      ));
    }
    return [];
  }
}

async function loadPopup({
  storedSettings = {},
  autoResolveWrites = false,
  getSettings,
  tabs = [],
} = {}) {
  const ids = [
    "tab-controls", "tab-communities", "tab-backup",
    "panel-controls", "panel-communities", "panel-backup",
    "blocked-count",
    "blocked-list",
    "add-subreddit",
    "add-current-subreddit",
    "save-indicator",
    "toast",
    "export-config",
    "import-config",
    "import-file",
    "block-homepage",
    "block-popular",
    "block-sub-home",
    "hide-comments",
    "hide-navbar",
    "hide-left-sidebar",
    "hide-right-sidebar",
    "limit-infinite-scroll",
    "scroll-limit",
    "scroll-mode",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const tabsElements = ["controls", "communities", "backup"].map((name, index) => {
    const tab = elements[`tab-${name}`];
    tab.setAttribute("aria-controls", `panel-${name}`);
    tab.setAttribute("aria-selected", String(index === 0));
    tab.tabIndex = index === 0 ? 0 : -1;
    elements[`panel-${name}`].hidden = index !== 0;
    return tab;
  });
  let readyListener;
  const createdElements = [];
  const document = {
    addEventListener(type, listener) {
      if (type === "DOMContentLoaded") readyListener = listener;
    },
    createElement: (tagName) => {
      const element = new FakeElement(tagName);
      createdElements.push(element);
      return element;
    },
    createTextNode: () => ({}),
    getElementById: (id) => elements[id],
    querySelectorAll: (selector) => selector === '[role="tab"]' ? tabsElements : [],
  };
  const writes = [];
  let currentSettings = storedSettings;
  const chrome = {
    storage: {
      local: {
        get: () => getSettings ? getSettings() : currentSettings,
        set(settings) {
          const completion = deferred();
          writes.push({ settings, completion });
          if (autoResolveWrites) {
            currentSettings = settings;
            completion.resolve();
          }
          return completion.promise;
        },
      },
    },
    tabs: { query: async () => tabs },
  };
  const context = vm.createContext({
    Blob,
    URL,
    URLSearchParams,
    chrome,
    console,
    document,
    setTimeout,
    clearTimeout,
  });

  for (const file of ["shared/core.js", "popup/popup.js"]) {
    const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  readyListener();
  await new Promise((resolve) => setImmediate(resolve));

  return { createdElements, elements, writes };
}

function getRenderedItems(elements) {
  return elements["blocked-list"].querySelectorAll(".blocked-item");
}

test("navigates settings tabs with arrows, Home and End without saving configuration", async () => {
  const { elements, writes } = await loadPopup();
  function expectSelected(name) {
    for (const section of ["controls", "communities", "backup"]) {
      const selected = section === name;
      assert.equal(elements[`tab-${section}`].getAttribute("aria-selected"), String(selected));
      assert.equal(elements[`tab-${section}`].tabIndex, selected ? 0 : -1);
      assert.equal(elements[`panel-${section}`].hidden, !selected);
    }
  }
  expectSelected("controls");
  elements["tab-communities"].click();
  expectSelected("communities");
  for (const [from, key, to] of [
    ["communities", "ArrowRight", "backup"],
    ["backup", "ArrowRight", "controls"],
    ["controls", "ArrowLeft", "backup"],
    ["backup", "Home", "controls"],
    ["controls", "End", "backup"],
  ]) {
    let prevented = false;
    elements[`tab-${from}`].dispatch("keydown", { key, preventDefault() { prevented = true; } });
    expectSelected(to);
    assert.equal(prevented, true);
    assert.equal(elements[`tab-${to}`].focused, true);
  }
  elements["tab-backup"].dispatch("keydown", { key: "Tab", preventDefault() { assert.fail("Keep native Tab navigation"); } });
  assert.equal(writes.length, 0);
});

test("retains community drafts and pending saves when changing tabs", async () => {
  const { elements, writes } = await loadPopup({ autoResolveWrites: true });
  elements["tab-communities"].click();
  elements["add-subreddit"].click();
  const input = getRenderedItems(elements)[0].querySelector("input");
  input.value = "Firefox";
  input.dispatch("input");
  elements["tab-backup"].click();
  elements["tab-controls"].click();
  elements["tab-communities"].click();
  assert.equal(getRenderedItems(elements)[0].querySelector("input"), input);
  assert.equal(input.value, "Firefox");
  // Export flushes the pending edit even though it lives in another panel.
  await elements["export-config"].click();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.blockedSubreddits[0].name, "firefox");
  assert.equal(elements["blocked-count"].textContent, "1 rule");
  assert.equal(elements["toast"].textContent, "Configuration exported!");
});

test("serializes popup saves so an older write cannot finish last", async () => {
  const { elements, writes } = await loadPopup();

  elements["block-homepage"].checked = true;
  elements["block-homepage"].dispatch("change");
  elements["block-popular"].checked = true;
  elements["block-popular"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.blockHomepage, true);
  assert.equal(writes[0].settings.blockPopular, false);

  writes[0].completion.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.equal(writes[1].settings.blockHomepage, true);
  assert.equal(writes[1].settings.blockPopular, true);

  writes[1].completion.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});

test("continues the save queue after an earlier storage write fails", async () => {
  const { elements, writes } = await loadPopup();

  elements["block-homepage"].checked = true;
  elements["block-homepage"].dispatch("change");
  elements["block-popular"].checked = true;
  elements["block-popular"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));

  writes[0].completion.reject(new Error("storage unavailable"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.equal(writes[1].settings.blockPopular, true);

  writes[1].completion.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements["toast"].textContent, "Save failed: storage unavailable");
});

test("renders stored entries sorted by name with their saved modes", async () => {
  const { elements } = await loadPopup({
    storedSettings: {
      blockedSubreddits: [
        { name: "zeta", mode: "home" },
        { name: "alpha", mode: "all" },
      ],
    },
  });
  const items = getRenderedItems(elements);

  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector("input").value, "alpha");
  assert.equal(items[1].querySelector("input").value, "zeta");
  assert.equal(items[0].children[1].children[0].selected, false);
  assert.equal(items[0].children[1].children[1].selected, true);
});

test("normalizes edited entries and saves their selected mode", async () => {
  const { elements, writes } = await loadPopup({ autoResolveWrites: true });

  elements["add-subreddit"].click();
  const item = getRenderedItems(elements)[0];
  const input = item.querySelector("input");
  const select = item.children[1];
  assert.equal(input.focused, true);
  assert.equal(writes.length, 0);

  input.value = " https://old.reddit.com/r/Firefox/ ";
  input.dispatch("input");
  input.dispatch("blur");
  select.value = "all";
  select.dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(input.value, "firefox");
  assert.equal(writes.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(writes[1].settings.blockedSubreddits)),
    [{ name: "firefox", mode: "all" }],
  );
});

test("removes an entry and persists the resulting list", async () => {
  const { elements, writes } = await loadPopup({
    autoResolveWrites: true,
    storedSettings: {
      blockedSubreddits: [{ name: "firefox", mode: "home" }],
    },
  });

  getRenderedItems(elements)[0].children[2].click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getRenderedItems(elements).length, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(writes[0].settings.blockedSubreddits)),
    [],
  );
});

test("adds the current tab's subreddit and reports non-subreddit tabs", async () => {
  const currentSubreddit = await loadPopup({
    autoResolveWrites: true,
    tabs: [{ url: "https://www.reddit.com/r/Firefox/comments/abc/post" }],
  });

  await currentSubreddit.elements["add-current-subreddit"].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    getRenderedItems(currentSubreddit.elements)[0].querySelector("input").value,
    "firefox",
  );
  assert.equal(currentSubreddit.writes.length, 1);

  const nonSubreddit = await loadPopup({
    tabs: [{ url: "https://www.reddit.com/" }],
  });
  await nonSubreddit.elements["add-current-subreddit"].click();
  assert.equal(
    nonSubreddit.elements["toast"].textContent,
    "No subreddit found on current tab",
  );
});

test("exports the normalized stored configuration as a JSON download", async () => {
  const { createdElements, elements } = await loadPopup({
    storedSettings: {
      blockAll: true,
      hideRelatedPosts: true,
      disableAutoTranslation: true,
      disableAutoplay: true,
      blockedSubreddits: ["Firefox"],
      unknown: true,
    },
  });

  await elements["export-config"].click();
  const link = createdElements.find((element) => element.tagName === "A");

  assert.equal(link.download, "dereddit-config.json");
  assert.match(link.href, /^blob:/);
  assert.equal(link.clickCount, 1);
  const exported = await fetch(link.href).then((response) => response.json());
  assert.equal(exported.hideRelatedPosts, true);
  assert.equal("disableAutoTranslation" in exported, false);
  assert.equal("disableAutoplay" in exported, false);
  assert.equal("unknown" in exported, false);
  assert.equal(elements["toast"].textContent, "Configuration exported!");
});

test("reenables controls and reports an initial storage read failure", async () => {
  const { elements } = await loadPopup({
    getSettings: async () => {
      throw new Error("storage unavailable");
    },
  });

  assert.equal(elements["toast"].textContent, "Could not load settings: storage unavailable");
  assert.equal(elements["block-homepage"].disabled, false);
  assert.equal(elements["import-config"].disabled, false);
});

test("maps every checkbox to the matching storage setting", async () => {
  const settingByElementId = {
    "block-homepage": "blockHomepage",
    "block-popular": "blockPopular",
    "block-sub-home": "blockSubHome",
    "hide-comments": "hideComments",
    "hide-navbar": "hideNavbar",
    "hide-left-sidebar": "hideLeftSidebar",
    "hide-right-sidebar": "hideRelatedPosts",
    "limit-infinite-scroll": "limitInfiniteScroll",
  };
  const storedSettings = Object.fromEntries(
    Object.values(settingByElementId).map((key) => [key, true]),
  );
  const { elements, writes } = await loadPopup({
    storedSettings,
    autoResolveWrites: true,
  });

  for (const elementId of Object.keys(settingByElementId)) {
    assert.equal(elements[elementId].checked, true);
  }

  elements["block-homepage"].checked = false;
  elements["block-homepage"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  for (const [elementId, settingKey] of Object.entries(settingByElementId)) {
    assert.equal(writes[0].settings[settingKey], elements[elementId].checked);
  }
});

test("preserves current settings during a partial import", async () => {
  const { elements, writes } = await loadPopup({
    storedSettings: { blockAll: true },
    autoResolveWrites: true,
  });
  elements["import-file"].files = [{
    text: async () => JSON.stringify({
      blockHomepage: true, hideComments: true, hideNavbar: true, hideRelatedPosts: true,
      blockNsfw: true,
      disableAutoTranslation: true,
      disableAutoplay: true,
    }),
  }];

  elements["import-file"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.blockHomepage, true);
  assert.equal(writes[0].settings.blockAll, true);
  assert.equal(writes[0].settings.hideComments, true);
  assert.equal(elements["hide-comments"].checked, true);
  assert.equal(writes[0].settings.hideNavbar, true);
  assert.equal(elements["hide-navbar"].checked, true);
  assert.equal(writes[0].settings.hideRelatedPosts, true);
  assert.equal(elements["hide-right-sidebar"].checked, true);
  assert.equal("blockNsfw" in writes[0].settings, false);
  assert.equal("disableAutoTranslation" in writes[0].settings, false);
  assert.equal("disableAutoplay" in writes[0].settings, false);
});

test("rejects imports without recognized configuration keys", async () => {
  const { elements, writes } = await loadPopup({ autoResolveWrites: true });
  elements["import-file"].files = [{
    text: async () => JSON.stringify({ unknown: true }),
  }];

  elements["import-file"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 0);
  assert.equal(elements["toast"].textContent, "Invalid config: no recognized keys");
  assert.equal(elements["block-homepage"].disabled, false);
});

test("disables editing while an import is in progress", async () => {
  const importRead = deferred();
  let readCount = 0;
  const { elements, writes } = await loadPopup({
    autoResolveWrites: true,
    getSettings: async () => {
      readCount += 1;
      if (readCount === 1) return { blockAll: true };
      if (readCount === 2) return importRead.promise;
      return { blockAll: true, blockHomepage: true };
    },
  });
  elements["import-file"].files = [{
    text: async () => JSON.stringify({ blockHomepage: true }),
  }];

  elements["import-file"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements["block-sub-home"].disabled, true);
  assert.equal(elements["import-config"].disabled, true);

  importRead.resolve({ blockAll: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.blockHomepage, true);
  assert.equal(writes[0].settings.blockSubHome, false);
  assert.equal(elements["block-homepage"].checked, true);
  assert.equal(elements["block-sub-home"].disabled, false);
  assert.equal(elements["import-config"].disabled, false);
});

test("loads and saves typed scroll settings and disables dependent controls", async () => {
  const { elements, writes } = await loadPopup({ autoResolveWrites: true,
    storedSettings: { limitInfiniteScroll: true, scrollLimit: 7, scrollMode: "button" },
  });
  assert.equal(elements["scroll-limit"].value, "7");
  assert.equal(elements["scroll-mode"].value, "button");
  assert.equal(elements["scroll-limit"].disabled, false);
  elements["scroll-limit"].value = "12";
  elements["scroll-limit"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.at(-1).settings.scrollLimit, 12);
  assert.equal(writes.at(-1).settings.scrollMode, "button");
  elements["scroll-limit"].value = "0";
  elements["scroll-limit"].dispatch("change");
  assert.equal(elements["scroll-limit"].value, "12");
  elements["limit-infinite-scroll"].checked = false;
  elements["limit-infinite-scroll"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements["scroll-limit"].disabled, true);
  assert.equal(elements["scroll-mode"].disabled, true);
  assert.equal(writes.at(-1).settings.scrollLimit, 12);
});

test("imports typed scroll preferences without dropping unrelated settings", async () => {
  const { elements, writes } = await loadPopup({ autoResolveWrites: true,
    storedSettings: { hideComments: true, scrollLimit: 8 },
  });
  elements["import-file"].files = [{ text: async () => JSON.stringify({
    limitInfiniteScroll: true, scrollLimit: 13, scrollMode: "button",
  }) }];
  elements["import-file"].dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.at(-1).settings.hideComments, true);
  assert.equal(writes.at(-1).settings.scrollLimit, 13);
  assert.equal(elements["scroll-mode"].value, "button");
  assert.equal(elements["scroll-limit"].disabled, false);
});
