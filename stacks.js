// Pure grouping logic, shared by the content script and the node test.
// A PR is stacked on another when its base branch is the other PR's head branch.

function buildUnits(prs) {
  // prs: [{ key, repo, number, head, base, index }], index = position on the page.
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
  const walk = (pr, out) => {
    if (visited.has(pr.key)) return;
    visited.add(pr.key);
    out.push(pr);
    const kids = (children.get(pr.key) || []).sort((a, b) => a.number - b.number);
    for (const kid of kids) walk(kid, out);
  };

  for (const pr of prs) {
    if (parentOf.has(pr.key)) continue;
    const members = [];
    walk(pr, members);
    units.push(members);
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
  }));
}

if (typeof module !== "undefined") module.exports = { buildUnits };
