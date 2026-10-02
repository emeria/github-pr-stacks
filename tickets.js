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
  module.exports = { DEFAULT_TICKET_PATTERN, parseProjects, extractKeys, stackTickets, describeStack, stackName };
}
