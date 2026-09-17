/**
 * DeReddit - Popup Script
 * Handles settings, import/export, and auto-save.
 */

document.addEventListener("DOMContentLoaded", () => {
  if (
    new URLSearchParams(globalThis.location?.search).get("standalone") ===
    "true"
  ) {
    document.body.classList.add("standalone");
  }

  // Keep panels mounted: switching sections must preserve edits and scroll position.
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  function selectTab(selectedTab) {
    for (const tab of tabs) {
      const selected = tab === selectedTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden =
        !selected;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        nextIndex = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  }

  const blockedListEl = document.getElementById("blocked-list");
  const blockedCount = document.getElementById("blocked-count");
  const addBtn = document.getElementById("add-subreddit");
  const addCurrent = document.getElementById("add-current-subreddit");
  const saveIndicator = document.getElementById("save-indicator");
  const toast = document.getElementById("toast");
  const exportBtn = document.getElementById("export-config");
  const importBtn = document.getElementById("import-config");
  const importFile = document.getElementById("import-file");
  const scrollLimit = document.getElementById("scroll-limit");
  const scrollMode = document.getElementById("scroll-mode");

  const checkboxIds = {
    blockHomepage: "block-homepage",
    blockPopular: "block-popular",
    blockSubHome: "block-sub-home",
    hideComments: "hide-comments",
    hideNavbar: "hide-navbar",
    hideLeftSidebar: "hide-left-sidebar",
    hideRelatedPosts: "hide-right-sidebar",
    limitInfiniteScroll: "limit-infinite-scroll",
  };
  const checkboxes = Object.fromEntries(
    Object.entries(checkboxIds).map(([key, id]) => [
      key,
      document.getElementById(id),
    ]),
  );

  let entries = [];
  let toastTimer = null;
  let indicatorTimer = null;
  let debounceTimer = null;
  let saveQueue = Promise.resolve();
  let latestSaveId = 0;
  let controlsDisabled = false;
  let lastScrollLimit = DeReddit.DEFAULT_SETTINGS.scrollLimit;

  function setControlsDisabled(disabled) {
    controlsDisabled = disabled;
    for (const control of [
      ...Object.values(checkboxes),
      addBtn,
      addCurrent,
      exportBtn,
      importBtn,
      importFile,
      scrollLimit,
      scrollMode,
    ]) {
      control.disabled = disabled;
    }

    blockedListEl
      .querySelectorAll("input, select, button")
      .forEach((control) => {
        control.disabled = disabled;
      });
    updateScrollControls();
  }

  function updateScrollControls() {
    const disabled =
      controlsDisabled || !checkboxes.limitInfiniteScroll.checked;
    scrollLimit.disabled = disabled;
    scrollMode.disabled = disabled;
  }

  function showToast(message, type = "info") {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `show ${type}`;
    toastTimer = setTimeout(() => {
      toast.className = "";
    }, 2500);
  }

  function showSaving() {
    clearTimeout(indicatorTimer);
    saveIndicator.textContent = "Saving...";
    saveIndicator.classList.add("visible");
  }

  function showSaved(saveId) {
    if (saveId !== latestSaveId) return;

    clearTimeout(indicatorTimer);
    saveIndicator.textContent = "Saved";
    indicatorTimer = setTimeout(
      () => saveIndicator.classList.remove("visible"),
      1200,
    );
  }

  function getCheckboxSettings() {
    return Object.fromEntries(
      Object.entries(checkboxes).map(([key, checkbox]) => [
        key,
        checkbox.checked,
      ]),
    );
  }

  function getSettingsSnapshot() {
    return {
      ...getCheckboxSettings(),
      blockedSubreddits: DeReddit.normalizeBlockedSubreddits(entries),
      scrollLimit: lastScrollLimit,
      scrollMode: scrollMode.value === "button" ? "button" : "fixed",
    };
  }

  function queueSave() {
    const saveId = ++latestSaveId;
    const snapshot = getSettingsSnapshot();
    updateBlockedCount();
    showSaving();

    enqueueStorageWrite(snapshot);
    saveQueue.then(
      () => showSaved(saveId),
      (error) => showToast(`Save failed: ${error.message}`, "error"),
    );
    return saveQueue;
  }

  function enqueueStorageWrite(settings) {
    return enqueueStorageOperation(() => chrome.storage.local.set(settings));
  }

  function enqueueStorageOperation(operation) {
    saveQueue = saveQueue.catch(() => undefined).then(operation);
    return saveQueue;
  }

  function scheduleAutoSave(immediate = false) {
    clearTimeout(debounceTimer);
    debounceTimer = null;

    if (immediate) {
      queueSave();
      return;
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      queueSave();
    }, 700);
  }

  async function flushPendingSave() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      queueSave();
    }

    await saveQueue;
  }

  function sortEntries() {
    entries.sort((a, b) => {
      if (!a.name && !b.name) return 0;
      if (!a.name) return -1;
      if (!b.name) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  function renderEmptyState() {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const icon = document.createElement("span");
    icon.textContent = "-";

    empty.appendChild(icon);
    empty.appendChild(document.createTextNode("No subreddits blocked yet"));
    blockedListEl.appendChild(empty);
  }

  function updateBlockedCount() {
    const count = DeReddit.normalizeBlockedSubreddits(entries).length;
    blockedCount.textContent = `${count} ${count === 1 ? "rule" : "rules"}`;
  }

  function renderList() {
    blockedListEl.innerHTML = "";
    updateBlockedCount();

    if (entries.length === 0) {
      renderEmptyState();
      return;
    }

    sortEntries();
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "blocked-item";

      const input = document.createElement("input");
      input.type = "text";
      input.value = entry.name;
      input.placeholder = "Subreddit, wildcard, or Reddit URL";
      input.setAttribute("aria-label", "Subreddit, wildcard, or Reddit URL");
      input.spellcheck = false;
      input.disabled = controlsDisabled;

      const select = document.createElement("select");
      select.className = "mode-badge";
      select.setAttribute("aria-label", "Block mode");
      select.disabled = controlsDisabled;
      for (const mode of ["home", "all"]) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = mode.toUpperCase();
        option.selected = entry.mode === mode;
        select.appendChild(option);
      }

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.title = "Remove";
      removeBtn.setAttribute("aria-label", "Remove subreddit rule");
      removeBtn.textContent = "x";
      removeBtn.disabled = controlsDisabled;

      input.addEventListener("input", (event) => {
        entry.name = event.target.value;
        scheduleAutoSave();
      });
      input.addEventListener("blur", (event) => {
        const normalizedName = DeReddit.normalizeSubredditName(
          event.target.value,
        );
        entry.name = normalizedName;
        event.target.value = normalizedName;
        scheduleAutoSave(true);
      });
      select.addEventListener("change", (event) => {
        entry.mode = event.target.value === "all" ? "all" : "home";
        scheduleAutoSave(true);
      });
      removeBtn.addEventListener("click", () => {
        const entryIndex = entries.indexOf(entry);
        if (entryIndex < 0) return;
        entries.splice(entryIndex, 1);
        renderList();
        scheduleAutoSave(true);
      });

      item.appendChild(input);
      item.appendChild(select);
      item.appendChild(removeBtn);
      blockedListEl.appendChild(item);
    });
  }

  function focusEntry(name, animate) {
    const normalizedName = DeReddit.normalizeSubredditName(name);
    const allItems = blockedListEl.querySelectorAll(".blocked-item");
    const target = normalizedName
      ? Array.from(allItems).find(
          (el) => el.querySelector("input").value === normalizedName,
        )
      : allItems[0];

    if (!target) return;
    if (animate) target.classList.add("pop-in");
    target.querySelector("input").focus();
  }

  function addEntry(name = "", mode = "all", animate = true) {
    const normalizedName = DeReddit.normalizeSubredditName(name);
    entries.unshift({
      name: normalizedName,
      mode: mode === "all" ? "all" : "home",
    });
    renderList();
    focusEntry(normalizedName, animate);

    if (normalizedName) scheduleAutoSave(true);
  }

  async function loadSettings() {
    const result = DeReddit.coerceSettings(
      await chrome.storage.local.get(DeReddit.STORAGE_KEYS),
    );

    entries = result.blockedSubreddits;
    scrollLimit.value = String(result.scrollLimit);
    lastScrollLimit = result.scrollLimit;
    scrollMode.value = result.scrollMode;
    Object.entries(checkboxes).forEach(([key, checkbox]) => {
      checkbox.checked = result[key];
    });
    renderList();
  }

  async function exportConfig() {
    try {
      await flushPendingSave();
      const data = DeReddit.coerceSettings(
        await chrome.storage.local.get(DeReddit.STORAGE_KEYS),
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "dereddit-config.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast("Configuration exported!", "success");
    } catch (error) {
      showToast(`Export failed: ${error.message}`, "error");
    }
  }

  async function importConfig(file) {
    setControlsDisabled(true);
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        showToast("Invalid config: expected a JSON object", "error");
        return;
      }

      const filtered = Object.fromEntries(
        Object.entries(data).filter(([key]) =>
          DeReddit.STORAGE_KEYS.includes(key),
        ),
      );

      if (Object.keys(filtered).length === 0) {
        showToast("Invalid config: no recognized keys", "error");
        return;
      }

      await flushPendingSave();
      await enqueueStorageOperation(async () => {
        const current = await chrome.storage.local.get(DeReddit.STORAGE_KEYS);
        await chrome.storage.local.set(
          DeReddit.coerceSettings({ ...current, ...filtered }),
        );
      });
      await loadSettings();
      showToast("Configuration imported!", "success");
    } catch (error) {
      showToast(`Import failed: ${error.message}`, "error");
    } finally {
      setControlsDisabled(false);
    }
  }

  Object.values(checkboxes).forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      updateScrollControls();
      scheduleAutoSave(true);
    });
  });

  scrollLimit.addEventListener("change", () => {
    const value = Number(scrollLimit.value);
    if (!Number.isSafeInteger(value) || value < 1) {
      showToast("Enter a positive whole number of posts", "error");
      scrollLimit.value = String(lastScrollLimit);
      return;
    }
    lastScrollLimit = value;
    scheduleAutoSave(true);
  });
  scrollMode.addEventListener("change", () => scheduleAutoSave(true));

  addBtn.addEventListener("click", () => addEntry());

  addCurrent.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.url) return;

      const url = DeReddit.getRedditUrl(tab.url);
      const subreddit = url && DeReddit.getSubredditPath(url.pathname);
      subreddit
        ? addEntry(subreddit.name)
        : showToast("No subreddit found on current tab", "error");
    } catch {
      showToast("Could not access current tab", "error");
    }
  });

  exportBtn.addEventListener("click", exportConfig);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importConfig(file);
    importFile.value = "";
  });

  setControlsDisabled(true);
  loadSettings()
    .catch((error) => {
      showToast(`Could not load settings: ${error.message}`, "error");
    })
    .finally(() => setControlsDisabled(false));
});
