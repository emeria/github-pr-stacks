const test = require("node:test");
const assert = require("node:assert");
const { prStatus, rowStatus, stackProgress, rollupCi } = require("../status.js");

test("reads GraphQL states, with the action-needed state winning", () => {
  assert.strictEqual(prStatus({ state: "MERGED", merged: true }), "merged");
  assert.strictEqual(prStatus({ state: "CLOSED" }), "closed");
  assert.strictEqual(prStatus({ state: "OPEN", isDraft: true, checks: "FAILURE" }), "draft");
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: "APPROVED", checks: "FAILURE" }), "failing");
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: "CHANGES_REQUESTED", checks: "PENDING" }), "changes");
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: "APPROVED", checks: "PENDING" }), "running");
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: "APPROVED", checks: "SUCCESS" }), "approved");
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: "REVIEW_REQUIRED" }), "review");
});

test("falls back to latest reviews when the repo has no review rules", () => {
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: null, reviews: ["COMMENTED", "APPROVED"] }), "approved");
  assert.strictEqual(prStatus({ state: "OPEN", reviewDecision: null, reviews: ["APPROVED", "CHANGES_REQUESTED"] }), "changes");
});

test("maps check rollups", () => {
  assert.strictEqual(rollupCi("ERROR"), "failure");
  assert.strictEqual(rollupCi("EXPECTED"), "pending");
  assert.strictEqual(rollupCi(null), null);
});

test("reads GitHub's list rows", () => {
  assert.strictEqual(rowStatus("Draft pull request", "1/1 checks passing octicon-check", ""), "draft");
  assert.strictEqual(rowStatus("Open pull request", "1/2 checks failing octicon-x", "Approved"), "failing");
  assert.strictEqual(rowStatus("Open pull request", "octicon-dot-fill", ""), "running");
  assert.strictEqual(rowStatus("Open pull request", "2/2 checks passing octicon-check", "· Approved"), "approved");
  assert.strictEqual(rowStatus("Open pull request", "", "Changes requested"), "changes");
  assert.strictEqual(rowStatus("Merged pull request", "", ""), "merged");
  assert.strictEqual(rowStatus("Open pull request", "2/2 checks passing octicon-check", "Review required"), "review");
});

test("counts approved and merged as done", () => {
  assert.deepStrictEqual(stackProgress(["merged", "approved", "running"]), { done: 2, total: 3, text: "2/3 approved" });
});
