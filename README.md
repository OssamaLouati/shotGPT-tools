# ShotGPT Tools

A private, extendable Chrome toolbox for ChatGPT.

## Project structure

```text
├── assets/                  Extension artwork
├── popup/                   Toolbar panel and its controls
├── shared/                  Page UI shared by every tool
├── tools/
│   ├── privacy-blur/        Privacy Blur page behavior
│   └── prompt-export/       Prompt and whole-chat export behavior
├── background.js            Saved-state badge handling
├── manifest.json            Chrome extension configuration
└── dist/                    Packaged extension builds
```

Each ChatGPT page tool lives in its own folder under `tools/`. To add another
tool, create its folder and register its content scripts or styles in
`manifest.json`. Add its user controls to `popup/` only if it needs them.

## Included tools

### Privacy Blur

Blurs:

- ChatGPT's generated replies
- Your sent prompts
- Text in the prompt composer

Hover over a message or the composer to reveal it. Open the extension panel to
turn the effect on or off. Your choice is saved between browser sessions.

### Conversation Export

Open a ChatGPT conversation, click the extension icon, and choose **Export my
prompts**. The tool scrolls to the beginning to trigger ChatGPT's lazy loading,
scans through ChatGPT's virtualized conversation, collects your submitted
prompts in chronological order, and downloads a Markdown file. Large chats can
take a few minutes to scan. A date is included for a prompt only when ChatGPT
exposes one in the page.

Choose **Export whole chat** to save the current visible conversation branch,
including user prompts and ChatGPT replies. The exporter preserves headings,
lists, code blocks, tables, quotes, links, citations, inline formatting, and
mathematics where ChatGPT exposes usable page markup. Uploaded or generated
files are recorded by name or label only; their contents and download URLs are
never embedded in the export.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this `shotGPT tools` folder.
5. Open or refresh [ChatGPT](https://chatgpt.com/).

The toolbar badge says **ON** while Privacy Blur is active and **OFF** when it is
disabled. If the extension icon is hidden, pin it from Chrome's Extensions menu.

The packaged build is written to `dist/shotgpt-tools.zip`.
