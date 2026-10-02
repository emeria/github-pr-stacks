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
