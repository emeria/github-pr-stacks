const test = require("node:test");
const assert = require("node:assert");
const { apiReason, describeRefFailures, describeTicketFailures } = require("../problems.js");

test("classifies GitHub API failures", () => {
  assert.strictEqual(apiReason(401), "unauthorized");
  assert.strictEqual(apiReason(403, { "x-github-sso": "required; url=https://github.com/x" }), "sso");
  assert.strictEqual(apiReason(403, { "x-ratelimit-remaining": "0" }), "rate-limited");
  assert.strictEqual(apiReason(403, { "x-ratelimit-remaining": "4000" }), "no-repo-access");
  assert.strictEqual(apiReason(404), "no-repo-access");
  assert.strictEqual(apiReason(500), "unreadable");
});

test("reads headers from a Headers object", () => {
  assert.strictEqual(apiReason(403, new Headers({ "X-RateLimit-Remaining": "0" })), "rate-limited");
});

test("reports nothing when every PR was read", () => {
  assert.strictEqual(describeRefFailures([], { total: 5, hasToken: true }), null);
});

test("explains the most actionable reason and counts every failure", () => {
  const p = describeRefFailures(
    [{ reason: "network", repo: "a/b" }, { reason: "unauthorized", repo: "a/b" }],
    { total: 8, hasToken: true }
  );
  assert.strictEqual(p.id, "refs:unauthorized");
  assert.strictEqual(p.title, "Having trouble stacking pull requests");
  assert.match(p.detail, /^Couldn't read the branches of 2 of 8 pull requests, so they aren't grouped\./);
  assert.match(p.detail, /rejected your token/);
  assert.strictEqual(p.options, true);
});

test("suggests a token when the page fallback fails without one", () => {
  const p = describeRefFailures([{ reason: "unreadable", repo: "a/b" }], { total: 1, hasToken: false });
  assert.match(p.detail, /1 of 1 pull request, so it isn't grouped/);
  assert.match(p.detail, /Add a GitHub token/);
});

test("names the repo the token can't read", () => {
  const p = describeRefFailures([{ reason: "no-repo-access", repo: "acme/shop" }], { total: 3, hasToken: true });
  assert.match(p.detail, /can't read pull requests in acme\/shop/);
});

test("summarizes ticket failures by their most actionable reason", () => {
  const p = describeTicketFailures(
    [
      { key: "A-1", error: "Jira returned HTTP 404 for A-1", reason: "not-found" },
      { key: "A-2", error: "Jira returned HTTP 401 for A-2", reason: "auth" },
    ]
  );
  assert.strictEqual(p.id, "jira:auth");
  assert.match(p.detail, /^Jira rejected your credentials/);
});

test("lists missing tickets and shortens long lists", () => {
  const keys = ["A-1", "A-2", "A-3", "A-4", "A-5"];
  const p = describeTicketFailures(keys.map((key) => ({ key, error: "x", reason: "not-found" })));
  assert.match(p.detail, /^Jira has no tickets A-1, A-2, A-3 and 2 more\./);
});

test("explains GitHub issue lookup failures separately", () => {
  const p = describeTicketFailures([{ key: "a/b#1", error: "x", reason: "rate-limited" }], "github");
  assert.strictEqual(p.id, "github:rate-limited");
  assert.strictEqual(p.title, "Having trouble looking up issues");
  assert.match(p.detail, /API limit/);
});
