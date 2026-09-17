/**
 * DeReddit background event handler.
 * Keeps MV3 declarative navigation rules synchronized with stored settings.
 */

const OBSOLETE_STORAGE_KEYS = ["blockNsfw"];
let ruleSyncQueue = Promise.resolve();

function replaceNavigationRules() {
  return Promise.all([
    chrome.storage.local.get(DeReddit.STORAGE_KEYS),
    chrome.declarativeNetRequest.getDynamicRules(),
  ]).then(([storedSettings, currentRules]) => {
    const removeRuleIds = currentRules
      .filter(({ id }) => DeReddit.isNavigationRuleId(id))
      .map(({ id }) => id);
    const addRules = DeReddit.createNavigationRules(
      storedSettings,
      chrome.runtime.getURL("blocked/index.html"),
    );

    return chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules,
    });
  });
}

function syncNavigationRules() {
  ruleSyncQueue = ruleSyncQueue
    .catch(() => undefined)
    .then(replaceNavigationRules);
  return ruleSyncQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local
    .remove(OBSOLETE_STORAGE_KEYS)
    .then(syncNavigationRules)
    .catch((error) => console.error("Could not migrate DeReddit settings:", error));
});

chrome.runtime.onStartup.addListener(() => {
  void syncNavigationRules().catch((error) => {
    console.error("Could not initialize DeReddit navigation rules:", error);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!Object.keys(changes).some((key) => DeReddit.STORAGE_KEYS.includes(key))) return;

  void syncNavigationRules().catch((error) => {
    console.error("Could not update DeReddit navigation rules:", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === "openSettings") {
    chrome.tabs
      .create({ url: chrome.runtime.getURL("popup/index.html?standalone=true") })
      .then(
        () => sendResponse({ success: true }),
        (error) => sendResponse({ success: false, error: error.message }),
      );
    return true;
  }

  if (message?.action === "syncNavigationRules") {
    syncNavigationRules().then(
      () => sendResponse({ success: true }),
      (error) => sendResponse({ success: false, error: error.message }),
    );
    return true;
  }

  return false;
});

void syncNavigationRules().catch((error) => {
  console.error("Could not initialize DeReddit navigation rules:", error);
});
