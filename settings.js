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
  linearKey: "",
};

// The origin a tracker needs host permission for, or null when it needs none.
function trackerOrigin(s) {
  if (s.tracker === "linear") return "https://api.linear.app/*";
  if (s.tracker === "jira" && s.jiraBase) {
    try {
      return new URL(s.jiraBase).origin + "/*";
    } catch {
      return null;
    }
  }
  return null;
}

function ticketUrl(key, s) {
  if (s.linkTemplate) return s.linkTemplate.split("{key}").join(encodeURIComponent(key));
  if (s.tracker === "jira" && s.jiraBase) return `${s.jiraBase.replace(/\/+$/, "")}/browse/${key}`;
  return null;
}
