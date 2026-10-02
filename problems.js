// Turns failed branch and ticket lookups into one toast message each, shared by the content script and the node test.

// Most actionable first: when PRs fail for different reasons, the toast explains the top one.
const REF_REASONS = ["unauthorized", "sso", "rate-limited", "no-repo-access", "network", "unreadable"];

// Classifies a failed GitHub API response. headers is a Headers object or a plain lowercase-keyed map.
function apiReason(status, headers = {}) {
  const get = (name) => (typeof headers.get === "function" ? headers.get(name) : headers[name]) ?? null;
  if (status === 401) return "unauthorized";
  if (status === 403 && get("x-github-sso")) return "sso";
  if ((status === 403 || status === 429) && get("x-ratelimit-remaining") === "0") return "rate-limited";
  if (status === 403 || status === 404) return "no-repo-access";
  return "unreadable";
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// failures: [{ reason, repo, resetAt? }], total: PRs on the page, hasToken: whether a GitHub token is saved.
function describeRefFailures(failures, { total, hasToken }) {
  if (!failures.length) return null;
  const reasons = failures.map((f) => f.reason);
  const reason = REF_REASONS.find((r) => reasons.includes(r)) || "unreadable";
  const first = failures.find((f) => f.reason === reason);
  const lead = `Couldn't read the branches of ${failures.length} of ${plural(total, "pull request", "pull requests")}, so ${
    failures.length === 1 ? "it isn't" : "they aren't"
  } grouped.`;

  const fixes = {
    unauthorized: "GitHub rejected your token. It may have expired or been revoked. Paste a new one in the extension options, for example the output of gh auth token.",
    sso: "Your token isn't authorized for this organization's single sign-on. On GitHub, open the token's settings, choose Configure SSO and authorize it for the organization.",
    "rate-limited": first.resetAt
      ? `GitHub's API limit for your token was reached. It resets at ${new Date(first.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}; reload the page after that.`
      : "GitHub's API limit for your token was reached. Reload the page in a few minutes.",
    "no-repo-access": `Your token can't read pull requests in ${first.repo}. Give it read access to this repository, or use the output of gh auth token.`,
    network: "GitHub didn't respond. Check your connection, then reload the page.",
    unreadable: hasToken
      ? "Neither GitHub's API nor its pages returned the branch names. Reload the page; if it keeps happening, GitHub may have changed its pages."
      : "Without a token the extension reads branch names from GitHub's pages, and it couldn't find them there. Add a GitHub token in the extension options, for example the output of gh auth token.",
  };
  const needsOptions = reason === "unauthorized" || reason === "no-repo-access" || (reason === "unreadable" && !hasToken);
  return { id: `refs:${reason}`, title: "Having trouble stacking pull requests", detail: `${lead} ${fixes[reason]}`, options: needsOptions };
}

const TICKET_REASONS = ["no-access", "auth", "rate-limited", "network", "not-found", "other"];

// GitHub API reasons, as ticket lookup reasons. A missing issue is never reported; it is just not shown.
function issueReason(apiReason) {
  if (apiReason === "rate-limited") return "rate-limited";
  if (apiReason === "unauthorized" || apiReason === "sso" || apiReason === "no-repo-access") return "auth";
  return "other";
}

// failures: [{ key, error, reason }], source: "jira" or "github".
function describeTicketFailures(failures, source = "jira") {
  if (!failures.length) return null;
  const name = source === "github" ? "GitHub" : "Jira";
  const reasons = failures.map((f) => f.reason || "other");
  const reason = TICKET_REASONS.find((r) => reasons.includes(r));
  const keys = failures.filter((f) => (f.reason || "other") === reason).map((f) => f.key);
  const list = keys.length > 3 ? `${keys.slice(0, 3).join(", ")} and ${keys.length - 3} more` : keys.join(", ");
  const first = failures.find((f) => (f.reason || "other") === reason);

  const details = {
    "no-access": `Chrome hasn't given the extension access to ${name}. Open the extension options and save them again to grant it.`,
    auth:
      source === "github"
        ? "GitHub rejected your token while looking up issues. Paste a new one in the extension options, for example the output of gh auth token."
        : `${name} rejected your credentials. Check them in the extension options and use the Test button.`,
    "rate-limited": "GitHub's API limit was reached while looking up issues. A GitHub token in the extension options raises the limit; otherwise reload the page later.",
    network: `${name} didn't respond. Check the ${name} address in the extension options and your connection.`,
    "not-found": `${name} has no ${keys.length === 1 ? "ticket" : "tickets"} ${list}. If ${keys.length === 1 ? "that isn't a ticket key" : "those aren't ticket keys"}, set your project keys in the extension options.`,
    other: `${name} returned an error for ${list}: ${first.error}`,
  };
  return { id: `${source}:${reason}`, title: source === "github" ? "Having trouble looking up issues" : "Having trouble looking up tickets", detail: details[reason], options: true };
}

if (typeof module !== "undefined") module.exports = { apiReason, issueReason, describeRefFailures, describeTicketFailures };
