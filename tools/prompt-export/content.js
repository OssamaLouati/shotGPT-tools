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

  function escapeMarkdownText(value) {
    return value
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/([\[\]*_~<>])/g, "\\$1")
      .replace(/(^|\n)(\s*)(#{1,6}|>|[-+])(?=\s)/g, "$1$2\\$3")
      .replace(/(^|\n)(\s*)(\d+)\.(?=\s)/g, "$1$2$3\\.");
  }

  function longestBacktickRun(value) {
    return Math.max(
      0,
      ...Array.from(value.matchAll(/`+/g), (match) => match[0].length)
    );
  }

  function serializeInlineCode(element) {
    const value = element.textContent || "";
    const delimiter = "`".repeat(Math.max(1, longestBacktickRun(value) + 1));
    const padding = /^\s|\s$/.test(value) ? " " : "";
    return `${delimiter}${padding}${value}${padding}${delimiter}`;
  }

  function serializeCodeBlock(element) {
    const code = element.querySelector("code") || element;
    const value = (code.textContent || "").replace(/\n$/, "");
    const languageMatch = Array.from(code.classList || [])
      .join(" ")
      .match(/(?:language-|lang-)([\w+-]+)/i);
    const language = languageMatch?.[1] || "";
    const fence = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
    return `${fence}${language}\n${value}\n${fence}\n\n`;
  }

  function serializeList(list, depth = 0) {
    const ordered = list.tagName === "OL";
    const start = Number(list.getAttribute("start")) || 1;
    const items = Array.from(list.children).filter(
      (child) => child.tagName === "LI"
    );

    return items
      .map((item, index) => {
        const nestedLists = Array.from(item.children).filter((child) =>
          ["UL", "OL"].includes(child.tagName)
        );
        const mainNodes = Array.from(item.childNodes).filter(
          (child) => !nestedLists.includes(child)
        );
        const main = mainNodes
          .map((child) => serializeMarkdownNode(child, { listDepth: depth }))
          .join("")
          .trim()
          .replace(/\n{3,}/g, "\n\n");
        const prefix = ordered ? `${start + index}. ` : "- ";
        const indentation = "  ".repeat(depth);
        const continuation = `${indentation}  `;
        const mainLines = main
          .split("\n")
          .map((line, lineIndex) =>
            lineIndex === 0
              ? `${indentation}${prefix}${line}`
              : `${continuation}${line}`
          )
          .join("\n");
        const nested = nestedLists
          .map((child) => serializeList(child, depth + 1).trimEnd())
          .join("\n");
        return nested ? `${mainLines}\n${nested}` : mainLines;
      })
      .join("\n") + (depth === 0 ? "\n\n" : "\n");
  }

  function serializeTable(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (!rows.length) return "";

    const serializedRows = rows
      .map((row) =>
        Array.from(row.querySelectorAll(":scope > th, :scope > td")).map(
          (cell) =>
            serializeMarkdownChildren(cell)
              .trim()
              .replace(/\n+/g, "<br>")
              .replace(/\|/g, "\\|")
        )
      )
      .filter((row) => row.length);
    if (!serializedRows.length) return "";

    const width = Math.max(...serializedRows.map((row) => row.length));
    const normalizeRow = (row) => [
      ...row,
      ...Array(Math.max(0, width - row.length)).fill("")
    ];
    const header = normalizeRow(serializedRows[0]);
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`
    ];

    for (const row of serializedRows.slice(1)) {
      lines.push(`| ${normalizeRow(row).join(" | ")} |`);
    }

    return `${lines.join("\n")}\n\n`;
  }

  function serializeMath(element) {
    const annotation = element.querySelector(
      'annotation[encoding="application/x-tex"]'
    );
    const value = annotation?.textContent?.trim();
    if (!value) return null;

    return element.classList.contains("katex-display")
      ? `\n$$\n${value}\n$$\n\n`
      : `$${value}$`;
  }

  function safeLinkTarget(element) {
    const href = element.getAttribute("href") || "";
    if (!href || /^(javascript|data|blob):/i.test(href)) return null;
    if (
      element.hasAttribute("download") ||
      /(?:\/files?\/|backend-api\/files?|sandbox:)/i.test(href)
    ) {
      return null;
    }

    try {
      return new URL(href, window.location.href).href;
    } catch {
      return null;
    }
  }

  function serializeMarkdownChildren(element, context = {}) {
    const childContext = {
      ...context,
      preserveWhitespace:
        context.preserveWhitespace ||
        element.classList?.contains("whitespace-pre-wrap") ||
        element.tagName === "PRE"
    };
    return Array.from(element.childNodes)
      .map((child) => serializeMarkdownNode(child, childContext))
      .join("");
  }

  function serializeMarkdownNode(node, context = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = context.preserveWhitespace
        ? node.textContent || ""
        : (node.textContent || "").replace(/\s+/g, " ");
      return escapeMarkdownText(value);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node;
    const tag = element.tagName;
    if (["SCRIPT", "STYLE", "SVG", "CANVAS", "NOSCRIPT"].includes(tag)) {
      return "";
    }
    if (element.closest("button") || tag === "BUTTON") return "";

    if (element.classList.contains("katex")) {
      const math = serializeMath(element);
      if (math) return math;
    }

    const children = () => serializeMarkdownChildren(element, context);
    switch (tag) {
      case "BR":
        return "\n";
      case "P":
        return `${children().trim()}\n\n`;
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return `${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
      case "STRONG":
      case "B":
        return `**${children().trim()}**`;
      case "EM":
      case "I":
        return `*${children().trim()}*`;
      case "S":
      case "DEL":
        return `~~${children().trim()}~~`;
      case "CODE":
        return element.parentElement?.tagName === "PRE"
          ? element.textContent || ""
          : serializeInlineCode(element);
      case "PRE":
        return serializeCodeBlock(element);
      case "UL":
      case "OL":
        return serializeList(element, context.listDepth || 0);
      case "LI":
        return children();
      case "BLOCKQUOTE":
        return `${children()
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n\n`;
      case "TABLE":
        return serializeTable(element);
      case "A": {
        const label = children().trim() || element.textContent?.trim() || "Link";
        const target = safeLinkTarget(element);
        return target ? `[${label}](<${target}>)` : label;
      }
      case "IMG":
      case "VIDEO":
      case "AUDIO": {
        const label =
          element.getAttribute("alt") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          tag.toLowerCase();
        return `*[${tag === "IMG" ? "Image" : "Media"}: ${escapeMarkdownText(label)}]*`;
      }
      case "HR":
        return "\n---\n\n";
      case "INPUT":
        return element.type === "checkbox"
          ? `[${element.checked ? "x" : " "}] `
          : "";
      case "SUP":
        return children();
      case "DIV":
      case "SECTION":
      case "ARTICLE":
      case "FIGURE":
      case "FIGCAPTION":
      case "DETAILS":
      case "SUMMARY":
        return `${children()}\n`;
      default:
        return children();
    }
  }

  function normalizeMarkdown(value) {
    return value
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findContentRoots(element) {
    const topLevelOnly = (nodes) =>
      nodes.filter(
        (node) => !nodes.some((other) => other !== node && other.contains(node))
      );
    const contentParts = topLevelOnly(
      Array.from(element.querySelectorAll("[data-message-content-part]"))
    );
    if (contentParts.length) return contentParts;

    const markdown = topLevelOnly(
      Array.from(element.querySelectorAll(".markdown, .prose"))
    );
    if (markdown.length) return markdown;

    const userText = element.querySelector(".whitespace-pre-wrap");
    return [userText || element];
  }

  function readMessageMarkdown(element) {
    return normalizeMarkdown(
      findContentRoots(element)
        .map((root) => serializeMarkdownChildren(root))
        .join("\n\n")
    );
  }

  function extractFileNames(element) {
    const fileNames = new Set();
    const filePattern =
      /^([^\\/]{1,180}\.(?:7z|ai|avif|bmp|c|cc|cpp|cs|css|csv|docx?|gif|go|heic|html?|java|jpeg?|js|json|jsx|md|mjs|mov|mp3|mp4|numbers|pages|pdf|php|png|pptx?|py|rar|rb|rs|rtf|sh|sql|svg|swift|tar|tiff?|toml|ts|tsx|tsv|txt|webm|webp|xlsx?|xml|yaml|yml|zip))$/i;
    const candidates = element.querySelectorAll(
      'a, button, img, [data-testid*="attachment" i], [data-testid*="file" i]'
    );

    for (const candidate of candidates) {
      const values = [
        candidate.getAttribute("download"),
        candidate.getAttribute("alt"),
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.textContent
      ].filter(Boolean);

      for (const value of values) {
        for (const rawLine of value.split("\n")) {
          const line = rawLine
            .trim()
            .replace(/^(?:attached file|attachment|download|open)\s*:?\s*/i, "");
          const match = line.match(filePattern);
          if (match) fileNames.add(match[1].trim());
        }
      }
    }

    return Array.from(fileNames);
  }

  function collectRenderedMessages(scroller, messagesById, messageOrder) {
    const isDocumentScroller = scroller === document.scrollingElement;
    const scrollerBounds = isDocumentScroller
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect();
    const margin = Math.max(120, scroller.clientHeight * 0.2);

    for (const element of document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]'
    )) {
      const bounds = element.getBoundingClientRect();
      const isNearViewport =
        bounds.bottom >= scrollerBounds.top - margin &&
        bounds.top <= scrollerBounds.bottom + margin;
      if (!isNearViewport) continue;

      const role = element.getAttribute("data-message-author-role");
      const markdown = readMessageMarkdown(element);
      const files = extractFileNames(element);
      if (!markdown && !files.length) continue;

      const date = readPromptDate(element);
      const id =
        getMessageId(element) ||
        `fallback:${role}:${date || ""}:${markdown}:${files.join("|")}`;
      const message = { role, markdown, date, files };
      const existing = messagesById.get(id);

      if (!existing) {
        messagesById.set(id, message);
        messageOrder.push(id);
      } else {
        const mergedFiles = Array.from(new Set([...existing.files, ...files]));
        if (
          markdown.length > existing.markdown.length ||
          mergedFiles.length > existing.files.length
        ) {
          messagesById.set(id, {
            role,
            markdown:
              markdown.length > existing.markdown.length
                ? markdown
                : existing.markdown,
            date: date || existing.date,
            files: mergedFiles
          });
        }
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

  function formatFileName(fileName) {
    const delimiter = "`".repeat(
      Math.max(1, longestBacktickRun(fileName) + 1)
    );
    return `${delimiter}${fileName}${delimiter}`;
  }

  function createWholeChatMarkdown(messages) {
    const userCount = messages.filter((message) => message.role === "user").length;
    const assistantCount = messages.filter(
      (message) => message.role === "assistant"
    ).length;
    const lines = [
      `# ${getConversationTitle()}`,
      "",
      `Exported ${new Date().toISOString()}`,
      "",
      `Messages: ${messages.length} (${userCount} user, ${assistantCount} ChatGPT)`,
      ""
    ];

    messages.forEach((message) => {
      lines.push(`## ${message.role === "user" ? "You" : "ChatGPT"}`, "");
      if (message.date) lines.push(`*Date: ${message.date}*`, "");
      if (message.files.length) {
        lines.push(
          `**Attached file${message.files.length === 1 ? "" : "s"}:** ${message.files
            .map(formatFileName)
            .join(", ")}`,
          ""
        );
      }
      if (message.markdown) lines.push(message.markdown, "");
      lines.push("---", "");
    });

    return lines.join("\n");
  }

  function downloadMarkdown(markdown, suffix = "prompts") {
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
    link.download = suffix ? `${safeTitle}-${suffix}.md` : `${safeTitle}.md`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reportProgress(message, details = {}) {
    globalThis.ShotGPTTools.showNotice(message, 0);
    chrome.runtime.sendMessage(
      { type: "EXPORT_PROGRESS", message, ...details },
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
          {
            count: promptsById.size,
            percent,
            status: "running",
            exportType: "prompts"
          }
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

  async function collectAllMessages(scroller) {
    const messagesById = new Map();
    const messageOrder = [];
    let stalledAttempts = 0;
    let lastReportedPercent = -1;

    await loadConversationStart(scroller);

    for (let attempt = 0; attempt < 10000; attempt += 1) {
      collectRenderedMessages(scroller, messagesById, messageOrder);

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
          `Scanning chat… ${messagesById.size} messages found (${percent}%)`,
          {
            count: messagesById.size,
            percent,
            status: "running",
            exportType: "whole-chat"
          }
        );
        lastReportedPercent = percent;
      }

      if (currentScrollTop >= maxScrollTop - 2) {
        await wait(SCAN_RENDER_DELAY);
        collectRenderedMessages(scroller, messagesById, messageOrder);
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

    return messageOrder
      .map((id) => messagesById.get(id))
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
        status: "running",
        exportType: "prompts"
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
          type: "EXPORT_PROGRESS",
          message: `Exported ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`,
          count: prompts.length,
          percent: 100,
          status: "complete",
          exportType: "prompts"
        },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      await restoreScroll(scroller, originalPosition);
      const message = error.message || "Prompt export failed";
      globalThis.ShotGPTTools.showNotice(message, 3000);
      chrome.runtime.sendMessage(
        {
          type: "EXPORT_PROGRESS",
          message,
          status: "error",
          exportType: "prompts"
        },
        () => void chrome.runtime.lastError
      );
    } finally {
      exportInProgress = false;
    }
  }

  async function exportWholeChat() {
    if (exportInProgress) {
      globalThis.ShotGPTTools.showNotice("An export is already running");
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
        status: "running",
        exportType: "whole-chat"
      });

      const messages = await collectAllMessages(scroller);
      if (!messages.length) {
        throw new Error("No conversation messages were found in this chat");
      }

      downloadMarkdown(createWholeChatMarkdown(messages), "");
      await restoreScroll(scroller, originalPosition);
      const userCount = messages.filter(
        (message) => message.role === "user"
      ).length;
      const assistantCount = messages.length - userCount;
      const completionMessage =
        `Exported ${messages.length} messages ` +
        `(${userCount} user, ${assistantCount} ChatGPT)`;
      globalThis.ShotGPTTools.showNotice(completionMessage);
      chrome.runtime.sendMessage(
        {
          type: "EXPORT_PROGRESS",
          message: completionMessage,
          count: messages.length,
          percent: 100,
          status: "complete",
          exportType: "whole-chat"
        },
        () => void chrome.runtime.lastError
      );
    } catch (error) {
      await restoreScroll(scroller, originalPosition);
      const message = error.message || "Whole-chat export failed";
      globalThis.ShotGPTTools.showNotice(message, 3000);
      chrome.runtime.sendMessage(
        {
          type: "EXPORT_PROGRESS",
          message,
          status: "error",
          exportType: "whole-chat"
        },
        () => void chrome.runtime.lastError
      );
    } finally {
      exportInProgress = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!["EXPORT_PROMPTS", "EXPORT_WHOLE_CHAT"].includes(message?.type)) return;

    if (exportInProgress) {
      sendResponse({ started: false, error: "An export is already running" });
      return;
    }

    if (message.type === "EXPORT_WHOLE_CHAT") {
      void exportWholeChat();
    } else {
      void exportPrompts();
    }
    sendResponse({ started: true });
  });
})();
