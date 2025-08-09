// content.js
// Injects preview/approval UI and applies actions safely to the DOM.

let overlay;
let pendingActions = null;
let pendingExplain = "";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_CONTEXT") {
      const selection = window.getSelection()?.toString() || "";
      let visibleText = "";
      if (msg.includePageText) {
        // attempt to get visible text (not perfect)
        visibleText = document.body?.innerText || "";
        if (visibleText.length > msg.maxChars) {
          visibleText = visibleText.slice(0, msg.maxChars) + " ...[truncated]";
        }
      }
      sendResponse({
        url: location.href,
        title: document.title,
        selection,
        visibleText
      });
    } else if (msg.type === "PREVIEW_ACTIONS") {
      pendingActions = msg.payload.actions || [];
      pendingExplain = msg.payload.explain || "Proposed changes";
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
      <div class="orc-note">changes are local to this page/tab</div>
    </div>
  `;
  document.documentElement.appendChild(overlay);
  if (requireApproval) {
    overlay.querySelector("#orc-apply").addEventListener("click", () => {
      applyActions(pendingActions);
      closeOverlay();
    });
  } else {
    // auto-apply
    applyActions(pendingActions);
  }
  overlay.querySelector("#orc-cancel").addEventListener("click", closeOverlay);
  injectStyles();
}

function closeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function renderActionsSummary(actions) {
  if (!actions?.length) return `<div class="orc-empty">No changes</div>`;
  const items = actions.map((a, i) => {
    if (a.type === "replaceSelection") return `<li><code>#${i+1}</code> replace selection</li>`;
    if (a.type === "insert") return `<li><code>#${i+1}</code> insert at <code>${escapeHtml(a.selector||"")}</code> position ${escapeHtml(a.position||"beforeend")}</li>`;
    if (a.type === "delete") return `<li><code>#${i+1}</code> delete <code>${escapeHtml(a.selector||"")}</code></li>`;
    if (a.type === "setStyle") return `<li><code>#${i+1}</code> style <code>${escapeHtml(a.selector||"")}</code></li>`;
    if (a.type === "createFile") return `<li><code>#${i+1}</code> create file <code>${escapeHtml(a.filename||"file.txt")}</code></li>`;
    if (a.type === "clipboardWrite") return `<li><code>#${i+1}</code> copy text to clipboard</li>`;
    return `<li><code>#${i+1}</code> unknown action</li>`;
  }).join("");
  return `<ul class="orc-list">${items}</ul>`;
}

function applyActions(actions) {
  for (const a of actions) {
    try {
      if (a.type === "replaceSelection") {
        replaceSelectionWith(a.text || "");
      } else if (a.type === "insert") {
        const el = document.querySelector(a.selector);
        if (!el) continue;
        const pos = a.position || "beforeend";
        el.insertAdjacentHTML(pos, a.html || "");
      } else if (a.type === "delete") {
        document.querySelectorAll(a.selector || "").forEach(n => n.remove());
      } else if (a.type === "setStyle") {
        document.querySelectorAll(a.selector || "").forEach(n => {
          n.setAttribute("style", (n.getAttribute("style") || "") + ";" + (a.style || ""));
        });
      } else if (a.type === "createFile") {
        chrome.runtime.sendMessage({
          type: "DOWNLOAD_FILE",
          filename: a.filename || "openrouter.txt",
          mime: a.mime || "text/plain",
          content: a.content || ""
        });
      } else if (a.type === "clipboardWrite") {
        navigator.clipboard?.writeText(a.text || "").catch(() => {});
      }
    } catch (e) {
      console.warn("action failed", a, e);
    }
  }
  showToast("Applied OpenRouter actions");
}

function replaceSelectionWith(text) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
}

function injectStyles() {
  if (document.getElementById("orc-style")) return;
  const style = document.createElement("style");
  style.id = "orc-style";
  style.textContent = `
  .orc-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.3);
    z-index: 9999999999; display: flex; align-items: flex-start; justify-content: center; padding-top: 10vh;
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

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
