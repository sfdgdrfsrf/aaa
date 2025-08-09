async function send(msg) { return await chrome.runtime.sendMessage(msg); }

async function load() {
  const { settings } = await send({ type: "GET_SETTINGS" });
  document.getElementById("requireApproval").checked = !!settings.requireApproval;
  document.getElementById("includePageText").checked = !!settings.includePageText;
  document.getElementById("model").value = settings.model || "ai21/jamba-mini-1.7";
  document.getElementById("maxContextChars").value = settings.maxContextChars ?? 5000;
  document.getElementById("fileMode").value = settings.fileMode || "open-tab";
  document.getElementById("webhookUrl").value = settings.webhookUrl || "";
}

async function save() {
  const settings = {
    requireApproval: document.getElementById("requireApproval").checked,
    includePageText: document.getElementById("includePageText").checked,
    model: document.getElementById("model").value,
    maxContextChars: Number(document.getElementById("maxContextChars").value) || 5000,
    fileMode: document.getElementById("fileMode").value,
    webhookUrl: document.getElementById("webhookUrl").value.trim()
  };
  await send({ type: "SAVE_SETTINGS", settings });
  alert("saved");
}

document.getElementById("save").addEventListener("click", save);
load();
```

content.js
```js
// content.js — no local downloads; open tabs, webhook, or sandbox

let overlay;
let pendingActions = null;
let pendingExplain = "";
let pendingConfig = { fileMode: "open-tab", webhookUrl: "" };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_CONTEXT") {
      const selection = window.getSelection()?.toString() || "";
      let visibleText = "";
      if (msg.includePageText) {
        visibleText = document.body?.innerText || "";
        if (visibleText.length > msg.maxChars) {
          visibleText = visibleText.slice(0, msg.maxChars) + " ...[truncated]";
        }
      }
      sendResponse({ url: location.href, title: document.title, selection, visibleText });
    } else if (msg.type === "PREVIEW_ACTIONS") {
      pendingActions = msg.payload.actions || [];
      pendingExplain = msg.payload.explain || "Proposed changes";
      pendingConfig.fileMode = msg.payload.fileMode || "open-tab";
      pendingConfig.webhookUrl = msg.payload.webhookUrl || "";
      showOverlay(msg.payload.requireApproval);
      sendResponse({ ok: true });
    } else if (msg.type === "SHOW_ERROR") {
      showToast("OpenRouter error: " + msg.message);
      sendResponse({ ok: true });
    }
  })();
  return true;
});

function showOverlay(requireApproval) {
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.className = "orc-overlay";
  overlay.innerHTML = `
    <div class="orc-card">
      <div class="orc-title">OpenRouter wants to change this page</div>
      <div class="orc-explain">${escapeHtml(pendingExplain)}</div>
      <div class="orc-actions">${renderActionsSummary(pendingActions)}</div>
      <div class="orc-buttons">
        ${requireApproval ? `<button id="orc-apply" class="orc-btn primary">Apply</button>` : ""}
        <button id="orc-cancel" class="orc-btn">Close</button>
      </div>
      <div class="orc-note">no files saved — opens in tab, webhook, or sandbox</div>
    </div>
  `;
  document.documentElement.appendChild(overlay);
  if (requireApproval) {
    overlay.querySelector("#orc-apply")?.addEventListener("click", async () => {
      await applyActions(pendingActions);
      closeOverlay();
    });
  } else {
    applyActions(pendingActions);
  }
  overlay.querySelector("#orc-cancel").addEventListener("click", closeOverlay);
  injectStyles();
}

function closeOverlay() { overlay?.remove(); overlay = null; }

function renderActionsSummary(actions) {
  if (!actions?.length) return `<div class="orc-empty">No changes</div>`;
  const items = actions.map((a, i) => {
    const id = `<code>#${i+1}</code>`;
    switch (a.type) {
      case "replaceSelection": return `<li>${id} replace selection</li>`;
      case "insert": return `<li>${id} insert at <code>${escapeHtml(a.selector||"")}</code> (${escapeHtml(a.position||"beforeend")})</li>`;
      case "delete": return `<li>${id} delete <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "setStyle": return `<li>${id} style <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "createFile": return `<li>${id} open file <code>${escapeHtml(a.filename||"file.txt")}</code> (${escapeHtml(a.mime||"text/plain")})</li>`;
      case "clipboardWrite": return `<li>${id} copy text to clipboard</li>`;
      case "click": return `<li>${id} click <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "setValue": return `<li>${id} set value for <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "replaceHTML": return `<li>${id} replace HTML of <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "addGlobalStyle": return `<li>${id} add CSS block</li>`;
      case "setAttribute": return `<li>${id} set attribute <code>${escapeHtml(a.name||"")}</code> on <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "removeAttribute": return `<li>${id} remove attribute <code>${escapeHtml(a.name||"")}</code> from <code>${escapeHtml(a.selector||"")}</code></li>`;
      case "replaceText": return `<li>${id} replace text "${escapeHtml(a.find||"")}" → "${escapeHtml(a.replace||"")}"</li>";
      case "scrollTo": return `<li>${id} scroll</li>`;
      case "screenshot": return `<li>${id} screenshot ${escapeHtml(a.selector||"viewport")} → new tab</li>`;
      case "openTab": return `<li>${id} open tab <code>${escapeHtml(a.url||"")}</code></li>`;
      case "localStorageSet": return `<li>${id} localStorage set <code>${escapeHtml(a.key||"")}</code></li>`;
      case "localStorageRemove": return `<li>${id} localStorage remove <code>${escapeHtml(a.key||"")}</code></li>`;
      case "extractToFile": return `<li>${id} extract text → new tab</li>`;
      case "runSandbox": return `<li>${id} run code in sandbox</li>`;
      default: return `<li>${id} unknown action</li>`;
    }
  }).join("");
  return `<ul class="orc-list">${items}</ul>`;
}

async function applyActions(actions) {
  for (const a of actions) {
    try {
      switch (a.type) {
        case "replaceSelection": replaceSelectionWith(a.text || ""); break;
        case "insert": {
          const el = document.querySelector(a.selector);
          if (el) el.insertAdjacentHTML(a.position || "beforeend", a.html || "");
          break;
        }
        case "delete": document.querySelectorAll(a.selector || "").forEach(n => n.remove()); break;
        case "setStyle":
          document.querySelectorAll(a.selector || "").forEach(n => {
            n.setAttribute("style", (n.getAttribute("style") || "") + ";" + (a.style || ""));
          });
          break;
        case "createFile":
          await handleFileOutput(a.filename || "openrouter.txt", a.mime || "text/plain", a.content || "");
          break;
        case "clipboardWrite":
          await navigator.clipboard?.writeText(a.text || "").catch(() => {});
          break;
        case "click":
          document.querySelectorAll(a.selector || "").forEach(n => n.click());
          break;
        case "setValue":
          document.querySelectorAll(a.selector || "").forEach(n => {
            if ("value" in n) {
              n.value = a.value ?? "";
              n.dispatchEvent(new Event("input", { bubbles: true }));
              n.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (n.isContentEditable) {
              n.textContent = a.value ?? "";
              n.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
              n.textContent = a.value ?? "";
            }
          });
          break;
        case "replaceHTML": document.querySelectorAll(a.selector || "").forEach(n => n.innerHTML = a.html || ""); break;
        case "addGlobalStyle": {
          const style = document.createElement("style");
          style.textContent = a.css || "";
          document.head.appendChild(style);
          break;
        }
        case "setAttribute": document.querySelectorAll(a.selector || "").forEach(n => n.setAttribute(a.name || "", a.value ?? "")); break;
        case "removeAttribute": document.querySelectorAll(a.selector || "").forEach(n => n.removeAttribute(a.name || "")); break;
        case "replaceText": {
          const find = a.find || ""; const rep = a.replace || ""; if (!find) break;
          const exact = !!a.exact;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const re = exact ? null : new RegExp(escapeRegex(find), "gi");
          const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
          nodes.forEach(node => { if (!node.nodeValue) return;
            node.nodeValue = exact ? node.nodeValue.split(find).join(rep) : node.nodeValue.replace(re, rep);
          });
          break;
        }
        case "scrollTo":
          if (a.selector) { document.querySelector(a.selector)?.scrollIntoView({ behavior: a.behavior || "auto", block: "center" }); }
          else if (typeof a.x === "number" || typeof a.y === "number") { window.scrollTo({ left: a.x || 0, top: a.y || 0, behavior: a.behavior || "auto" }); }
          break;
        case "screenshot": await doScreenshot(a.selector || null, a.filename || "screenshot.png"); break;
        case "openTab": if (a.url) await chrome.runtime.sendMessage({ type: "OPEN_TAB", url: a.url }); break;
        case "localStorageSet": try { localStorage.setItem(a.key || "", String(a.value ?? "")); } catch {}
          break;
        case "localStorageRemove": try { localStorage.removeItem(a.key || ""); } catch {} break;
        case "extractToFile": {
          const parts = []; document.querySelectorAll(a.selector || "").forEach(n => parts.push(n.innerText || n.textContent || ""));
          await handleFileOutput(a.filename || "extracted.txt", a.mime || "text/plain", parts.join("\n\n").trim());
          break;
        }
        case "runSandbox": {
          const html = a.html || "";
          const css = a.css || "";
          const js = a.js || "";
          const height = a.height || "420px";
          openSandbox(html, css, js, height);
          break;
        }
        default: break;
      }
    } catch (e) { console.warn("action failed", a, e); }
  }
  showToast("Applied OpenRouter actions");
}

async function handleFileOutput(filename, mime, content) {
  if (pendingConfig.fileMode === "ignore") return;
  if (pendingConfig.fileMode === "webhook") {
    try {
      const body = JSON.stringify({ filename, mime, content, url: location.href });
      await chrome.runtime.sendMessage({ type: "UPLOAD_WEBHOOK", contentType: "application/json", body });
      showToast("sent to webhook");
    } catch { showToast("webhook failed"); }
    return;
  }
  // open-tab
  await chrome.runtime.sendMessage({ type: "OPEN_DATA_URL", mime, content });
}

function replaceSelectionWith(text) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
}

async function doScreenshot(selector, filename) {
  const rect = selector ? getElementRect(selector) : null;
  const cap = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
  if (!cap?.ok) return showToast("screenshot failed");
  const dataUrl = await cropToRect(cap.dataUrl, rect);
  // open image in new tab
  await chrome.runtime.sendMessage({ type: "OPEN_DATA_URL", dataUrl });
}

function getElementRect(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { x: Math.max(0, r.left * dpr), y: Math.max(0, r.top * dpr), w: Math.max(1, r.width * dpr), h: Math.max(1, r.height * dpr) };
}

function cropToRect(dataUrl, rect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!rect) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(rect.w, img.width - rect.x);
      canvas.height = Math.min(rect.h, img.height - rect.y);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, rect.x, rect.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

function openSandbox(html, css, js, height) {
  // build srcdoc with strict sandbox (no same-origin)
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-modals");
  frame.style.cssText = `position:fixed; right:12px; bottom:12px; width:min(680px, 90vw); height:${height}; z-index:9999999999; border:1px solid #ddd; border-radius:10px; background:#fff;`;
  frame.srcdoc = `
<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;font-family:ui-sans-serif,system-ui} .hd{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #eee;background:#fafafa} .run{background:#111;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer} .area{display:flex;gap:8px;padding:8px} textarea{flex:1;min-height:120px;border:1px solid #ddd;border-radius:6px;padding:6px;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace} .out{border-top:1px solid #eee;height:100%;} iframe{width:100%;height:100%;border:0}</style>
</head><body>
<div class="hd"><div>Sandbox</div><div><button class="run">Run</button></div></div>
<div class="area">
  <textarea id="html" placeholder="HTML">${escapeForSrcdoc(html)}</textarea>
  <textarea id="css" placeholder="CSS">${escapeForSrcdoc(css)}</textarea>
  <textarea id="js" placeholder="JS">${escapeForSrcdoc(js)}</textarea>
</div>
<div class="out"><iframe id="preview" sandbox="allow-scripts"></iframe></div>
<script>
  const $ = sel => document.querySelector(sel);
  function buildDoc(h,c,j){ return \`<!doctype html><html><head><meta charset="utf-8"><style>\${c}</style></head><body>\${h}<script>\${j}<\/script></body></html>\`; }
  function run(){ const doc = buildDoc($("#html").value, $("#css").value, $("#js").value); const p = $("#preview"); p.srcdoc = doc; }
  document.querySelector(".run").addEventListener("click", run);
  run();
</script>
</body></html>`;
  document.documentElement.appendChild(frame);
}

function injectStyles() {
  if (document.getElementById("orc-style")) return;
  const style = document.createElement("style");
  style.id = "orc-style";
  style.textContent = `
  .orc-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.3);
    z-index: 9999999998; display: flex; align-items: flex-start; justify-content: center; padding-top: 10vh;
  }
  .orc-card {
    background: #fff; color: #111; width: min(560px, 92vw); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.2);
    padding: 16px 16px 10px;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
  }
  .orc-title { font-weight: 800; font-size: 16px; margin-bottom: 6px; }
  .orc-explain { color: #333; margin-bottom: 8px; white-space: pre-wrap; }
  .orc-list { margin: 8px 0 12px 18px; }
  .orc-actions code { background: #f5f5f5; padding: 1px 4px; border-radius: 4px; }
  .orc-buttons { display: flex; gap: 8px; justify-content: flex-end; }
  .orc-btn { padding: 8px 10px; border-radius: 8px; border: 1px solid #ddd; background: #eee; cursor: pointer; }
  .orc-btn.primary { background: #111; color: #fff; border-color: #111; }
  .orc-empty { color: #666; }
  .orc-note { color: #777; font-size: 12px; margin-top: 6px; }
  .orc-toast { position: fixed; right: 16px; bottom: 16px; background: #111; color: #fff; padding: 8px 10px; border-radius: 8px; z-index: 9999999999; }
  `;
  document.documentElement.appendChild(style);
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "orc-toast";
  t.textContent = msg;
  document.documentElement.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeForSrcdoc(s) { return (s || "").replace(/<\/script/gi, "<\\/script"); }
