const $ = (id) => document.getElementById(id);
const fields = Object.keys(SETTINGS_DEFAULTS);

function read() {
  const s = {};
  for (const k of fields) {
    const el = $(k);
    s[k] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  return s;
}

function sync() {
  const s = read();
  $("ticketOptions").hidden = !s.ticketsEnabled;
  $("jiraOptions").hidden = s.tracker !== "jira";
  $("jiraCloudRows").hidden = s.jiraAuth !== "cloud";
  $("testRow").hidden = s.tracker === "none";
}

chrome.storage.local.get(SETTINGS_DEFAULTS, (stored) => {
  const s = normalizeSettings(stored);
  for (const k of fields) {
    const el = $(k);
    if (el.type === "checkbox") el.checked = !!s[k];
    else el.value = s[k];
  }
  sync();
});
document.addEventListener("input", sync);
document.addEventListener("change", sync);

function show(el, text) {
  el.textContent = text;
}

async function save() {
  const s = read();
  if (s.ticketPattern) {
    try {
      new RegExp(s.ticketPattern);
    } catch (err) {
      show($("status"), `Key pattern is not a valid regular expression: ${err.message}`);
      return false;
    }
  }
  if (s.tracker === "jira" && !isJiraCloud(s.jiraBase)) {
    show($("status"), "Not saved: enter your Jira Cloud address, for example https://example.atlassian.net.");
    return false;
  }
  // permissions.request must run directly from the click, before any other await.
  const origin = trackerOrigin(s);
  if (origin && !(await chrome.permissions.request({ origins: [origin] }))) {
    show($("status"), `Not saved: Chrome access to ${origin} was declined.`);
    return false;
  }
  await chrome.storage.local.set(s);
  show($("status"), "Saved");
  setTimeout(() => show($("status"), ""), 1500);
  return true;
}

$("save").addEventListener("click", save);

$("test").addEventListener("click", async () => {
  const key = $("testKey").value.trim().toUpperCase();
  if (!key) return show($("testResult"), "Enter a ticket key first.");
  if (!(await save())) return;
  show($("testResult"), "Looking up...");
  const res = await chrome.runtime.sendMessage({ type: "lookupTickets", keys: [key], useCache: false });
  const t = res?.[key];
  show($("testResult"), !t ? "No response from the background script." : t.error ? t.error : `${key}: ${t.title}${t.status ? ` (${t.status})` : ""}`);
});
