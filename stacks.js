// Pure grouping logic, shared by the content script and the node test.
// A PR is stacked on another when its base branch is the other PR's head branch,
// unless the PRs below share a ticket and it names a different one: then it starts a stack of
// its own, and the unit's `onto` is the PR it builds on.

function buildUnits(prs) {
  // prs: [{ key, repo, number, head, base, index, tickets? }], index = position on the page.
  const byHead = new Map();
  for (const pr of prs) byHead.set(pr.repo + ":" + pr.head, pr);

  const parentOf = new Map();
  const children = new Map();
  for (const pr of prs) {
    const parent = byHead.get(pr.repo + ":" + pr.base);
    if (parent && parent !== pr) {
      parentOf.set(pr.key, parent);
      if (!children.has(parent.key)) children.set(parent.key, []);
      children.get(parent.key).push(pr);
    }
  }

  const visited = new Set();
  const units = [];
  const roots = prs.filter((pr) => !parentOf.has(pr.key));
  const onto = new Map();
  // counts: how many PRs from the bottom of this stack up to pr name each ticket. Only a ticket
  // two or more of them share scopes the stack, so one-ticket-per-PR stacks stay together.
  const walk = (pr, out, counts) => {
    if (visited.has(pr.key)) return;
    visited.add(pr.key);
    out.push(pr);
    counts = new Map(counts);
    for (const k of pr.tickets || []) counts.set(k, (counts.get(k) || 0) + 1);
    const shared = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
    const kids = (children.get(pr.key) || []).sort((a, b) => a.number - b.number);
    for (const kid of kids) {
      const own = kid.tickets || [];
      if (own.length && shared.length && !own.some((k) => shared.includes(k))) {
        onto.set(kid.key, pr);
        roots.push(kid);
      } else walk(kid, out, counts);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    const members = [];
    walk(roots[i], members, new Map());
    if (members.length) units.push(members);
  }
  // Anything left over is part of a base/head cycle; keep it visible as singletons.
  for (const pr of prs) if (!visited.has(pr.key)) units.push([pr]);

  // A unit sits where its highest-placed member sat, so the page's sort order holds.
  units.sort(
    (a, b) => Math.min(...a.map((p) => p.index)) - Math.min(...b.map((p) => p.index))
  );
  return units.map((members) => ({
    members,
    stacked: members.length > 1,
    base: members[0].base,
    onto: onto.get(members[0].key) || null,
  }));
}

if (typeof module !== "undefined") module.exports = { buildUnits };
