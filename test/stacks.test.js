const test = require("node:test");
const assert = require("node:assert");
const { buildUnits } = require("../stacks.js");

const pr = (number, head, base, index) => ({ key: `r#${number}`, repo: "r", number, head, base, index });

test("groups chains bottom to top and keeps page order", () => {
  const units = buildUnits([
    pr(29, "b2", "b1", 0),
    pr(19, "p2", "p1", 1),
    pr(21, "b1", "main", 2),
    pr(9, "solo", "main", 3),
    pr(11, "p1", "main", 4),
  ]);
  assert.deepStrictEqual(
    units.map((u) => u.members.map((m) => m.number)),
    [[21, 29], [11, 19], [9]]
  );
  assert.deepStrictEqual(units.map((u) => u.stacked), [true, true, false]);
});

test("keeps PRs in a base/head cycle visible", () => {
  const units = buildUnits([pr(1, "a", "b", 0), pr(2, "b", "a", 1)]);
  assert.strictEqual(units.flatMap((u) => u.members).length, 2);
});

test("does not link PRs across repositories", () => {
  const units = buildUnits([
    { ...pr(1, "x", "main", 0), repo: "a", key: "a#1" },
    { ...pr(2, "y", "x", 1), repo: "b", key: "b#2" },
  ]);
  assert.ok(units.every((u) => !u.stacked));
});

test("starts a new stack when a PR names a ticket other than the one the stack shares", () => {
  const t = (p, tickets) => ({ ...p, tickets });
  const units = buildUnits([
    t(pr(1, "data-1-a", "main", 0), ["DATA-1"]),
    t(pr(2, "data-1-b", "data-1-a", 1), ["DATA-1"]),
    t(pr(3, "tidy", "data-1-b", 2), []),
    t(pr(4, "data-2", "tidy", 3), ["DATA-2"]),
    t(pr(5, "data-2-b", "data-2", 4), []),
  ]);
  assert.deepStrictEqual(
    units.map((u) => u.members.map((m) => m.number)),
    [[1, 2, 3], [4, 5]]
  );
  assert.strictEqual(units[0].onto, null);
  assert.strictEqual(units[1].onto.number, 3);
  assert.strictEqual(units[1].base, "tidy");
});

test("keeps one-ticket-per-PR stacks and PRs without tickets together", () => {
  const t = (p, tickets) => ({ ...p, tickets });
  const units = buildUnits([
    t(pr(1, "a", "main", 0), []),
    t(pr(2, "b", "a", 1), ["DATA-2"]),
    t(pr(3, "c", "b", 2), ["DATA-3"]),
    t(pr(4, "d", "c", 3), ["DATA-4"]),
  ]);
  assert.deepStrictEqual(units.map((u) => u.members.map((m) => m.number)), [[1, 2, 3, 4]]);
});
