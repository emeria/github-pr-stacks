(() => {
  const PULL_PATH = /^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/;
  const LIST_PATH = /^\/([^/]+\/[^/]+\/pulls|pulls)(\/|$)/;
  const CACHE_KEY = "prStacks.refs";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const ENABLED_KEY = "prStacks.enabled";
  const MARK = "data-pr-stacks";

  let token = "";
  let lastSignature = "";
  let applying = false;
  const inflight = new Map();

  chrome.storage.local.get({ token: "" }, (v) => (token = v.token || ""));
  chrome.storage.onChanged.addListener((c) => {
    if (c.token) token = c.token.newValue || "";
  });

  const isEnabled = () => {
    try {
      return localStorage.getItem(ENABLED_KEY) !== "off";
    } catch {
      return true;
    }
  };

  const readCache = () => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const writeCache = (key, refs) => {
    try {
      const cache = readCache();
      cache[key] = { ...refs, at: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {}
  };

  // Finds one title link per PR, then the shared container whose direct children are the rows.
  function findRows() {
    const firstLink = new Map();
    for (const a of document.querySelectorAll("a[href]")) {
      if (a.closest(`[${MARK}]`)) continue;
      const m = PULL_PATH.exec(new URL(a.href, location.origin).pathname);
      if (!m) continue;
      const key = `${m[1]}#${m[2]}`;
      if (!firstLink.has(key)) firstLink.set(key, { a, repo: m[1], number: Number(m[2]) });
    }
    const entries = [...firstLink.entries()];
    if (entries.length < 2) return null;

    let container = entries[0][1].a.parentElement;
    while (container && !entries.every(([, e]) => container.contains(e.a))) {
      container = container.parentElement;
    }
    if (!container) return null;

    const rows = [];
    const seen = new Set();
    for (const [key, e] of entries) {
      let row = e.a;
      while (row.parentElement !== container) row = row.parentElement;
      if (seen.has(row)) return null;
      seen.add(row);
      rows.push({ key, repo: e.repo, number: e.number, row });
    }
    return { container, rows };
  }

  async function fetchRefs(repo, number) {
    if (token) {
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const pr = await res.json();
        return { head: pr.head.ref, base: pr.base.ref };
      }
    }
    // Same-origin fetches use the signed-in session, so private repos can work without a token.
    for (const path of [`/${repo}/pull/${number}/hovercard`, `/${repo}/pull/${number}`]) {
      const res = await fetch(path, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html" },
      });
      if (!res.ok) continue;
      const refs = parseRefs(await res.text());
      if (refs) return refs;
    }
    throw new Error(`No branch refs found for ${repo}#${number}`);
  }

  function parseRefs(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const branch = (el) => {
      if (!el) return null;
      const text = (el.getAttribute("title") || el.textContent).trim();
      return text.slice(text.lastIndexOf(":") + 1) || null;
    };
    let base = branch(doc.querySelector(".base-ref"));
    let head = branch(doc.querySelector(".head-ref"));
    if (!base || !head) {
      const refs = doc.querySelectorAll(".commit-ref");
      if (refs.length >= 2) {
        base = base || branch(refs[0]);
        head = head || branch(refs[1]);
      }
    }
    // React pages embed JSON, sometimes with escaped quotes.
    const json = (names) => {
      for (const name of names) {
        const flat = new RegExp(`\\\\?"${name}\\\\?"\\s*:\\s*\\\\?"([^"\\\\]+)`).exec(html);
        if (flat) return flat[1];
        const nested = new RegExp(`\\\\?"${name}\\\\?"\\s*:\\s*\\{[^{}]*?\\\\?"name\\\\?"\\s*:\\s*\\\\?"([^"\\\\]+)`).exec(html);
        if (nested) return nested[1];
      }
      return null;
    };
    base = base || json(["baseRefName", "baseBranch", "baseRef"]);
    head = head || json(["headRefName", "headBranch", "headRef"]);
    return base && head ? { head, base } : null;
  }

  function getRefs(repo, number) {
    const key = `${repo}#${number}`;
    const hit = readCache()[key];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit);
    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchRefs(repo, number)
          .then((refs) => (writeCache(key, refs), refs))
          .finally(() => inflight.delete(key))
      );
    }
    return inflight.get(key);
  }

  let failures = [];
  let hinted = false;

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const n = i++;
        try {
          out[n] = await fn(items[n]);
        } catch (err) {
          failures.push(err.message);
          out[n] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  function clear(container) {
    container.querySelectorAll(`:scope > [${MARK}="header"]`).forEach((h) => h.remove());
    for (const child of container.children) {
      if (child.hasAttribute(`${MARK}-row`)) {
        child.style.order = "";
        child.style.boxShadow = "";
        child.removeAttribute(`${MARK}-row`);
      }
    }
    if (container.hasAttribute(`${MARK}-container`)) {
      container.style.display = container.dataset.prStacksDisplay || "";
      container.style.flexDirection = "";
      container.removeAttribute(`${MARK}-container`);
    }
  }

  function makeHeader(container, unit) {
    const h = document.createElement(container.tagName === "UL" || container.tagName === "OL" ? "li" : "div");
    h.setAttribute(MARK, "header");
    h.textContent = `Stack of ${unit.members.length} onto ${unit.base}  ·  bottom to top`;
    Object.assign(h.style, {
      listStyle: "none",
      padding: "6px 16px",
      fontSize: "12px",
      fontWeight: "600",
      color: "var(--fgColor-muted, #59636e)",
      background: "var(--bgColor-muted, #f6f8fa)",
      borderTop: "1px solid var(--borderColor-default, #d1d9e0)",
      borderBottom: "1px solid var(--borderColor-muted, #d1d9e0b3)",
    });
    return h;
  }

  function render(container, rows, units) {
    const rowByKey = new Map(rows.map((r) => [r.key, r.row]));
    clear(container);
    if (!container.hasAttribute(`${MARK}-container`)) {
      container.dataset.prStacksDisplay = container.style.display;
      container.setAttribute(`${MARK}-container`, "");
    }
    container.style.display = "flex";
    container.style.flexDirection = "column";

    let order = 0;
    for (const unit of units) {
      if (unit.stacked) {
        const h = makeHeader(container, unit);
        h.style.order = String(order++);
        container.appendChild(h);
      }
      for (const pr of unit.members) {
        const row = rowByKey.get(pr.key);
        row.setAttribute(`${MARK}-row`, "");
        row.style.order = String(order++);
        if (unit.stacked) row.style.boxShadow = "inset 3px 0 0 var(--fgColor-accent, #0969da)";
      }
    }
  }

  function renderToggle() {
    let btn = document.querySelector(`[${MARK}="toggle"]`);
    const onList = LIST_PATH.test(location.pathname);
    if (!onList) {
      btn?.remove();
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.setAttribute(MARK, "toggle");
      Object.assign(btn.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: "100",
        padding: "6px 12px",
        borderRadius: "6px",
        font: "600 12px -apple-system, BlinkMacSystemFont, sans-serif",
        cursor: "pointer",
        color: "var(--fgColor-default, #1f2328)",
        background: "var(--bgColor-default, #fff)",
        border: "1px solid var(--borderColor-default, #d1d9e0)",
      });
      btn.addEventListener("click", () => {
        try {
          localStorage.setItem(ENABLED_KEY, isEnabled() ? "off" : "on");
        } catch {}
        lastSignature = "";
        schedule();
      });
      document.body.appendChild(btn);
    }
    btn.textContent = `Group by stack: ${isEnabled() ? "on" : "off"}`;
  }

  async function run() {
    renderToggle();
    if (!LIST_PATH.test(location.pathname)) return;
    const found = findRows();
    if (!found) return;
    const { container, rows } = found;

    const hasHeaders = !!container.querySelector(`:scope > [${MARK}="header"]`);
    const signature = `${isEnabled()}|${rows.map((r) => r.key).join(",")}`;
    if (signature === lastSignature && (hasHeaders || !isEnabled())) return;
    lastSignature = signature;

    if (!isEnabled()) {
      applying = true;
      clear(container);
      applying = false;
      return;
    }

    failures = [];
    const refs = await mapLimit(rows, 4, (r) => getRefs(r.repo, r.number));
    if (failures.length && !hinted) {
      hinted = true;
      console.info(
        `[pr-stacks] Could not read branches for ${failures.length} PRs${token ? " (token set but rejected?)" : ""}. ` +
          "Set a token in the extension options, for example the output of `gh auth token`."
      );
    }
    if (signature !== lastSignature || !container.isConnected) return;

    const prs = [];
    rows.forEach((r, index) => {
      const ref = refs[index];
      prs.push({ key: r.key, repo: r.repo, number: r.number, index, head: ref?.head ?? `?${r.key}`, base: ref?.base ?? "?" });
    });
    const units = buildUnits(prs);
    applying = true;
    render(container, rows, units);
    applying = false;
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  new MutationObserver(() => {
    if (!applying) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("turbo:load", schedule);
  window.addEventListener("popstate", schedule);
  schedule();
})();
