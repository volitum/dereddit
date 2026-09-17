/**
 * DeReddit - Shared helpers
 */

var DeReddit = (() => {
  const DEFAULT_SETTINGS = Object.freeze({
    blockedSubreddits: Object.freeze([]),
    blockHomepage: false,
    blockAll: false,
    blockPopular: false,
    blockNew: false,
    blockTop: false,
    blockSubHome: false,
    hideComments: false,
    hideNavbar: false,
    hideLeftSidebar: false,
    // Keep the legacy storage key for the right sidebar toggle and older exports.
    hideRelatedPosts: false,
    limitInfiniteScroll: false,
    scrollLimit: 25,
    scrollMode: "fixed",
  });
  const STORAGE_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));

  const PAGE_RULES = [
    { key: "blockHomepage", page: "homepage", filter: "Homepage", pattern: /^\/?$/ },
    { key: "blockAll", page: "all", filter: "r/all", pattern: /^\/r\/all(?:\/.*)?$/i },
    { key: "blockPopular", page: "popular", filter: "r/popular", pattern: /^\/r\/popular(?:\/.*)?$/i },
    { key: "blockNew", page: "new", filter: "r/new", pattern: /^\/new(?:\/.*)?$/i },
    { key: "blockTop", page: "top", filter: "r/top", pattern: /^\/top(?:\/.*)?$/i },
  ];

  const SUBREDDIT_SORTS = new Set(["top", "hot", "new", "rising", "best", "controversial"]);
  const REDDIT_HOST_PATTERN = /(^|\.)reddit\.com$/i;

  function getRedditUrl(value, baseUrl) {
    if (typeof value !== "string" && !(value instanceof URL)) return null;

    try {
      const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
      const isWebUrl = url.protocol === "http:" || url.protocol === "https:";
      return isWebUrl && REDDIT_HOST_PATTERN.test(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }

  function normalizeSubredditName(value) {
    if (typeof value !== "string") return "";

    let name = value.trim().toLowerCase();
    if (!name) return "";

    let cameFromRedditUrl = false;
    try {
      const looksLikeUrl = /^https?:\/\//i.test(name);
      const looksLikeRedditHost = /^(?:[\w-]+\.)?reddit\.com(?:\/|$)/i.test(name);
      if (looksLikeUrl || looksLikeRedditHost) {
        const url = getRedditUrl(looksLikeUrl ? name : `https://${name}`);
        if (!url) return "";

        name = url.pathname;
        cameFromRedditUrl = true;
      }
    } catch {
      return "";
    }

    name = name.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, "");

    const pattern = cameFromRedditUrl
      ? /^r\/([a-z0-9_*]+)(?:\/.*)?$/i
      : /^(?:r\/)?([a-z0-9_*]+)(?:\/.*)?$/i;
    const subredditPathMatch = name.match(pattern);
    if (!subredditPathMatch) return "";

    const normalized = subredditPathMatch[1].replace(/\*+/g, "*");
    return /[a-z0-9_]/.test(normalized) ? normalized : "";
  }

  function matchesSubredditPattern(pattern, subredditName) {
    const normalizedPattern = normalizeSubredditName(pattern);
    const normalizedSubreddit = normalizeSubredditName(subredditName);
    if (!normalizedPattern || !normalizedSubreddit) return false;
    if (normalizedPattern === normalizedSubreddit) return true;
    if (!normalizedPattern.includes("*")) return false;

    const regexSource = normalizedPattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${regexSource}$`, "i").test(normalizedSubreddit);
  }

  function normalizeMode(mode) {
    return mode === "all" ? "all" : "home";
  }

  function normalizeBlockedEntry(entry) {
    if (typeof entry === "string") {
      const name = normalizeSubredditName(entry);
      return name ? { name, mode: "home" } : null;
    }

    if (!entry || typeof entry !== "object") return null;
    const name = normalizeSubredditName(entry.name);
    return name ? { name, mode: normalizeMode(entry.mode) } : null;
  }

  function normalizeBlockedSubreddits(entries = []) {
    if (!Array.isArray(entries)) return [];

    const deduped = new Map();
    for (const entry of entries) {
      const normalized = normalizeBlockedEntry(entry);
      if (!normalized) continue;
      deduped.set(`${normalized.name}:${normalized.mode}`, normalized);
    }
    return Array.from(deduped.values());
  }

  function coerceSettings(values = {}) {
    const source = values && typeof values === "object" ? values : {};
    const settings = { ...DEFAULT_SETTINGS, blockedSubreddits: [] };
    for (const key of STORAGE_KEYS) {
      if (!(key in source)) continue;
      if (key === "blockedSubreddits") {
        settings[key] = normalizeBlockedSubreddits(source[key]);
      } else if (key === "scrollLimit") {
        settings[key] = Number.isSafeInteger(source[key]) && source[key] > 0
          ? source[key] : DEFAULT_SETTINGS.scrollLimit;
      } else if (key === "scrollMode") {
        settings[key] = source[key] === "button" ? "button" : "fixed";
      } else {
        settings[key] = source[key] === true;
      }
    }
    return settings;
  }

  function applyStorageChanges(settings, changes = {}) {
    const source = changes && typeof changes === "object" ? changes : {};
    const updates = {};
    for (const key of STORAGE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        updates[key] = source[key]?.newValue;
      }
    }
    return coerceSettings({ ...coerceSettings(settings), ...updates });
  }

  function createSettingsStore(storageArea, { onLoadError } = {}) {
    let settings = coerceSettings();
    let loaded = false;
    let loadPromise = null;
    let pendingChanges = {};

    function applyChanges(changes) {
      if (!loaded) {
        pendingChanges = { ...pendingChanges, ...changes };
      }
      settings = applyStorageChanges(settings, changes);
      return settings;
    }

    function load() {
      if (loaded) return Promise.resolve(settings);

      if (!loadPromise) {
        loadPromise = storageArea
          .get(STORAGE_KEYS)
          .then((storedSettings) => {
            settings = applyStorageChanges(
              coerceSettings(storedSettings),
              pendingChanges,
            );
          })
          .catch((error) => {
            settings = coerceSettings(settings);
            onLoadError?.(error);
          })
          .then(() => {
            loaded = true;
            pendingChanges = {};
            return settings;
          })
          .finally(() => {
            loadPromise = null;
          });
      }

      return loadPromise;
    }

    return Object.freeze({
      applyChanges,
      get: () => settings,
      load,
    });
  }

  function getSubredditPath(pathname) {
    if (typeof pathname !== "string") return null;

    const match = pathname.match(/^\/r\/([^/]+)(?:\/(.*))?$/i);
    if (!match) return null;

    const name = normalizeSubredditName(match[1]);
    if (!name) return null;

    return {
      name,
      rest: (match[2] || "").replace(/\/+$/, "").toLowerCase(),
    };
  }

  function isSubredditFrontPath(pathname) {
    const subreddit = getSubredditPath(pathname);
    if (!subreddit) return false;
    const [firstSegment] = subreddit.rest.split("/");
    return subreddit.rest === "" || SUBREDDIT_SORTS.has(firstSegment);
  }

  function getBlockedRoute(pathname, settings) {
    const config = coerceSettings(settings);

    for (const rule of PAGE_RULES) {
      if (config[rule.key] && rule.pattern.test(pathname)) {
        return { type: "page", page: rule.page, filter: rule.filter };
      }
    }

    const subreddit = getSubredditPath(pathname);
    if (!subreddit) return null;

    const subredditFront = isSubredditFrontPath(pathname);
    if (config.blockSubHome && subredditFront) {
      return {
        type: "page",
        page: "subhome",
        subreddit: subreddit.name,
        filter: "All Sub Fronts",
      };
    }

    for (const entry of config.blockedSubreddits) {
      if (!matchesSubredditPattern(entry.name, subreddit.name)) continue;
      if (entry.mode === "all" || (entry.mode === "home" && subredditFront)) {
        return { type: "subreddit", subreddit: subreddit.name, filter: entry.name };
      }
    }

    return null;
  }

  function isFeedPath(pathname) {
    return /^\/(?:best|hot|new|top|rising|controversial)?\/?$/i.test(pathname)
      || /^\/r\/[^/]+(?:\/(?:best|hot|new|top|rising|controversial))?\/?$/i.test(pathname);
  }

  function blockedRouteToQuery(route, returnUrl = "") {
    if (!route) return "";

    const params = new URLSearchParams();
    if (route.type === "page") {
      params.set("page", route.page);
    } else {
      params.set("subreddit", route.subreddit);
    }

    if (returnUrl) params.set("returnUrl", returnUrl);
    if (route.filter) params.set("filter", route.filter);
    return `?${params.toString()}`;
  }

  return {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    applyStorageChanges,
    createSettingsStore,
    coerceSettings,
    getBlockedRoute,
    getSubredditPath,
    getRedditUrl,
    matchesSubredditPattern,
    normalizeBlockedSubreddits,
    normalizeSubredditName,
    blockedRouteToQuery,
    isFeedPath,
  };
})();
