async function send(msg) { return await chrome.runtime.sendMessage(msg); }

async function load() {
  const keyRes = await send({ type: "GET_KEY" });
  const setRes = await send({ type: "GET_SETTINGS" });

  document.getElementById("apiKey").value = keyRes.apiKey || "";
  const s = setRes.settings || {};
  document.getElementById("model").value = s.model || "ai21/jamba-mini-1.7";
  document.getElementById("requireApproval").checked = !!s.requireApproval;
  document.getElementById("includePageText").checked = !!s.includePageText;
  document.getElementById("maxContextChars").value = s.maxContextChars ?? 5000;
}

async function save() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const settings = {
    model: document.getElementById("model").value,
    requireApproval: document.getElementById("requireApproval").checked,
    includePageText: document.getElementById("includePageText").checked,
    maxContextChars: Number(document.getElementById("maxContextChars").value) || 5000
  };
  if (apiKey) await send({ type: "SAVE_KEY", apiKey });
  await send({ type: "SAVE_SETTINGS", settings });
}

document.getElementById("save").addEventListener("click", async () => {
  await save();
  window.close();
});

document.getElementById("run").addEventListener("click", async () => {
  await save();
  const prompt = document.getElementById("prompt").value.trim();
  if (!prompt) return alert("gimme a prompt first 😭");
  const res = await send({ type: "RUN_ON_ACTIVE_TAB", prompt });
  if (res?.error) alert(res.error);
});

load();