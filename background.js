// Tracker lookups run here so tracker credentials never reach the GitHub page.
importScripts("settings.js");

const TICKET_CACHE_KEY = "ticketCache";
const TICKET_TTL_MS = 30 * 60 * 1000;

// reason lets the GitHub page explain the failure: auth, not-found, no-access or other.
function lookupError(message, reason) {
  return Object.assign(new Error(message), { reason });
}

const httpReason = (status) => (status === 401 || status === 403 ? "auth" : status === 404 ? "not-found" : "other");

async function fetchJira(key, s) {
  const base = s.jiraBase.replace(/\/+$/, "");
  const headers = { Accept: "application/json" };
  if (s.jiraAuth === "cloud") headers.Authorization = "Basic " + btoa(`${s.jiraEmail}:${s.jiraToken}`);
  if (s.jiraAuth === "bearer") headers.Authorization = `Bearer ${s.jiraToken}`;
  // API v2 returns the summary as plain text on both Jira Cloud and Data Center.
  const res = await fetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,status`, {
    headers,
    credentials: s.jiraAuth === "session" ? "include" : "omit",
  });
  if (!res.ok) throw lookupError(`Jira returned HTTP ${res.status} for ${key}`, httpReason(res.status));
  const issue = await res.json();
  return { title: issue.fields.summary, status: issue.fields.status?.name, url: `${base}/browse/${issue.key}` };
}

async function fetchLinear(key, s) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: s.linearKey },
    body: JSON.stringify({
      query: "query($id: String!) { issue(id: $id) { title url state { name } } }",
      variables: { id: key },
    }),
  });
  if (!res.ok) throw lookupError(`Linear returned HTTP ${res.status} for ${key}`, httpReason(res.status));
  const { data, errors } = await res.json();
  if (!data?.issue) throw lookupError(errors?.[0]?.message || `Linear has no issue ${key}`, "not-found");
  return { title: data.issue.title, status: data.issue.state?.name, url: data.issue.url };
}

async function fetchTicket(key, s) {
  const origin = trackerOrigin(s);
  if (origin && !(await chrome.permissions.contains({ origins: [origin] }))) {
    throw lookupError(`No access to ${origin}. Save the extension options again to grant it.`, "no-access");
  }
  if (s.tracker === "jira") return fetchJira(key, s);
  if (s.tracker === "linear") return fetchLinear(key, s);
  throw new Error("No ticket tracker configured");
}

async function lookupTickets(keys, { useCache = true } = {}) {
  const s = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  const { [TICKET_CACHE_KEY]: cache = {} } = await chrome.storage.local.get(TICKET_CACHE_KEY);
  const scope = s.tracker === "jira" ? s.jiraBase : s.tracker;
  const out = {};
  await Promise.all(
    keys.map(async (key) => {
      const id = `${scope}|${key}`;
      const hit = cache[id];
      if (useCache && hit && Date.now() - hit.at < TICKET_TTL_MS) {
        out[key] = hit;
        return;
      }
      try {
        out[key] = cache[id] = { ...(await fetchTicket(key, s)), at: Date.now() };
      } catch (err) {
        // fetch rejects with a TypeError when the tracker can't be reached at all.
        out[key] = { error: err.message, reason: err.reason || (err instanceof TypeError ? "network" : "other") };
      }
    })
  );
  await chrome.storage.local.set({ [TICKET_CACHE_KEY]: cache });
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "lookupTickets") {
    lookupTickets(msg.keys || [], { useCache: msg.useCache !== false }).then(sendResponse);
    return true;
  }
  if (msg?.type === "openOptions") chrome.runtime.openOptionsPage();
  return false;
});
