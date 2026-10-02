// Each PR's state for the stack progress bar, and a stack's progress, shared by the content script and the node test.

// Bar segment colours, from GitHub's own colour tokens so they follow its light and dark themes.
const STATUS_COLORS = {
  merged: "var(--fgColor-done, #8250df)",
  closed: "var(--borderColor-emphasis, #818b98)",
  draft: "var(--fgColor-muted, #59636e)",
  failing: "var(--fgColor-danger, #d1242f)",
  changes: "var(--fgColor-attention, #9a6700)",
  running: "var(--fgColor-severe, #bc4c00)",
  approved: "var(--fgColor-success, #1a7f37)",
  review: "var(--fgColor-accent, #0969da)",
};

const STATUS_LABELS = {
  merged: "Merged",
  closed: "Closed",
  draft: "Draft",
  failing: "Checks failing",
  changes: "Changes requested",
  running: "Checks running",
  approved: "Approved",
  review: "Ready for review",
};

// When a PR is in several states at once, the one that needs action shows:
// merged, closed, draft, then failing checks, changes requested, running checks, approved, waiting for review.
// ci: "success", "failure", "pending" or null when the PR has no checks.
function pickStatus({ merged, closed, draft, ci, decision }) {
  if (merged) return "merged";
  if (closed) return "closed";
  if (draft) return "draft";
  if (ci === "failure") return "failing";
  if (decision === "CHANGES_REQUESTED") return "changes";
  if (ci === "pending") return "running";
  if (decision === "APPROVED") return "approved";
  return "review";
}

// GitHub's statusCheckRollup states, as ci values.
function rollupCi(state) {
  if (state === "FAILURE" || state === "ERROR") return "failure";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  if (state === "SUCCESS") return "success";
  return null;
}

// From GitHub's GraphQL pullRequest fields. reviewDecision is null when the repository has no review
// rules, so the latest review from each reviewer decides instead.
function prStatus({ state, isDraft, merged, reviewDecision, reviews = [], checks = null }) {
  const decision =
    reviewDecision ||
    (reviews.includes("CHANGES_REQUESTED") ? "CHANGES_REQUESTED" : reviews.includes("APPROVED") ? "APPROVED" : null);
  return pickStatus({
    merged: merged || state === "MERGED",
    closed: state === "CLOSED",
    draft: isDraft,
    ci: rollupCi(checks),
    decision,
  });
}

// From a row on GitHub's PR list: the state icon's label ("Draft pull request"), the checks badge's
// label and icon class ("2/2 checks passing octicon-check") and the row's text without its title, which says "Approved" or
// "Changes requested" once a PR has reviews.
function rowStatus(iconLabel, checksLabel, meta) {
  const icon = (iconLabel || "").toLowerCase();
  const checks = (checksLabel || "").toLowerCase();
  const ci = /fail|error|cancel|octicon-x\b|octicon-stop/.test(checks)
    ? "failure"
    : /pending|running|progress|queued|waiting|expected|octicon-dot-fill|octicon-clock/.test(checks)
      ? "pending"
      : /pass|success|octicon-check\b/.test(checks)
        ? "success"
        : null;
  return pickStatus({
    merged: icon.startsWith("merged"),
    closed: icon.startsWith("closed"),
    draft: icon.startsWith("draft"),
    ci,
    decision: /\bChanges requested\b/.test(meta || "") ? "CHANGES_REQUESTED" : /\bApproved\b/.test(meta || "") ? "APPROVED" : null,
  });
}

// Approved and merged PRs both count as done.
function stackProgress(statuses) {
  const done = statuses.filter((s) => s === "approved" || s === "merged").length;
  return { done, total: statuses.length, text: `${done}/${statuses.length} approved` };
}

if (typeof module !== "undefined") {
  module.exports = { STATUS_COLORS, STATUS_LABELS, pickStatus, rollupCi, prStatus, rowStatus, stackProgress };
}
