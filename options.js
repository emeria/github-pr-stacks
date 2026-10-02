const $ = (id) => document.getElementById(id);
// ticketSources is an ordered list drawn by renderSources, not a single form field.
const fields = Object.keys(SETTINGS_DEFAULTS).filter((k) => k !== "ticketSources");
let sources = normalizeSources(SETTINGS_DEFAULTS.ticketSources);

const SOURCE_INFO = {
  jira: { name: "Jira", hint: "Keys like ABC-123" },
  github: { name: "GitHub Issues", hint: "#123, owner/repo#123, or branches like 123-fix-login" },
};

function renderSources() {
  const list = $("ticketSources");
  list.replaceChildren(
    ...sources.map((src, i) => {
      const li = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = `${i + 1}.`;
      const label = document.createElement("label");
      label.className = "inline";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.id = `source-${src.id}`;
      box.checked = src.enabled;
      box.addEventListener("change", () => (src.enabled = box.checked));
      label.append(box, ` ${SOURCE_INFO[src.id].name}`);
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = SOURCE_INFO[src.id].hint;
      const move = (text, aria, to) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.setAttribute("aria-label", `${aria} ${SOURCE_INFO[src.id].name}`);
        b.disabled = to < 0 || to >= sources.length;
        b.addEventListener("click", () => {
          [sources[i], sources[to]] = [sources[to], sources[i]];
          renderSources();
          $(`source-${src.id}`).focus();
        });
        return b;
      };
      li.append(rank, label, hint, move("↑", "Move up", i - 1), move("↓", "Move down", i + 1));
      return li;
    })
  );
}

function read() {
  const s = { ticketSources: sources.map((src) => ({ ...src })) };
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
  sources = s.ticketSources;
  renderSources();
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
