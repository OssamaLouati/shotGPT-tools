(() => {
  let exportInProgress = false;
  const SCAN_STEP_RATIO = 0.8;
  const SCAN_RENDER_DELAY = 70;

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function getMessageId(element) {
    return (
      element.getAttribute("data-message-id") ||
      element.closest("[data-message-id]")?.getAttribute("data-message-id") ||
      element
        .querySelector("[data-message-id]")
        ?.getAttribute("data-message-id") ||
      null
    );
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

  function getVisibleMessageAnchor(scroller) {
    const viewportTop =
      scroller === document.scrollingElement
        ? 0
        : scroller.getBoundingClientRect().top;
    const messages = document.querySelectorAll("[data-message-author-role]");

    for (const message of messages) {
      const bounds = message.getBoundingClientRect();
      const id = getMessageId(message);
      if (
        id &&
        bounds.bottom > viewportTop &&
        bounds.top < viewportTop + scroller.clientHeight
      ) {
        return {
          id,
          offset: bounds.top - viewportTop
        };
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

  function getPromptId(element, text, date) {
    return getMessageId(element) || `fallback:${date || ""}:${text}`;
  }

  function collectRenderedPrompts(scroller, promptsById, promptOrder) {
    const isDocumentScroller = scroller === document.scrollingElement;
    const scrollerBounds = isDocumentScroller
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect();
    const margin = Math.max(120, scroller.clientHeight * 0.2);

    for (const element of document.querySelectorAll(
      '[data-message-author-role="user"]'
    )) {
      const bounds = element.getBoundingClientRect();
      const isNearViewport =
        bounds.bottom >= scrollerBounds.top - margin &&
        bounds.top <= scrollerBounds.bottom + margin;

      // ChatGPT keeps a few distant messages mounted while virtualizing the
      // conversation. Only collect the window currently being rendered.
      if (!isNearViewport) continue;

      const text = readPromptText(element);
      if (!text) continue;

      const date = readPromptDate(element);
      const id = getPromptId(element, text, date);
      const existing = promptsById.get(id);

      if (!existing) {
        promptsById.set(id, { text, date });
        promptOrder.push(id);
      } else if (text.length > existing.text.length) {
        // Prefer the fully rendered version if a message was first observed
        // while its attachments or rich content were still settling.
        promptsById.set(id, { text, date: date || existing.date });
      }
    }
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

  function reportProgress(message, details = {}) {
    globalThis.ShotGPTTools.showNotice(message, 0);
    chrome.runtime.sendMessage(
      { type: "PROMPT_EXPORT_PROGRESS", message, ...details },
      () => void chrome.runtime.lastError
    );
  }

  async function loadConversationStart(scroller) {
    let previousHeight = -1;
    let stableChecks = 0;

    for (let attempt = 0; attempt < 180 && stableChecks < 15; attempt += 1) {
      scroller.scrollTo({ top: 0, behavior: "auto" });
      await wait(400);

      const currentHeight = scroller.scrollHeight;
      const isAtTop = scroller.scrollTop <= 2;
      const heightIsStable = Math.abs(currentHeight - previousHeight) <= 2;
      stableChecks = isAtTop && heightIsStable ? stableChecks + 1 : 0;
      previousHeight = currentHeight;
    }
  }

  async function collectAllPrompts(scroller) {
    const promptsById = new Map();
    const promptOrder = [];
    let stalledAttempts = 0;
    let lastReportedPercent = -1;

    await loadConversationStart(scroller);

    for (let attempt = 0; attempt < 10000; attempt += 1) {
      collectRenderedPrompts(scroller, promptsById, promptOrder);

      const maxScrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight
      );
      const currentScrollTop = Math.max(0, scroller.scrollTop);
      const percent = maxScrollTop
        ? Math.min(100, Math.round((currentScrollTop / maxScrollTop) * 100))
        : 100;

      if (
        percent === 100 ||
        lastReportedPercent < 0 ||
        percent >= lastReportedPercent + 2
      ) {
        reportProgress(
          `Scanning prompts… ${promptsById.size} found (${percent}%)`,
          { count: promptsById.size, percent, status: "running" }
        );
        lastReportedPercent = percent;
      }

      if (currentScrollTop >= maxScrollTop - 2) {
        // Capture once more after the final virtualized window settles.
        await wait(SCAN_RENDER_DELAY);
        collectRenderedPrompts(scroller, promptsById, promptOrder);
        break;
      }

      const step = Math.max(320, scroller.clientHeight * SCAN_STEP_RATIO);
      const targetScrollTop = Math.min(maxScrollTop, currentScrollTop + step);
      scroller.scrollTo({ top: targetScrollTop, behavior: "auto" });
      await wait(SCAN_RENDER_DELAY);

      if (scroller.scrollTop <= currentScrollTop + 1) {
        stalledAttempts += 1;
        if (stalledAttempts >= 8) {
          throw new Error(
            "ChatGPT stopped the conversation scan before it finished"
          );
        }
      } else {
        stalledAttempts = 0;
      }

      if (attempt === 9999) {
        throw new Error("This conversation is too long to scan safely");
      }
    }

    return promptOrder
      .map((id) => promptsById.get(id))
      .filter(Boolean);
  }

  async function restoreScroll(scroller, originalPosition) {
    const { wasAtBottom, scrollTop, anchor } = originalPosition;

    if (wasAtBottom) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
      return;
    }

    scroller.scrollTo({
      top: Math.min(scrollTop, scroller.scrollHeight - scroller.clientHeight),
      behavior: "auto"
    });
    await wait(SCAN_RENDER_DELAY * 2);

    if (!anchor?.id) return;
    const escapedId = CSS.escape(anchor.id);
    const message = document.querySelector(`[data-message-id="${escapedId}"]`);
    if (!message) return;

    const viewportTop =
      scroller === document.scrollingElement
        ? 0
        : scroller.getBoundingClientRect().top;
    const offsetDifference =
      message.getBoundingClientRect().top - viewportTop - anchor.offset;
    scroller.scrollTo({
      top: scroller.scrollTop + offsetDifference,
      behavior: "auto"
    });
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
    const originalPosition = {
      wasAtBottom: distanceFromBottom < 100,
      scrollTop: scroller.scrollTop,
      anchor: getVisibleMessageAnchor(scroller)
    };

    try {
      reportProgress("Loading the full conversation…", {
        count: 0,
        percent: 0,
        status: "running"
      });

      const prompts = await collectAllPrompts(scroller);
      if (!prompts.length) {
        throw new Error("No submitted prompts were found in this chat");
      }

      downloadMarkdown(createMarkdown(prompts));
      await restoreScroll(scroller, originalPosition);
      globalThis.ShotGPTTools.showNotice(
        `Exported ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`
      );
      chrome.runtime.sendMessage(
        {
          type: "PROMPT_EXPORT_PROGRESS",
          message: `Exported ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`,
          count: prompts.length,
          percent: 100,
          status: "complete"
        },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      await restoreScroll(scroller, originalPosition);
      const message = error.message || "Prompt export failed";
      globalThis.ShotGPTTools.showNotice(message, 3000);
      chrome.runtime.sendMessage(
        {
          type: "PROMPT_EXPORT_PROGRESS",
          message,
          status: "error"
        },
        () => void chrome.runtime.lastError
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
