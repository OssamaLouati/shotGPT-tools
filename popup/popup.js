const STORAGE_KEY = "privacyBlurEnabled";
const blurToggle = document.getElementById("blur-toggle");
const exportButton = document.getElementById("export-button");
const exportChatButton = document.getElementById("export-chat-button");
const status = document.getElementById("status");
const exportButtons = [exportButton, exportChatButton];

chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  blurToggle.checked = stored[STORAGE_KEY] ?? true;
});

blurToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({
    [STORAGE_KEY]: blurToggle.checked
  });
});

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function startExport(messageType, startingMessage) {
  exportButtons.forEach((button) => {
    button.disabled = true;
  });
  setStatus("Starting export…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isChatGPT = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(
      tab?.url || ""
    );

    if (!tab?.id || !isChatGPT) {
      throw new Error("Open a ChatGPT conversation first");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: messageType
    });

    if (!response?.started) {
      throw new Error(response?.error || "Could not start the export");
    }

    setStatus(startingMessage);
  } catch (error) {
    const message = error.message?.includes("Receiving end does not exist")
      ? "Refresh the ChatGPT tab, then try again"
      : error.message || "Could not start the export";
    setStatus(message, true);
    exportButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

exportButton.addEventListener("click", () => {
  void startExport("EXPORT_PROMPTS", "Loading prompts in the ChatGPT tab…");
});

exportChatButton.addEventListener("click", () => {
  void startExport(
    "EXPORT_WHOLE_CHAT",
    "Loading the whole conversation in the ChatGPT tab…"
  );
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "EXPORT_PROGRESS") return;

  setStatus(message.message, message.status === "error");
  if (message.status === "complete" || message.status === "error") {
    exportButtons.forEach((button) => {
      button.disabled = false;
    });
  }
});
