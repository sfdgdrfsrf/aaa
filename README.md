# OpenRouter Control (MV3)

OpenRouter-powered Chrome extension that edits pages, runs code in a sandbox, grabs screenshots, and moves text around — all from your prompt. No local file saves; outputs open in new tabs or POST to your webhook.

## Features
- Prompt-driven page edits with preview/approval
- Models: ai21/jamba-mini-1.7 (default), deepseek/deepseek-chat-v3-0324:free, plus others
- DOM tools: insert/delete/replace, style tweaks, attributes, find/replace text, scroll, click, set input values
- Files without downloads: open content in a new tab (data URL) or POST to your webhook
- Sandbox runner: execute HTML/CSS/JS in a sandboxed iframe overlay
- Screenshots: full page (visible area) or element crop → open in new tab
- Clipboard write, localStorage set/remove, open URL in new tab, extract text to “virtual file”

## Install (Dev)
1. Clone this repo
2. Open chrome://extensions
3. Enable Developer mode
4. Load unpacked → select the repo folder

## Setup
- Click the extension icon
- Paste your OpenRouter API key (sk-or-v1-…)
- Pick a model (ai21/jamba-mini-1.7 or deepseek/deepseek-chat-v3-0324:free)
- File handling:
  - Open in new tab (default)
  - POST to webhook (set your endpoint)
  - Ignore file outputs
- Optional: toggle Require approval, Include page text, and Max context chars

OpenRouter docs: https://openrouter.ai

## Usage
- Pin the extension
- On any page, select text (optional), click the icon, write a prompt, hit Run
- Or right-click → “OpenRouter: Use selection”

Example prompts:
- “Rewrite the selected paragraph friendlier, then extract all h2 text to a .txt file”
- “Inject a sticky note UI at the top of the page with today’s tasks”
- “Run this HTML+JS in a sandbox and show the preview panel”
- “Find ‘lorem’ on the page and replace with ‘ipsum’, then screenshot the hero section”

## Actions schema (model output)
The extension expects strict JSON with this shape (no prose):

```json
{
  "explain": "short summary",
  "actions": [
    { "type": "replaceSelection", "text": "string" },
    { "type": "insert", "selector": "CSS", "html": "string", "position": "beforebegin|afterbegin|beforeend|afterend" },
    { "type": "delete", "selector": "CSS" },
    { "type": "setStyle", "selector": "CSS", "style": "CSS text" },
    { "type": "createFile", "filename": "string", "mime": "string", "content": "string" },
    { "type": "clipboardWrite", "text": "string" },
    { "type": "click", "selector": "CSS" },
    { "type": "setValue", "selector": "CSS", "value": "string" },
    { "type": "replaceHTML", "selector": "CSS", "html": "string" },
    { "type": "addGlobalStyle", "css": "string" },
    { "type": "setAttribute", "selector": "CSS", "name": "string", "value": "string" },
    { "type": "removeAttribute", "selector": "CSS", "name": "string" },
    { "type": "replaceText", "find": "string", "replace": "string", "exact": true },
    { "type": "scrollTo", "selector": "CSS (optional)", "x": 0, "y": 420, "behavior": "smooth" },
    { "type": "screenshot", "selector": "CSS (optional)", "filename": "screenshot.png" },
    { "type": "openTab", "url": "https://example.com" },
    { "type": "localStorageSet", "key": "foo", "value": "bar" },
    { "type": "localStorageRemove", "key": "foo" },
    { "type": "extractToFile", "selector": ".article p", "filename": "notes.txt", "mime": "text/plain" },
    { "type": "runSandbox", "html": "<div>hi</div>", "css": "div{color:red}", "js": "console.log('ok')", "height": "420px" }
  ]
}
```

What file actions do:
- createFile / extractToFile: opens a new tab with a data URL (or POSTs to your webhook)
- screenshot: opens a new tab with the PNG (or POSTs to your webhook if you wire it)

## Settings
- Model: ai21/jamba-mini-1.7, deepseek/deepseek-chat-v3-0324:free, etc. (forwarded to OpenRouter)
- Require approval: show a preview card before applying actions
- Include page text: send page innerText (truncated) to the model
- Max context chars: trim page text for the prompt
- File handling: open-tab | webhook | ignore
- Webhook URL: used only when file handling = webhook

## Permissions
- storage: save API key + settings locally
- scripting, activeTab, tabs: inject content script and act on current tab
- clipboardWrite: copy text to clipboard on request
- contextMenus: right-click helper
- host_permissions: <all_urls> so it can run on whatever tab you invoke

No downloads permission — nothing writes to your disk.

## Privacy
- API key is stored in chrome.storage.local on your device
- Requests go directly to OpenRouter with your key
- When “Include page text” is on, visible text is sent (truncated by Max context chars)
- Webhook mode: your content is POSTed to the URL you set, nowhere else

## Dev notes
- Manifest V3
- Background service worker: background.js
- Popup UI: popup.html/js
- Options page: options.html/js
- Content script: content.js (runs overlay, applies actions, sandbox, screenshots)
- Icons: icon16/32/128.png (any simple PNGs)

## Known quirks
- Some sites block injection or iframe overlays due to strict CSP
- Screenshots use captureVisibleTab; only the visible portion is captured
- Super long outputs as data URLs may be heavy to render in a new tab
- runSandbox uses sandboxed iframes; no cross-origin access (by design)

## Roadmap
- Custom model text field (free-typed model id)
- Side panel with diffs and one-click undo
- Streaming responses and step-by-step apply
- Element picker (hover/select instead of typing selectors)
- Zip multiple “virtual files” into one data URL tab

## License
MIT — do whatever, just don’t be weird

—

built with love + caffeine by you, and chaperoned by smg44463
