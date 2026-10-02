// Defaults for everything kept in chrome.storage.local. Loaded by every extension context.
const SETTINGS_DEFAULTS = {
  token: "",
  ticketsEnabled: false,
  srcBranch: true,
  srcTitle: true,
  srcBody: true,
  ticketProjects: "",
  ticketPattern: "",
  linkTemplate: "",
  tracker: "none",
  jiraBase: "",
  jiraAuth: "cloud",
  jiraEmail: "",
  jiraToken: "",
  // Ticket sources in priority order. A stack shows references from the first enabled source that finds any.
  ticketSources: [
    { id: "jira", enabled: true },
    { id: "github", enabled: true },
  ],
};

const TICKET_SOURCE_IDS = ["jira", "github"];

// Only Jira Cloud is supported, so older saved trackers (Linear) and sign-in modes (Data Center tokens) fall back.
function normalizeSettings(s) {
  return {
    ...s,
    tracker: s.tracker === "jira" ? "jira" : "none",
    jiraAuth: s.jiraAuth === "session" ? "session" : "cloud",
    ticketSources: normalizeSources(s.ticketSources),
  };
}

// Keeps the saved order, drops unknown sources and appends any the saved list is missing.
function normalizeSources(list) {
  const out = [];
  for (const src of Array.isArray(list) ? list : []) {
    if (TICKET_SOURCE_IDS.includes(src?.id) && !out.some((o) => o.id === src.id)) {
      out.push({ id: src.id, enabled: src.enabled !== false });
    }
  }
  for (const id of TICKET_SOURCE_IDS) if (!out.some((o) => o.id === id)) out.push({ id, enabled: true });
  return out;
}

// Jira Cloud sites live on atlassian.net, the only tracker host the manifest can ask for.
function isJiraCloud(base) {
  try {
    const url = new URL(base);
    return url.protocol === "https:" && url.hostname.endsWith(".atlassian.net");
  } catch {
    return false;
  }
}

// The origin a tracker needs host permission for, or null when it needs none.
function trackerOrigin(s) {
  if (s.tracker === "jira" && isJiraCloud(s.jiraBase)) return new URL(s.jiraBase).origin + "/*";
  return null;
}

function ticketUrl(key, s) {
  if (s.linkTemplate) return s.linkTemplate.split("{key}").join(encodeURIComponent(key));
  if (s.tracker === "jira" && s.jiraBase) return `${s.jiraBase.replace(/\/+$/, "")}/browse/${key}`;
  return null;
}
