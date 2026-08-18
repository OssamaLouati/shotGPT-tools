const STORAGE_KEY = "privacyBlurEnabled";

async function getEnabled() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? true;
}

async function updateBadge(enabled) {
  await chrome.action.setBadgeText({ text: enabled ? "ON" : "OFF" });
  await chrome.action.setBadgeBackgroundColor({
    color: enabled ? "#0f766e" : "#64748b"
  });
  await chrome.action.setTitle({
    title: "Open ShotGPT Tools"
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);

  if (stored[STORAGE_KEY] === undefined) {
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
  }

  await updateBadge(stored[STORAGE_KEY] ?? true);
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge(await getEnabled());
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) return;
  updateBadge(changes[STORAGE_KEY].newValue);
});

getEnabled().then(updateBadge);
