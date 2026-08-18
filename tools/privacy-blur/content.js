(() => {
  const STORAGE_KEY = "privacyBlurEnabled";
  const ROOT_CLASS = "chatgpt-privacy-blur-enabled";

  function setEnabled(enabled, showConfirmation = false) {
    document.documentElement.classList.toggle(ROOT_CLASS, enabled);

    if (showConfirmation && document.body) {
      globalThis.ShotGPTTools.showNotice(
        `Privacy Blur ${enabled ? "enabled" : "disabled"}`
      );
    }
  }

  chrome.storage.local.get(STORAGE_KEY).then((stored) => {
    setEnabled(stored[STORAGE_KEY] ?? true);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    setEnabled(changes[STORAGE_KEY].newValue, true);
  });
})();
