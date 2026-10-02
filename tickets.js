// Pure ticket-key extraction, shared by the content script and the node test.

const DEFAULT_TICKET_PATTERN = "[A-Z][A-Z0-9]{1,9}-\\d+";

function parseProjects(list) {
  return (list || "")
    .split(/[\s,]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
}

function extractKeys(text, { pattern, projects = [], ignoreCase = false } = {}) {
  if (!text) return [];
  const re = new RegExp(
    `(?<![A-Za-z0-9])(${pattern || DEFAULT_TICKET_PATTERN})(?![A-Za-z0-9])`,
    ignoreCase ? "gi" : "g"
  );
  const keys = [];
  for (const m of text.matchAll(re)) {
    const key = m[1].toUpperCase();
    if (projects.length && !projects.includes(key.replace(/-\d+$/, ""))) continue;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Branch names and titles are checked first. The PR body is only a fallback,
// because bodies often mention follow-up or related tickets the stack does not implement.
function stackTickets(members, settings) {
  const opts = { pattern: settings.ticketPattern, projects: parseProjects(settings.ticketProjects) };
  const keys = [];
  const add = (list) => list.forEach((k) => keys.includes(k) || keys.push(k));
  for (const m of members) {
    if (settings.srcBranch) add(extractKeys(m.head, { ...opts, ignoreCase: true }));
    if (settings.srcTitle) add(extractKeys(m.title, opts));
  }
  if (!keys.length && settings.srcBody) {
    for (const m of members) add(extractKeys(m.body, opts));
  }
  return keys;
}

// GitHub issue references, normalized to "owner/repo#12" with a lowercase repo.
// Titles and bodies: "#12" or "owner/repo#12". Branches: GitHub's own "12-short-title" format,
// or an "issue-12" / "gh-12" style name.
function extractIssueRefs(text, repo, { branch = false } = {}) {
  if (!text) return [];
  const refs = [];
  const add = (r, n) => {
    const ref = `${(r || repo).toLowerCase()}#${Number(n)}`;
    if (!refs.includes(ref)) refs.push(ref);
  };
  if (branch) {
    const name = text.slice(text.lastIndexOf("/") + 1);
    const m = /^(\d+)-[a-z]/i.exec(name) || /(?:^|[-_])(?:issues?|gh)[-_]?(\d+)(?!\d)/i.exec(name);
    if (m) add(null, m[1]);
    return refs;
  }
  for (const m of text.matchAll(/(?<![\w/&#-])(?:([\w.-]+\/[\w.-]+))?#(\d+)(?!\w)/g)) add(m[1], m[2]);
  return refs;
}

// Same order of preference as stackTickets. References to the stack's own PRs are left out.
function stackIssueRefs(members, settings) {
  const own = new Set(members.map((m) => `${(m.repo || "").toLowerCase()}#${m.number}`));
  const refs = [];
  const add = (list) => list.forEach((r) => own.has(r) || refs.includes(r) || refs.push(r));
  for (const m of members) {
    if (settings.srcBranch) add(extractIssueRefs(m.head, m.repo, { branch: true }));
    if (settings.srcTitle) add(extractIssueRefs(m.title, m.repo));
  }
  if (!refs.length && settings.srcBody) {
    for (const m of members) add(extractIssueRefs(m.body, m.repo));
  }
  return refs;
}

// "#12" for an issue in the PR's own repository, the full "owner/repo#12" otherwise.
function issueLabel(ref, repo) {
  const [r, n] = ref.split("#");
  return r === (repo || "").toLowerCase() ? `#${n}` : ref;
}

function issueUrl(ref) {
  const [r, n] = ref.split("#");
  return `https://github.com/${r}/issues/${n}`;
}

// The first enabled source, in the user's priority order, that finds references in the stack.
function stackReferences(members, settings) {
  for (const src of settings.ticketSources || []) {
    if (!src.enabled) continue;
    const keys = src.id === "jira" ? stackTickets(members, settings) : src.id === "github" ? stackIssueRefs(members, settings) : [];
    if (keys.length) return { source: src.id, keys };
  }
  return { source: null, keys: [] };
}

// A stack's fallback description: the bottom PR's title without ticket keys, part numbers
// or a conventional-commit prefix, since the stack name already carries the scope.
function describeStack(members, keys) {
  let title = (members[0] && members[0].title) || "";
  for (const key of keys) title = title.split(key).join("");
  return title
    .replace(/^[^:]*?\bpt\s*\d+(\s*\/\s*\d+)?\s*:\s*/i, "")
    .replace(/^\s*\w+(\([^)]*\))?!?:\s*/, "")
    .replace(/\bpt\s*\d+(\s*\/\s*\d+)?\b:?/gi, "")
    .replace(/\bpart\s*\d+(\s*(of|\/)\s*\d+)?\b:?/gi, "")
    .replace(/^[\s:[\]()|,-]+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/:\s*:/g, ":")
    .trim();
}

// Words that show up across unrelated PR titles, so they never name a stack.
const NAME_STOPWORDS = new Set(
  "add adds added update updates fix fixes remove removes clean cleanup make use the and with from into for this that docs feat chore refactor test tests".split(" ")
);

// A short name for a stack, from wording every PR title in it shares, tried in order:
// the same conventional-commit scope, "docs(pass-skills): ..."
// the same label before a part number, "skill-port pt1: ..."
// the longest word or hyphenated term in every title, "perf-calibration"
// the bottom PR's branch name, without any "user/" style prefix
function stackName(members) {
  if (members.length < 2) return "";
  return sharedTitleName(members.map((m) => m.title || "")) || branchName(members[0].head);
}

// Branches that could not be read are placeholders starting with "?".
function branchName(head) {
  if (!head || head.startsWith("?")) return "";
  return head.slice(head.lastIndexOf("/") + 1);
}

function sharedTitleName(titles) {
  if (titles.some((t) => !t)) return "";
  const same = (values) => (values.every((v) => v && v === values[0]) ? values[0] : "");

  const scope = same(titles.map((t) => (/^\w+\(([^)]+)\)!?:/.exec(t) || [])[1]?.toLowerCase()));
  if (scope) return scope;

  const label = same(
    titles.map((t) => (/^([^:]*?)\s*\bpt\s*\d+/i.exec(t) || [])[1]?.replace(/[\s:[\]()|,-]+$/, "").trim())
  );
  if (label) return label;

  const words = (t) => new Set(t.toLowerCase().match(/[a-z0-9][a-z0-9._-]*[a-z0-9]/g) || []);
  const [first, ...rest] = titles.map(words);
  const shared = [...first]
    .filter((w) => w.length >= 4 && !NAME_STOPWORDS.has(w) && !/^\d+$/.test(w))
    .filter((w) => rest.every((set) => set.has(w)))
    .sort((a, b) => b.length - a.length);
  return shared[0] || "";
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_TICKET_PATTERN,
    parseProjects,
    extractKeys,
    stackTickets,
    extractIssueRefs,
    stackIssueRefs,
    issueLabel,
    issueUrl,
    stackReferences,
    describeStack,
    stackName,
  };
}
