(() => {
  let exportInProgress = false;

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function findConversationScroller() {
    const message = document.querySelector("[data-message-author-role]");
    let element = message?.parentElement;

    while (element && element !== document.body) {
      const style = window.getComputedStyle(element);
      const canScroll = /(auto|scroll)/.test(style.overflowY);

      if (canScroll && element.scrollHeight > element.clientHeight + 40) {
        return element;
      }

      element = element.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  }

  function getVisibleMessageId() {
    const messages = document.querySelectorAll(
      "[data-message-author-role][data-message-id]"
    );

    for (const message of messages) {
      const bounds = message.getBoundingClientRect();
      if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
        return message.getAttribute("data-message-id");
      }
    }

    return null;
  }

  function readPromptText(element) {
    const contentParts = element.querySelectorAll("[data-message-content-part]");
    if (contentParts.length) {
      return Array.from(contentParts)
        .map((part) => part.innerText.trim())
        .filter(Boolean)
        .join("\n\n");
    }

    const textContainer = element.querySelector(".whitespace-pre-wrap");
    return (textContainer || element).innerText.trim();
  }

  function readPromptDate(element) {
    const container = element.closest("article") || element.parentElement;
    const time = container?.querySelector("time");
    const timestampElement = container?.querySelector("[data-message-timestamp]");
    const rawDate =
      time?.getAttribute("datetime") ||
      time?.textContent?.trim() ||
      timestampElement?.getAttribute("data-message-timestamp");

    if (!rawDate) return null;

    const numericDate = /^\d{10,13}$/.test(rawDate)
      ? new Date(Number(rawDate) * (rawDate.length === 10 ? 1000 : 1))
      : new Date(rawDate);

    return Number.isNaN(numericDate.getTime())
      ? rawDate
      : numericDate.toISOString();
  }

  function collectPrompts() {
    return Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    )
      .map((element) => ({
        text: readPromptText(element),
        date: readPromptDate(element)
      }))
      .filter((prompt) => prompt.text);
  }

  function getConversationTitle() {
    return document.title
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .replace(/^ChatGPT\s*[-|]\s*/i, "")
      .trim() || "ChatGPT conversation";
  }

  function createMarkdown(prompts) {
    const lines = [
      `# ${getConversationTitle()}`,
      "",
      `Exported ${new Date().toISOString()}`,
      "",
      `Prompts: ${prompts.length}`,
      ""
    ];

    prompts.forEach((prompt, index) => {
      lines.push(`## Prompt ${index + 1}`, "");
      if (prompt.date) lines.push(`*Date: ${prompt.date}*`, "");
      lines.push(prompt.text, "", "---", "");
    });

    return lines.join("\n");
  }

  function downloadMarkdown(markdown) {
    const safeTitle = getConversationTitle()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "chatgpt-prompts";
    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}-prompts.md`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadAllOlderMessages(scroller) {
    let previousHeight = -1;
    let stableChecks = 0;

    for (let attempt = 0; attempt < 80 && stableChecks < 8; attempt += 1) {
      scroller.scrollTo({ top: 0, behavior: "auto" });
      await wait(350);

      const currentHeight = scroller.scrollHeight;
      const isAtTop = scroller.scrollTop <= 2;
      const heightIsStable = Math.abs(currentHeight - previousHeight) <= 2;
      stableChecks = isAtTop && heightIsStable ? stableChecks + 1 : 0;
      previousHeight = currentHeight;
    }
  }

  function restoreScroll(scroller, wasAtBottom, visibleMessageId) {
    if (wasAtBottom) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
      return;
    }

    if (!visibleMessageId) return;
    const escapedId = CSS.escape(visibleMessageId);
    document
      .querySelector(`[data-message-id="${escapedId}"]`)
      ?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  async function exportPrompts() {
    if (exportInProgress) {
      globalThis.ShotGPTTools.showNotice("A prompt export is already running");
      return;
    }

    exportInProgress = true;
    const scroller = findConversationScroller();
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const wasAtBottom = distanceFromBottom < 100;
    const visibleMessageId = getVisibleMessageId();

    try {
      globalThis.ShotGPTTools.showNotice("Loading older prompts…", 0);
      await loadAllOlderMessages(scroller);

      const prompts = collectPrompts();
      if (!prompts.length) {
        throw new Error("No submitted prompts were found in this chat");
      }

      downloadMarkdown(createMarkdown(prompts));
      restoreScroll(scroller, wasAtBottom, visibleMessageId);
      globalThis.ShotGPTTools.showNotice(
        `Exported ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      restoreScroll(scroller, wasAtBottom, visibleMessageId);
      globalThis.ShotGPTTools.showNotice(
        error.message || "Prompt export failed",
        3000
      );
    } finally {
      exportInProgress = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EXPORT_PROMPTS") return;

    if (exportInProgress) {
      sendResponse({ started: false, error: "An export is already running" });
      return;
    }

    void exportPrompts();
    sendResponse({ started: true });
  });
})();
