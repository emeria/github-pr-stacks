(() => {
  const PULL_PATH = /^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/;
  const LIST_PATH = /^\/([^/]+\/[^/]+\/pulls|pulls)(\/|$)/;
  const CACHE_KEY = "prStacks.refs.v2";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  // Older entries are still used when GitHub can't be reached, and dropped after a day.
  const STALE_MS = 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10 * 1000;
  // The loader only appears when grouping takes longer than this, so cached pages don't flash it.
  const LOADER_DELAY_MS = 300;
  const ENABLED_KEY = "prStacks.enabled";
  const MARK = "data-pr-stacks";

  let settings = { ...SETTINGS_DEFAULTS };
  let settingsVersion = 0;
  let lastSignature = "";
  let running = "";
  let applying = false;
  const inflight = new Map();
  // Set when the API refuses the token in a way that applies to every PR (bad token, SSO, rate limit),
  // so the rest of the page skips the API instead of repeating the same failing call.
  let apiBlock = null;

  chrome.storage.local.get(SETTINGS_DEFAULTS, (v) => {
    settings = normalizeSettings(v);
    settingsVersion++;
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(changes).some((k) => k in SETTINGS_DEFAULTS)) return;
    for (const [k, { newValue }] of Object.entries(changes)) {
      if (k in SETTINGS_DEFAULTS) settings[k] = newValue ?? SETTINGS_DEFAULTS[k];
    }
    settings = normalizeSettings(settings);
    settingsVersion++;
    // New settings deserve a fresh attempt and a fresh notice if it still fails.
    apiBlock = null;
    try {
      sessionStorage.removeItem(DISMISSED_KEY);
    } catch {}
    schedule();
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
      const now = Date.now();
      for (const [k, v] of Object.entries(cache)) if (!(now - v.at < STALE_MS)) delete cache[k];
      cache[key] = { ...refs, at: now };
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
      rows.push({ key, repo: e.repo, number: e.number, row, title: e.a.textContent.trim() });
    }
    return { container, rows };
  }

  // Firefox content scripts fetch as the extension, without the page's cookies; content.fetch
  // fetches as the page, so the signed-in fallback works for private repos there too.
  const pageFetch = typeof content !== "undefined" && typeof content?.fetch === "function" ? content.fetch.bind(content) : fetch;

  // Failures carry a reason so the toast can say what to fix. With a token, the API's reason wins,
  // since the page fallback failing too usually has the same cause.
  async function fetchRefs(repo, number) {
    let failure = null;
    let reached = false;
    if (apiBlock && apiBlock.resetAt && Date.now() > apiBlock.resetAt) apiBlock = null;
    if (settings.token && apiBlock) failure = apiBlock;
    else if (settings.token) {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
          headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        reached = true;
        if (res.ok) {
          const pr = await res.json();
          return { head: pr.head.ref, base: pr.base.ref, title: pr.title, body: pr.body || "" };
        }
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        failure = { reason: apiReason(res.status, res.headers), resetAt: reset ? reset * 1000 : null };
        if (["unauthorized", "sso", "rate-limited"].includes(failure.reason)) apiBlock = failure;
      } catch {}
    }
    // Same-origin fetches use the signed-in session, so private repos can work without a token.
    for (const path of [`/${repo}/pull/${number}/hovercard`, `/${repo}/pull/${number}`]) {
      try {
        const res = await pageFetch(path, {
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        reached = true;
        if (!res.ok) continue;
        const refs = parseRefs(await res.text());
        if (refs) return refs;
      } catch {}
    }
    throw { repo, number, ...(failure || { reason: reached ? "unreadable" : "network" }) };
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
          // Branches rarely change, so a stale answer beats no grouping when GitHub can't be read.
          .catch((err) => {
            if (hit && Date.now() - hit.at < STALE_MS) return hit;
            throw err;
          })
          .finally(() => inflight.delete(key))
      );
    }
    return inflight.get(key);
  }

  // Collects each item's failure into the caller's list, so overlapping runs never share one.
  async function mapLimit(items, limit, fn, failures) {
    const out = new Array(items.length);
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const n = i++;
        try {
          out[n] = await fn(items[n]);
        } catch (err) {
          failures.push(err?.reason ? err : { reason: "unreadable", repo: items[n].repo });
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

  // Octicons stack-16, git-pull-request-16 and alert-16 (MIT, github.com/primer/octicons).
  const ICONS = {
    stack:
      "M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.251 1.251 0 0 1 0-2.162ZM8.125 1.69a.248.248 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.248.248 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z",
    single:
      "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
    alert:
      "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  };

  function icon(name, color) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.style.fill = color;
    svg.style.flex = "none";
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function makeHeader(container, unit) {
    const h = document.createElement(container.tagName === "UL" || container.tagName === "OL" ? "li" : "div");
    h.setAttribute(MARK, "header");
    Object.assign(h.style, {
      listStyle: "none",
      padding: unit.stacked ? "6px 16px" : "3px 16px",
      fontSize: "12px",
      fontWeight: "600",
      color: "var(--fgColor-muted, #59636e)",
      background: "var(--bgColor-muted, #f6f8fa)",
      borderTop: "1px solid var(--borderColor-default, #d1d9e0)",
      borderBottom: "1px solid var(--borderColor-muted, #d1d9e0b3)",
    });

    const summary = document.createElement("div");
    Object.assign(summary.style, { display: "flex", alignItems: "center", gap: "6px" });
    if (unit.stacked) {
      summary.append(icon("stack", "var(--fgColor-accent, #0969da)"));
      const name = stackName(unit.members);
      if (name) {
        const strong = document.createElement("span");
        strong.textContent = name;
        strong.style.color = "var(--fgColor-default, #1f2328)";
        summary.append(strong, "  ·  ");
      }
      summary.append(`Stack of ${unit.members.length} onto ${unit.base}  ·  bottom to top`);
    } else if (unit.base === "?") {
      summary.append(icon("alert", "var(--fgColor-attention, #9a6700)"), "Branches unknown, not grouped");
    } else {
      summary.append(icon("single", "var(--fgColor-muted, #59636e)"), `Single PR onto ${unit.base}`);
    }
    h.appendChild(summary);

    if (settings.ticketsEnabled) addTicketLine(h, unit);
    return h;
  }

  function addTicketLine(header, unit) {
    const { source, keys } = stackReferences(unit.members, settings);
    const repo = unit.members[0].repo;
    const label = (key) => (source === "github" ? issueLabel(key, repo) : key);
    // A single PR's title is already on the row below, so it only gets a description from the tracker.
    const fallback = unit.stacked ? describeStack(unit.members, [...keys, ...keys.map(label)]) : "";
    if (!keys.length && !fallback) return;

    const line = document.createElement("div");
    Object.assign(line.style, {
      marginTop: "2px",
      paddingLeft: "20px",
      fontWeight: "400",
      color: "var(--fgColor-default, #1f2328)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    header.appendChild(line);

    const draw = (tickets) => {
      line.replaceChildren();
      // Issue references are guesses, so ones GitHub doesn't know as issues are dropped quietly.
      const shown = keys.filter((key) => !tickets?.[key]?.missing);
      shown.forEach((key, i) => {
        if (i) line.append(", ");
        const url = tickets?.[key]?.url || (source === "github" ? issueUrl(key) : ticketUrl(key, settings));
        const el = document.createElement(url ? "a" : "span");
        if (url) {
          el.href = url;
          el.target = "_blank";
          el.rel = "noopener noreferrer";
        }
        el.textContent = label(key);
        el.style.fontWeight = "600";
        el.title = tickets?.[key]?.error || tickets?.[key]?.status || "";
        line.append(el);
      });
      const titles = shown.map((k) => tickets?.[k]?.title).filter(Boolean);
      const description = titles.length ? titles.join("; ") : fallback;
      if (description) line.append(`${shown.length ? "  ·  " : ""}${description}`);
      line.title = description;
    };
    draw(null);

    if (source === "github") {
      lookupIssues(keys).then((issues) => {
        if (!line.isConnected) return;
        for (const [key, t] of Object.entries(issues)) {
          if (t.error) issueFailures.set(key, { key, error: t.error, reason: t.reason });
        }
        setProblem("issues", describeTicketFailures([...issueFailures.values()], "github"));
        applying = true;
        draw(issues);
        applying = false;
      });
    } else if (source === "jira" && settings.tracker !== "none") {
      chrome.runtime.sendMessage({ type: "lookupTickets", keys }, (tickets) => {
        if (chrome.runtime.lastError || !tickets || !line.isConnected) return;
        for (const [key, t] of Object.entries(tickets)) {
          if (t.error) ticketFailures.set(key, { key, error: t.error, reason: t.reason });
        }
        setProblem("tickets", describeTicketFailures([...ticketFailures.values()]));
        applying = true;
        draw(tickets);
        applying = false;
      });
    }
  }

  // Issue titles come from GitHub's API, with the token when one is saved. Found and missing issues
  // are cached for 30 minutes; errors are not, so they are retried on the next render.
  const ISSUE_CACHE_KEY = "prStacks.issues.v1";
  const ISSUE_TTL_MS = 30 * 60 * 1000;

  async function lookupIssue(ref) {
    const [repo, number] = ref.split("#");
    const headers = { Accept: "application/vnd.github+json" };
    if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return { error: `GitHub didn't respond for ${ref}`, reason: "network" };
    }
    if (res.status === 404 || res.status === 410) return { missing: true };
    if (!res.ok) return { error: `GitHub returned HTTP ${res.status} for ${ref}`, reason: issueReason(apiReason(res.status, res.headers)) };
    const issue = await res.json();
    if (issue.pull_request) return { missing: true };
    return { title: issue.title, status: issue.state, url: issue.html_url };
  }

  async function lookupIssues(refs) {
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(ISSUE_CACHE_KEY) || "{}");
    } catch {}
    const out = {};
    await Promise.all(
      refs.map(async (ref) => {
        const hit = cache[ref];
        if (hit && Date.now() - hit.at < ISSUE_TTL_MS) return (out[ref] = hit);
        out[ref] = await lookupIssue(ref);
        if (!out[ref].error) cache[ref] = { ...out[ref], at: Date.now() };
      })
    );
    try {
      localStorage.setItem(ISSUE_CACHE_KEY, JSON.stringify(cache));
    } catch {}
    return out;
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
      const h = makeHeader(container, unit);
      h.style.order = String(order++);
      container.appendChild(h);
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

  // One toast above the toggle lists current problems. Each slot (refs, tickets, crash) holds at most one,
  // and a dismissed problem stays hidden for the rest of the tab's session.
  const problems = new Map();
  const ticketFailures = new Map();
  const issueFailures = new Map();
  const DISMISSED_KEY = "prStacks.dismissed";

  const dismissed = () => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || "[]"));
    } catch {
      return new Set();
    }
  };
  const dismiss = (id) => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed(), id]));
    } catch {}
    renderToast();
  };

  function setProblem(slot, problem) {
    const before = problems.get(slot)?.id;
    if (problem) problems.set(slot, problem);
    else problems.delete(slot);
    if (before !== problem?.id) renderToast();
  }

  function renderToast() {
    const wasApplying = applying;
    applying = true;
    let toast = document.querySelector(`[${MARK}="toast"]`);
    const hidden = dismissed();
    const shown = LIST_PATH.test(location.pathname) ? [...problems.values()].filter((p) => !hidden.has(p.id)) : [];
    if (!shown.length) {
      toast?.remove();
      applying = wasApplying;
      return;
    }
    if (!toast) {
      toast = document.createElement("div");
      toast.setAttribute(MARK, "toast");
      toast.setAttribute("role", "status");
      Object.assign(toast.style, {
        position: "fixed",
        right: "16px",
        bottom: "56px",
        zIndex: "100",
        width: "min(380px, calc(100vw - 32px))",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px 14px",
        borderRadius: "8px",
        font: "12px/1.5 -apple-system, BlinkMacSystemFont, sans-serif",
        color: "var(--fgColor-default, #1f2328)",
        background: "var(--overlay-bgColor, var(--bgColor-default, #fff))",
        border: "1px solid var(--borderColor-default, #d1d9e0)",
        boxShadow: "var(--shadow-floating-small, 0 6px 12px -3px #25292e33)",
      });
      document.body.appendChild(toast);
    }
    toast.replaceChildren(
      ...shown.map((p) => {
        const item = document.createElement("div");
        const title = document.createElement("div");
        Object.assign(title.style, { display: "flex", alignItems: "center", gap: "6px", fontWeight: "600", fontSize: "13px" });
        title.append(icon("alert", "var(--fgColor-attention, #9a6700)"), p.title);
        const detail = document.createElement("div");
        Object.assign(detail.style, { marginTop: "2px", paddingLeft: "20px", color: "var(--fgColor-muted, #59636e)" });
        detail.textContent = p.detail;
        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "8px", paddingLeft: "20px" });
        const button = (label, onClick) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = label;
          Object.assign(b.style, {
            padding: "3px 10px",
            borderRadius: "6px",
            font: "inherit",
            fontWeight: "500",
            cursor: "pointer",
            color: "var(--fgColor-default, #1f2328)",
            background: "var(--button-default-bgColor-rest, #f6f8fa)",
            border: "1px solid var(--borderColor-default, #d1d9e0)",
          });
          b.addEventListener("click", onClick);
          return b;
        };
        if (p.retry) actions.append(button("Try again", retry));
        if (p.options) actions.append(button("Open options", () => chrome.runtime.sendMessage({ type: "openOptions" })));
        actions.append(button("Dismiss", () => dismiss(p.id)));
        item.append(title, detail, actions);
        return item;
      })
    );
    applying = wasApplying;
  }

  // Forgets failures and runs again; cached branches that were read successfully are kept.
  function retry() {
    apiBlock = null;
    problems.clear();
    lastSignature = "";
    renderToast();
    schedule();
  }

  // The extension's icon inside a spinning ring, beside the toggle, while branches are being read.
  const LOGO =
    '<rect x="8" y="8" width="112" height="112" rx="26" fill="#3346c8"/><g transform="translate(22 22) scale(3.5)"><path d="M5 3.5V21.5" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/><circle cx="5" cy="3.5" r="2.3" fill="#fff"/><circle cx="5" cy="15.5" r="2.3" fill="#fff"/><rect x="5" y="2.6" width="16" height="1.8" rx="0.9" fill="#fff"/><g transform="translate(11 6) scale(0.75)"><path d="M6 0L2 2L6 4L10 2Z" fill="#fff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 4.5L6 6.5L10 4.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M2 7L6 9L10 7" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g><rect x="5" y="14.6" width="16" height="1.8" rx="0.9" fill="#fff"/><g transform="translate(11 18.5) scale(0.75)"><path d="M6 0L10 2L6 4L2 2Z" fill="#fff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></g></g>';
  let loaderTimer = null;

  // Repeated calls keep the first timer, so a busy page can't keep pushing the loader back.
  function showLoader() {
    if (loaderTimer || document.querySelector(`[${MARK}="loader"]`)) return;
    loaderTimer = setTimeout(() => {
      loaderTimer = null;
      if (document.querySelector(`[${MARK}="loader"]`)) return;
      const wasApplying = applying;
      applying = true;
      if (!document.querySelector(`[${MARK}="loader-style"]`)) {
        const style = document.createElement("style");
        style.setAttribute(MARK, "loader-style");
        style.textContent =
          "@keyframes pr-stacks-spin { to { transform: rotate(360deg); } }" +
          "@keyframes pr-stacks-pulse { 50% { opacity: .55; } }" +
          `[${MARK}="loader"] .ring { transform-origin: 50% 50%; animation: pr-stacks-spin .9s linear infinite; }` +
          `@media (prefers-reduced-motion: reduce) { [${MARK}="loader"] .ring { animation: none; } [${MARK}="loader"] { animation: pr-stacks-pulse 1.6s ease-in-out infinite; } }`;
        document.head.appendChild(style);
      }
      const toggle = document.querySelector(`[${MARK}="toggle"]`);
      const loader = document.createElement("div");
      loader.setAttribute(MARK, "loader");
      loader.setAttribute("role", "status");
      loader.setAttribute("aria-label", "Grouping pull requests by stack");
      loader.title = "Grouping pull requests by stack";
      Object.assign(loader.style, {
        position: "fixed",
        bottom: "14px",
        right: `${16 + (toggle?.offsetWidth || 0) + 8}px`,
        zIndex: "100",
        width: "32px",
        height: "32px",
      });
      // Parsed as SVG rather than set through innerHTML, which store reviewers flag.
      const svg = new DOMParser().parseFromString(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">' +
          '<circle cx="16" cy="16" r="14.5" fill="none" stroke="#d1d9e0" stroke-width="2"/>' +
          '<circle class="ring" cx="16" cy="16" r="14.5" fill="none" stroke="#3346c8" stroke-width="2" stroke-linecap="round" stroke-dasharray="22 70"/>' +
          `<svg x="6" y="6" width="20" height="20" viewBox="8 8 112 112">${LOGO}</svg></svg>`,
        "image/svg+xml"
      ).documentElement;
      svg.firstChild.style.stroke = "var(--borderColor-default, #d1d9e0)";
      loader.appendChild(document.importNode(svg, true));
      document.body.appendChild(loader);
      applying = wasApplying;
    }, LOADER_DELAY_MS);
  }

  function hideLoader() {
    clearTimeout(loaderTimer);
    loaderTimer = null;
    const loader = document.querySelector(`[${MARK}="loader"]`);
    if (!loader) return;
    const wasApplying = applying;
    applying = true;
    loader.remove();
    applying = wasApplying;
  }

  async function run() {
    renderToggle();
    renderToast();
    if (!LIST_PATH.test(location.pathname)) return;
    const found = findRows();
    if (!found) return;
    const { container, rows } = found;

    const hasHeaders = !!container.querySelector(`:scope > [${MARK}="header"]`);
    const signature = `${isEnabled()}|${settingsVersion}|${rows.map((r) => r.key).join(",")}`;
    if (signature === lastSignature && (hasHeaders || !isEnabled())) return;
    lastSignature = signature;
    // GitHub's page changes often; a run already reading this same list doesn't need a twin.
    if (signature === running) return;

    if (!isEnabled()) {
      applying = true;
      clear(container);
      applying = false;
      problems.clear();
      renderToast();
      return;
    }

    const failures = [];
    showLoader();
    running = signature;
    let refs;
    try {
      refs = await mapLimit(rows, 4, (r) => getRefs(r.repo, r.number), failures);
    } finally {
      if (running === signature) running = "";
      // A newer run owns the loader if the page changed while this one was waiting.
      if (signature === lastSignature) hideLoader();
    }
    if (signature !== lastSignature) return;
    // GitHub re-rendered the list meanwhile; go again on the new one, now mostly from cache.
    if (!container.isConnected) return schedule();
    setProblem("refs", describeRefFailures(failures, { total: rows.length, hasToken: !!settings.token }));
    ticketFailures.clear();
    issueFailures.clear();
    setProblem("tickets", null);
    setProblem("issues", null);
    // With nothing read there is nothing to group, so leave GitHub's list as it was and let the toast explain.
    if (failures.length === rows.length) {
      applying = true;
      clear(container);
      applying = false;
      return;
    }

    const prs = [];
    rows.forEach((r, index) => {
      const ref = refs[index];
      prs.push({
        key: r.key,
        repo: r.repo,
        number: r.number,
        index,
        head: ref?.head ?? `?${r.key}`,
        base: ref?.base ?? "?",
        title: ref?.title || r.title,
        body: ref?.body || "",
      });
    });
    const units = buildUnits(prs);
    applying = true;
    render(container, rows, units);
    applying = false;
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(safeRun, 250);
  }

  // A bug or a GitHub page change should show up once in the toast, not as an error on every DOM change.
  async function safeRun() {
    try {
      await run();
    } catch (err) {
      setProblem("crash", {
        id: `crash:${err?.message}`,
        title: "Having trouble stacking pull requests",
        detail: `Something went wrong while grouping this page: ${err?.message || err}. Reload the page; if it keeps happening, GitHub may have changed its pages.`,
      });
    }
  }

  new MutationObserver(() => {
    if (!applying) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("turbo:load", schedule);
  window.addEventListener("popstate", schedule);
  schedule();
})();
