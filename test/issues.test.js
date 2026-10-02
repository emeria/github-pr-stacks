const test = require("node:test");
const assert = require("node:assert");
const { extractIssueRefs, stackIssueRefs, issueLabel, issueUrl, stackReferences } = require("../tickets.js");
const { normalizeSources } = loadSettings();

function loadSettings() {
  // settings.js is a plain browser script; evaluate it to reach its functions.
  const src = require("fs").readFileSync(require("path").join(__dirname, "../settings.js"), "utf8");
  return new Function(`${src}; return { normalizeSources, SETTINGS_DEFAULTS };`)();
}

const all = { srcBranch: true, srcTitle: true, srcBody: true, ticketProjects: "", ticketPattern: "" };

test("finds short and cross-repo references in text", () => {
  assert.deepStrictEqual(extractIssueRefs("Fix login (#12), see Acme/Web#7", "acme/api"), ["acme/api#12", "acme/web#7"]);
});

test("ignores anchors, entities and words that only contain #", () => {
  assert.deepStrictEqual(extractIssueRefs("see page#3 and &#39; and C#10 x", "a/b"), []);
});

test("reads GitHub-style and prefixed branch names", () => {
  assert.deepStrictEqual(extractIssueRefs("chris/123-fix-login", "a/b", { branch: true }), ["a/b#123"]);
  assert.deepStrictEqual(extractIssueRefs("feature/issue-45", "a/b", { branch: true }), ["a/b#45"]);
  assert.deepStrictEqual(extractIssueRefs("gh-8-cleanup", "a/b", { branch: true }), ["a/b#8"]);
  assert.deepStrictEqual(extractIssueRefs("SHOP-142-cart-totals", "a/b", { branch: true }), []);
});

test("leaves out the stack's own PRs and uses bodies only as a fallback", () => {
  const members = [
    { repo: "a/b", number: 3, head: "add-x", title: "pt1: x", body: "Stacked on #2, closes #9" },
    { repo: "a/b", number: 4, head: "add-y", title: "pt2: y (#3)", body: "" },
  ];
  assert.deepStrictEqual(stackIssueRefs(members, all), ["a/b#2", "a/b#9"]);
  const titled = [{ repo: "a/b", number: 5, head: "x", title: "fix #20", body: "closes #9" }];
  assert.deepStrictEqual(stackIssueRefs(titled, all), ["a/b#20"]);
});

test("labels and links references", () => {
  assert.strictEqual(issueLabel("a/b#4", "A/B"), "#4");
  assert.strictEqual(issueLabel("c/d#4", "a/b"), "c/d#4");
  assert.strictEqual(issueUrl("c/d#4"), "https://github.com/c/d/issues/4");
});

test("uses the first enabled source that finds references", () => {
  const members = [{ repo: "a/b", number: 1, head: "SHOP-1-x", title: "fix #5", body: "" }];
  const order = (sources) => stackReferences(members, { ...all, ticketSources: sources });
  assert.deepStrictEqual(order([{ id: "jira", enabled: true }, { id: "github", enabled: true }]), { source: "jira", keys: ["SHOP-1"] });
  assert.deepStrictEqual(order([{ id: "github", enabled: true }, { id: "jira", enabled: true }]), { source: "github", keys: ["a/b#5"] });
  assert.deepStrictEqual(order([{ id: "jira", enabled: false }, { id: "github", enabled: true }]), { source: "github", keys: ["a/b#5"] });
  assert.deepStrictEqual(order([{ id: "jira", enabled: false }, { id: "github", enabled: false }]), { source: null, keys: [] });
});

test("normalizes saved source lists", () => {
  assert.deepStrictEqual(normalizeSources(undefined), [{ id: "jira", enabled: true }, { id: "github", enabled: true }]);
  assert.deepStrictEqual(normalizeSources([{ id: "github", enabled: false }, { id: "linear" }]), [
    { id: "github", enabled: false },
    { id: "jira", enabled: true },
  ]);
});
