const test = require("node:test");
const assert = require("node:assert");
const { extractKeys, stackTickets, describeStack, stackName } = require("../tickets.js");

const all = { srcBranch: true, srcTitle: true, srcBody: true, ticketProjects: "", ticketPattern: "" };

test("finds lowercase keys in branch names", () => {
  assert.deepStrictEqual(extractKeys("chris/data-513-split-paths", { ignoreCase: true }), ["DATA-513"]);
});

test("keeps title matching case-sensitive", () => {
  assert.deepStrictEqual(extractKeys("fix utf-8 handling for DATA-12"), ["DATA-12"]);
});

test("filters by project keys", () => {
  assert.deepStrictEqual(extractKeys("UTF-8 and DATA-1", { projects: ["DATA"] }), ["DATA-1"]);
});

test("uses the body only when branches and titles have no keys", () => {
  const withKey = [{ head: "data-1-x", title: "pt1: thing", body: "Follow-up: DATA-9" }];
  assert.deepStrictEqual(stackTickets(withKey, all), ["DATA-1"]);
  const without = [{ head: "add-thing", title: "pt1: thing", body: "Implements DATA-9" }];
  assert.deepStrictEqual(stackTickets(without, all), ["DATA-9"]);
});

test("collects keys across the stack in order without duplicates", () => {
  const members = [
    { head: "data-513-pt1", title: "DATA-513 pt1: split", body: "" },
    { head: "data-513-pt2", title: "DATA-513 pt2: and DATA-514", body: "" },
  ];
  assert.deepStrictEqual(stackTickets(members, all), ["DATA-513", "DATA-514"]);
});

test("describes a stack by its bottom title without keys, part numbers or commit prefix", () => {
  assert.strictEqual(describeStack([{ title: "DATA-513 pt1: split extract paths" }], ["DATA-513"]), "split extract paths");
  assert.strictEqual(
    describeStack([{ title: "feat(pass-skills): pt1/6 add the five revision pass skills" }], []),
    "add the five revision pass skills"
  );
  assert.strictEqual(
    describeStack([{ title: "skill-port pt1: feat(skill-port): add skill-port" }], []),
    "add skill-port"
  );
});

test("names a stack from wording its titles share", () => {
  const t = (...titles) => titles.map((title) => ({ title }));
  assert.strictEqual(stackName(t("feat(pass-skills): pt1/6 add", "docs(pass-skills): pt2/6 clean")), "pass-skills");
  assert.strictEqual(stackName(t("skill-port pt1: feat(skill-port): a", "skill-port pt2: feat(blast-radius): b")), "skill-port");
  assert.strictEqual(stackName(t("Add perf-calibration skill", "Port perf-calibration scripts to TypeScript")), "perf-calibration");
  assert.strictEqual(stackName(t("pt1: Add new-worktree", "pt2: Align frontmatter")), "");
  assert.strictEqual(stackName(t("only one")), "");
});

test("falls back to the bottom PR's branch name", () => {
  const members = [
    { title: "pt1: Add new-worktree", head: "chris/add-git-workflow-skills" },
    { title: "pt2: Align frontmatter", head: "align-skill-frontmatter" },
  ];
  assert.strictEqual(stackName(members), "add-git-workflow-skills");
  assert.strictEqual(stackName([{ ...members[0], head: "?r#15" }, members[1]]), "");
});
