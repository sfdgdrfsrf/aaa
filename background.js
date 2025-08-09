// background.js

const DEFAULT_SETTINGS = {
  model: "ai21/jamba-mini-1.7", // or "deepseek/deepseek-chat-v3-0324:free"
  requireApproval: true,
  includePageText: true,
  maxContextChars: 5000,
  fileMode: "open-tab", // "open-tab" | "webhook" | "ignore"
  webhookUrl: "" // used if fileMode === "webhook"
};

const storage = {
  async get(keys) { return await chrome.storage.local.get(keys); },
  async set(obj) { return await chrome.storage.local.set(obj); }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "openrouter-run",
    title: "OpenRouter: Use selection",
    contexts: ["selection", "page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "openrouter-run" && tab && tab.id != null) {
    const { apiKey, settings } = await ensureConfig();
    if (!apiKey) return notify("Add your OpenRouter API key in the popup first");
    const prompt = info.selectionText || "Analyze this page and propose helpful edits";
    await runOnTab(tab.id, prompt, apiKey, settings);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "SAVE_KEY") {
      await storage.set({ apiKey: msg.apiKey }); sendResponse({ ok: true });
    } else if (msg.type === "GET_KEY") {
      const { apiKey } = await storage.get(["apiKey"]); sendResponse({ apiKey: apiKey || "" });
    } else if (msg.type === "SAVE_SETTINGS") {
      await storage.set({ settings: msg.settings }); sendResponse({ ok: true });
    } else if (msg.type === "GET_SETTINGS") {
      const { settings } = await storage.get(["settings"]);
      sendResponse({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
    } else if (msg.type === "RUN_ON_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) return sendResponse({ error: "no active tab" });
      const { apiKey, settings } = await ensureConfig();
      if (!apiKey) return sendResponse({ error: "no api key" });
      await runOnTab(tab.id, msg.prompt, apiKey, settings);
      sendResponse({ ok: true });
    } else if (msg.type === "CAPTURE_VISIBLE_TAB") {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
        sendResponse({ ok: true, dataUrl });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    } else if (msg.type === "OPEN_DATA_URL") {
      // open dataUrl or build from mime/content; show in new tab
      const { dataUrl, mime, content } = msg;
      let url = dataUrl;
      if (!url) {
        const text = content || "";
        const b64 = btoa(unescape(encodeURIComponent(text)));
        url = `data:${mime || "text/plain"};base64,${b64}`;
      }
      await chrome.tabs.create({ url });
      sendResponse({ ok: true });
    } else if (msg.type === "UPLOAD_WEBHOOK") {
      const { settings } = await ensureConfig();
      if ((settings.webhookUrl || "").trim().length === 0) return sendResponse({ ok: false, error: "no webhook url" });
      try {
        const res = await fetch(settings.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": msg.contentType || "application/json" },
          body: msg.body || ""
        });
        const text = await res.text().catch(() => "");
        sendResponse({ ok: res.ok, status: res.status, body: text });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    }
  })();
  return true;
});

async function ensureConfig() {
  const { apiKey, settings } = await storage.get(["apiKey", "settings"]);
  return { apiKey: apiKey || "", settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } };
}

function notify(message) {
  console.log("[OpenRouter Control]", message);
}

async function runOnTab(tabId, userPrompt, apiKey, settings) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const ctx = await chrome.tabs.sendMessage(tabId, {
    type: "GET_CONTEXT",
    maxChars: settings.maxContextChars,
    includePageText: settings.includePageText
  });

  const systemPrompt = `
Return STRICT JSON only:

{
  "explain": "short summary",
  "actions": [
    { "type": "replaceSelection", "text": "string" } |
    { "type": "insert", "selector": "CSS", "html": "string", "position": "beforebegin|afterbegin|beforeend|afterend" } |
    { "type": "delete", "selector": "CSS" } |
    { "type": "setStyle", "selector": "CSS", "style": "CSS text" } |
    { "type": "createFile", "filename": "string", "mime": "string", "content": "string" } |
    { "type": "clipboardWrite", "text": "string" } |
    { "type": "click", "selector": "CSS" } |
    { "type": "setValue", "selector": "CSS", "value": "string" } |
    { "type": "replaceHTML", "selector": "CSS", "html": "string" } |
    { "type": "addGlobalStyle", "css": "string" } |
    { "type": "setAttribute", "selector": "CSS", "name": "string", "value": "string" } |
    { "type": "removeAttribute", "selector": "CSS", "name": "string" } |
    { "type": "replaceText", "find": "string", "replace": "string", "exact": true|false } |
    { "type": "scrollTo", "selector": "CSS (optional)", "x": number (optional), "y": number (optional), "behavior": "auto|smooth" } |
    { "type": "screenshot", "selector": "CSS (optional)", "filename": "string.png" } |
    { "type": "openTab", "url": "https://..." } |
    { "type": "localStorageSet", "key": "string", "value": "string" } |
    { "type": "localStorageRemove", "key": "string" } |
    { "type": "extractToFile", "selector": "CSS", "filename": "string.txt", "mime": "text/plain" } |
    { "type": "runSandbox", "html": "string (optional)", "css": "string (optional)", "js": "string (optional)", "height": "e.g. 420px" }
  ]
}
`.trim();

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        `User prompt: ${userPrompt}\n\nPage URL: ${ctx.url}\nTitle: ${ctx.title}\nSelection: ${ctx.selection || "(none)"}\n` +
        (settings.includePageText ? `Visible text (truncated):\n${ctx.visibleText}\n` : "")
    }
  ];

  let parsed;
  try {
    const resp = await callOpenRouter(apiKey, settings.model, messages);
    parsed = safeJson(resp);
  } catch (e) {
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_ERROR", message: String(e) });
    return;
  }

  if (!parsed || !Array.isArray(parsed.actions)) {
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_ERROR", message: "invalid JSON/actions from model" });
    return;
  }

  await chrome.tabs.sendMessage(tabId, {
    type: "PREVIEW_ACTIONS",
    payload: {
      explain: parsed.explain || "Proposed changes",
      actions: parsed.actions,
      requireApproval: settings.requireApproval,
      fileMode: settings.fileMode,
      webhookUrl: settings.webhookUrl
    }
  });
}

async function callOpenRouter(apiKey, model, messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "OpenRouter Control Extension"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" }
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
