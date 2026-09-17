/**
 * Compiles DeReddit settings into Manifest V3 declarative navigation rules.
 * The content script uses the same route model for client-side navigation.
 */
DeReddit.NAVIGATION_RULE_ID_START = 1000;
DeReddit.NAVIGATION_RULE_ID_END = 1000000;
DeReddit.NAVIGATION_RULE_LIMIT = 1000;

DeReddit.isNavigationRuleId = function (id) {
  return Number.isInteger(id)
    && id >= DeReddit.NAVIGATION_RULE_ID_START
    && id < DeReddit.NAVIGATION_RULE_ID_END;
};

DeReddit.createNavigationRules = function (settings, blockPageUrl) {
  if (typeof blockPageUrl !== "string" || !blockPageUrl) {
    throw new TypeError("A block page URL is required");
  }

  const config = DeReddit.coerceSettings(settings);
  const rules = [];
  const reddit = "^https?://([^/]+\\.)?reddit\\.com(:[0-9]+)?";
  const query = "(\\?.*)?$";
  let nextId = DeReddit.NAVIGATION_RULE_ID_START;

  function add(regexFilter, route, priority) {
    if (rules.length >= DeReddit.NAVIGATION_RULE_LIMIT) return false;
    if (nextId >= DeReddit.NAVIGATION_RULE_ID_END) {
      throw new RangeError("Too many navigation rules");
    }

    const params = new URLSearchParams();
    if (route.type === "page") params.set("page", route.page);
    if (route.type === "subreddit") params.set("target", "subreddit");
    if (route.filter) params.set("filter", route.filter);

    rules.push({
      id: nextId,
      priority,
      action: {
        type: "redirect",
        redirect: {
          // The original request is kept in the fragment. It remains local to
          // the extension page and can contain its own query string safely.
          regexSubstitution: `${blockPageUrl}?${params.toString()}#\\0`,
        },
      },
      condition: {
        regexFilter,
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"],
      },
    });
    nextId += 1;
    return true;
  }

  const pageRules = [
    ["blockHomepage", "homepage", "Homepage", `${reddit}/?${query}`],
    ["blockAll", "all", "r/all", `${reddit}/r/all(/.*)?${query}`],
    ["blockPopular", "popular", "r/popular", `${reddit}/r/popular(/.*)?${query}`],
    ["blockNew", "new", "r/new", `${reddit}/new(/.*)?${query}`],
    ["blockTop", "top", "r/top", `${reddit}/top(/.*)?${query}`],
  ];
  for (const [key, page, filter, regexFilter] of pageRules) {
    if (config[key]) add(regexFilter, { type: "page", page, filter }, 30);
  }

  const sorts = "(top|hot|new|rising|best|controversial)";
  const frontSuffix = `(/${sorts}(/.*)?)?/*${query}`;
  if (config.blockSubHome) {
    add(
      `${reddit}/r/[a-z0-9_]+${frontSuffix}`,
      { type: "page", page: "subhome", filter: "All Sub Fronts" },
      20,
    );
  }

  for (const entry of config.blockedSubreddits) {
    const subredditPattern = entry.name
      .split("*")
      .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"))
      .join("[a-z0-9_]*");
    const suffix = entry.mode === "all" ? `(/.*)?${query}` : frontSuffix;
    if (!add(
      `${reddit}/r/${subredditPattern}${suffix}`,
      { type: "subreddit", filter: entry.name },
      10,
    )) break;
  }

  return rules;
};
