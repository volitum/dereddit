/**
 * DeReddit - Content Script
 * Handles filtering posts and SPA navigation blocking.
 */

const settingsStore = DeReddit.createSettingsStore(chrome.storage.local, {
  onLoadError(error) {
    console.error("Could not load DeReddit settings:", error);
  },
});
let config = settingsStore.get();
let configLoaded = false;
let lastCheckedUrl = "";
let observer = null;
let processingScheduled = false;
let postFilteringActive = false;
let communityFilteringActive = false;
const feedLimiter = DeReddit.createFeedLimiter({
  getSettings: () => config,
  isBlocked: ({ subreddit }) => isSubredditNameBlocked(subreddit),
});

const HIDDEN_STYLE_ID = "dereddit-hidden-style";
const HIDDEN_ELEMENT_TYPES = Object.freeze({
  post: Object.freeze({
    datasetKey: "deredditPostHidden",
    selector: '[data-dereddit-post-hidden="true"]',
  }),
  community: Object.freeze({
    datasetKey: "deredditCommunityHidden",
    selector: '[data-dereddit-community-hidden="true"]',
  }),
});
const HIDDEN_STYLE_TEXT = Object.values(HIDDEN_ELEMENT_TYPES)
  .map(({ selector }) => selector)
  .join(", ") + " { display: none !important; }";

const POST_ROOT_SELECTORS = [
  '[data-testid="post-container"]',
  '[data-testid="post"]',
  "[data-post-id]",
  ".Post",
  "shreddit-post",
  ".thing",
  "article",
  '[role="article"]',
  ".post-container",
];
const POST_FALLBACK_SELECTORS = [
  '[data-click-id="body"]',
  "[data-ks-id]",
];
const POST_ROOT_SELECTOR = POST_ROOT_SELECTORS.join(", ");
const POST_SELECTOR = [...POST_ROOT_SELECTORS, ...POST_FALLBACK_SELECTORS].join(", ");
const POST_PERMALINK_SELECTOR = 'a[href*="/comments/"]';
const COMMENT_SELECTOR = [
  "shreddit-comment",
  "shreddit-comment-tree",
  '[data-testid="comment"]',
  '[data-testid="comment-tree"]',
  ".Comment",
  ".comment",
].join(", ");
const NAVBAR_SELECTOR = [
  "#header",
  "#shreddit-header",
  "reddit-header-large",
  "reddit-header-small",
  "shreddit-app > header",
  'header[role="banner"]',
].join(", ");
// Shreddit reserves space for its fixed navbar separately from the header itself.
// Reset both layout variables at their roots so padding and sticky offsets collapse.
const NAVBAR_LAYOUT_STYLE = ":root, body, shreddit-app { --shreddit-header-height: 0px !important; --header-height: 0px !important; }";
const LEFT_SIDEBAR_SELECTOR = [
  "#left-sidebar-container",
  "#left-sidebar",
].join(", ");
// Match component names and internal identifiers, never translated labels or text.
const RIGHT_SIDEBAR_SELECTOR = [
  "#right-sidebar-container",
  "#right-sidebar",
  ".right-sidebar",
  '[data-testid="right-sidebar"]',
  '[data-testid="right-sidebar-container"]',
  ".side",
  "pdp-right-rail",
  "aside:has(> pdp-right-rail)",
].join(", ");
const POPULAR_COMMUNITIES_SELECTOR = [
  '[data-testid*="popular-communities" i]',
  "popular-communities",
  "shreddit-popular-communities",
  "#right-sidebar-container",
  '[data-testid*="right-sidebar" i]',
  "aside",
].join(", ");

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  config = settingsStore.applyChanges(changes);
  if (configLoaded) feedLimiter.update();

  void checkCurrentPage({ force: true });
  void filterPosts();
});

async function loadConfig() {
  config = await settingsStore.load();
  configLoaded = true;
  feedLimiter.update();
  return config;
}

async function checkCurrentPage({ force = false } = {}) {
  await loadConfig();

  const currentUrl = window.location.href;
  if (!force && currentUrl === lastCheckedUrl) return;
  lastCheckedUrl = currentUrl;
  const path = window.location.pathname;
  const route = DeReddit.getBlockedRoute(path, config);
  if (route) {
    redirectToBlock(route, currentUrl);
  }
}

function redirectToBlock(route, returnUrl) {
  window.location.replace(
    chrome.runtime.getURL("blocked/index.html") + DeReddit.blockedRouteToQuery(route, returnUrl)
  );
}

function getPostSubredditNames(postElement) {
  const names = new Set();
  const attributeNames = [
    "subreddit-name",
    "subreddit-prefixed-name",
    "data-subreddit",
    "data-subreddit-prefixed",
  ];

  for (const attributeName of attributeNames) {
    const name = DeReddit.normalizeSubredditName(postElement.getAttribute(attributeName));
    if (name) names.add(name);
  }

  if (names.size > 0) return names;

  for (const link of postElement.querySelectorAll('a[href*="/r/"]')) {
    const nestedPost = link.closest(POST_ROOT_SELECTOR);
    if (nestedPost && nestedPost !== postElement) continue;

    try {
      const href = link.getAttribute("href");
      const url = DeReddit.getRedditUrl(href, window.location.origin);
      const subreddit = url && DeReddit.getSubredditPath(url.pathname);
      if (subreddit) names.add(subreddit.name);
    } catch {
      // Ignore malformed links injected by page content.
    }
  }

  return names;
}

function isSubredditNameBlocked(subredditName) {
  for (const entry of config.blockedSubreddits) {
    if (entry.mode === "all" && DeReddit.matchesSubredditPattern(entry.name, subredditName)) {
      return true;
    }
  }

  return false;
}

function containsBlockedSubreddit(subredditNames) {
  return Array.from(subredditNames).some(isSubredditNameBlocked);
}

function getPostPermalink(link) {
  const url = DeReddit.getRedditUrl(link.getAttribute("href"), window.location.origin);
  if (!url) return null;

  const subreddit = DeReddit.getSubredditPath(url.pathname);
  if (!subreddit || !/^comments\/[^/]+(?:\/|$)/i.test(subreddit.rest)) return null;

  return { subreddit: subreddit.name, pathname: url.pathname.toLowerCase() };
}

function getLinkedPostContainer(link) {
  if (link.closest(COMMENT_SELECTOR)) return null;

  const knownContainer = link.closest(POST_ROOT_SELECTOR) || link.closest(POST_SELECTOR);
  if (knownContainer) return knownContainer;

  let container = link;
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = container.parentElement;
    if (!parent || parent.matches("main, body, html")) break;

    const postPaths = new Set();
    for (const postLink of parent.querySelectorAll(POST_PERMALINK_SELECTOR)) {
      const permalink = getPostPermalink(postLink);
      if (permalink) postPaths.add(permalink.pathname);
      if (postPaths.size > 1) break;
    }

    if (postPaths.size > 1) break;
    container = parent;
  }

  return container;
}

function collectPostCandidates() {
  const candidates = new Map();

  document.querySelectorAll(POST_SELECTOR).forEach((post) => {
    candidates.set(post, getPostSubredditNames(post));
  });

  document.querySelectorAll(POST_PERMALINK_SELECTOR).forEach((link) => {
    const permalink = getPostPermalink(link);
    if (!permalink) return;

    const post = getLinkedPostContainer(link);
    if (!post) return;

    if (!candidates.has(post)) candidates.set(post, new Set());
    candidates.get(post).add(permalink.subreddit);
  });

  return candidates;
}

async function filterPosts() {
  await loadConfig();
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => void filterPosts(), { once: true });
    return;
  }
  ensureHiddenStyle();

  if (!observer) {
    observer = new MutationObserver(() => {
      void checkCurrentPage();
      scheduleContentProcessing();
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "subreddit-name", "subreddit-prefixed-name", "data-subreddit",
        "href"],
    });
  }

  processFilteredContent();
}

function ensureHiddenStyle() {
  // CSS rules also cover elements inserted later, without additional DOM scans.
  const styleText = HIDDEN_STYLE_TEXT + (config.hideComments
    ? `\n${COMMENT_SELECTOR} { display: none !important; }`
    : "") + (config.hideNavbar
    ? `\n${NAVBAR_SELECTOR} { display: none !important; }\n${NAVBAR_LAYOUT_STYLE}`
    : "") + (config.hideLeftSidebar
    ? `\n${LEFT_SIDEBAR_SELECTOR} { display: none !important; }`
    : "") + (config.hideRelatedPosts
    ? `\n${RIGHT_SIDEBAR_SELECTOR} { display: none !important; }`
    : "");
  const existingStyle = document.getElementById(HIDDEN_STYLE_ID);
  if (existingStyle) {
    if (existingStyle.textContent !== styleText) existingStyle.textContent = styleText;
    return;
  }

  const style = document.createElement("style");
  style.id = HIDDEN_STYLE_ID;
  style.textContent = styleText;
  document.documentElement.appendChild(style);
}

function scheduleContentProcessing() {
  if (processingScheduled) return;
  processingScheduled = true;

  requestAnimationFrame(() => {
    processingScheduled = false;
    processFilteredContent();
  });
}

function processFilteredContent() {
  const shouldFilterPosts = config.blockedSubreddits.some((entry) => entry.mode === "all");
  const shouldFilterCommunities = config.blockSubHome
    || config.blockedSubreddits.length > 0;

  if (shouldFilterPosts) {
    processPostElements();
  } else if (postFilteringActive) {
    clearBlockedElements("post");
  }

  if (shouldFilterCommunities) {
    processPopularCommunities();
  } else if (communityFilteringActive) {
    clearBlockedElements("community");
  }

  postFilteringActive = shouldFilterPosts;
  communityFilteringActive = shouldFilterCommunities;
}

function processPostElements() {
  reconcileCandidateElements(
    "post",
    collectPostCandidates(),
    (subredditNames) => containsBlockedSubreddit(subredditNames),
  );
}

function setElementBlocked(element, blocked, type) {
  const { datasetKey } = HIDDEN_ELEMENT_TYPES[type];
  if (blocked) {
    element.dataset[datasetKey] = "true";
  } else if (element.dataset[datasetKey] === "true") {
    delete element.dataset[datasetKey];
  }
}

function clearBlockedElements(type) {
  clearStaleBlockedElements(type, new Set());
}

function clearStaleBlockedElements(type, currentElements) {
  const { datasetKey, selector } = HIDDEN_ELEMENT_TYPES[type];
  document.querySelectorAll(selector).forEach((element) => {
    if (!currentElements.has(element)) delete element.dataset[datasetKey];
  });
}

function reconcileCandidateElements(type, candidates, isBlocked) {
  clearStaleBlockedElements(type, new Set(candidates.keys()));
  candidates.forEach((subredditNames, element) => {
    setElementBlocked(element, isBlocked(subredditNames, element), type);
  });
}

function isSubredditFrontBlocked(subredditName) {
  return Boolean(DeReddit.getBlockedRoute(`/r/${subredditName}`, config));
}

function getPopularCommunityPanels() {
  const panels = new Set();

  document.querySelectorAll(POPULAR_COMMUNITIES_SELECTOR).forEach((panel) => {
    const subredditNames = new Set();
    for (const link of panel.querySelectorAll('a[href*="/r/"]')) {
      const subreddit = getCommunitySubreddit(link);
      if (subreddit) subredditNames.add(subreddit.name);
      if (subredditNames.size > 1) {
        panels.add(panel);
        break;
      }
    }
  });

  return panels;
}

function getCommunitySubreddit(link) {
  const url = DeReddit.getRedditUrl(link.getAttribute("href"), window.location.origin);
  if (!url) return null;

  const subreddit = DeReddit.getSubredditPath(url.pathname);
  return subreddit && subreddit.rest === "" ? subreddit : null;
}

function getCommunityListItem(link, panel) {
  const listItem = link.closest('li, [role="listitem"]');
  if (listItem && panel.contains(listItem)) return listItem;

  const semanticItem = link.closest(
    '[data-testid*="community" i], [data-testid*="subreddit" i]'
  );
  if (semanticItem && panel.contains(semanticItem)) return semanticItem;

  let item = link;
  for (let depth = 0; depth < 6; depth += 1) {
    const parent = item.parentElement;
    if (!parent || parent === panel) break;

    const subredditNames = new Set();
    for (const communityLink of parent.querySelectorAll('a[href*="/r/"]')) {
      const subreddit = getCommunitySubreddit(communityLink);
      if (subreddit) subredditNames.add(subreddit.name);
      if (subredditNames.size > 1) break;
    }

    if (subredditNames.size > 1) break;
    item = parent;
  }

  return item;
}

function collectCommunityCandidates() {
  const candidates = new Map();

  getPopularCommunityPanels().forEach((panel) => {
    panel.querySelectorAll('a[href*="/r/"]').forEach((link) => {
      const subreddit = getCommunitySubreddit(link);
      if (!subreddit) return;

      const item = getCommunityListItem(link, panel);
      if (!candidates.has(item)) candidates.set(item, new Set());
      candidates.get(item).add(subreddit.name);
    });
  });

  return candidates;
}

function processPopularCommunities() {
  reconcileCandidateElements(
    "community",
    collectCommunityCandidates(),
    (subredditNames) => Array.from(subredditNames).some(isSubredditFrontBlocked),
  );
}

function setupUrlChangeMonitor() {
  setInterval(() => void checkCurrentPage(), 1000);
  window.addEventListener("popstate", () => void checkCurrentPage());
}

void checkCurrentPage();
void filterPosts();
setupUrlChangeMonitor();
