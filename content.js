(() => {
  const PULL_PATH = /^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/;
  const LIST_PATH = /^\/([^/]+\/[^/]+\/pulls|pulls)(\/|$)/;
  const CACHE_KEY = "prStacks.refs.v2";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const ENABLED_KEY = "prStacks.enabled";
  const MARK = "data-pr-stacks";

  let settings = { ...SETTINGS_DEFAULTS };
  let settingsVersion = 0;
  let lastSignature = "";
  let applying = false;
  const inflight = new Map();

  chrome.storage.local.get(SETTINGS_DEFAULTS, (v) => {
    settings = v;
    settingsVersion++;
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(changes).some((k) => k in SETTINGS_DEFAULTS)) return;
    for (const [k, { newValue }] of Object.entries(changes)) {
      if (k in SETTINGS_DEFAULTS) settings[k] = newValue ?? SETTINGS_DEFAULTS[k];
    }
    settingsVersion++;
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
      rows.push({ key, repo: e.repo, number: e.number, row, title: e.a.textContent.trim() });
    }
    return { container, rows };
  }

  async function fetchRefs(repo, number) {
    if (settings.token) {
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
        headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const pr = await res.json();
        return { head: pr.head.ref, base: pr.base.ref, title: pr.title, body: pr.body || "" };
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

  // Octicons stack-16 and git-pull-request-16 (MIT, github.com/primer/octicons).
  const ICONS = {
    stack:
      "M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.251 1.251 0 0 1 0-2.162ZM8.125 1.69a.248.248 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.248.248 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z",
    single:
      "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
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
    } else {
      summary.append(icon("single", "var(--fgColor-muted, #59636e)"), `Single PR onto ${unit.base}`);
    }
    h.appendChild(summary);

    if (settings.ticketsEnabled) addTicketLine(h, unit);
    return h;
  }

  function addTicketLine(header, unit) {
    const keys = stackTickets(unit.members, settings);
    // A single PR's title is already on the row below, so it only gets a description from the tracker.
    const fallback = unit.stacked ? describeStack(unit.members, keys) : "";
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
      keys.forEach((key, i) => {
        if (i) line.append(", ");
        const url = tickets?.[key]?.url || ticketUrl(key, settings);
        const el = document.createElement(url ? "a" : "span");
        if (url) {
          el.href = url;
          el.target = "_blank";
          el.rel = "noopener noreferrer";
        }
        el.textContent = key;
        el.style.fontWeight = "600";
        el.title = tickets?.[key]?.error || tickets?.[key]?.status || "";
        line.append(el);
      });
      const titles = keys.map((k) => tickets?.[k]?.title).filter(Boolean);
      const description = titles.length ? titles.join("; ") : fallback;
      if (description) line.append(`${keys.length ? "  ·  " : ""}${description}`);
      line.title = description;
    };
    draw(null);

    if (settings.tracker !== "none" && keys.length) {
      chrome.runtime.sendMessage({ type: "lookupTickets", keys }, (tickets) => {
        if (chrome.runtime.lastError || !tickets || !line.isConnected) return;
        const errors = Object.entries(tickets).filter(([, t]) => t.error);
        if (errors.length) console.info("[pr-stacks] Ticket lookup:", errors.map(([, t]) => t.error).join("; "));
        applying = true;
        draw(tickets);
        applying = false;
      });
    }
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

  async function run() {
    renderToggle();
    if (!LIST_PATH.test(location.pathname)) return;
    const found = findRows();
    if (!found) return;
    const { container, rows } = found;

    const hasHeaders = !!container.querySelector(`:scope > [${MARK}="header"]`);
    const signature = `${isEnabled()}|${settingsVersion}|${rows.map((r) => r.key).join(",")}`;
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
        `[pr-stacks] Could not read branches for ${failures.length} PRs${settings.token ? " (token set but rejected?)" : ""}. ` +
          "Set a token in the extension options, for example the output of `gh auth token`."
      );
    }
    if (signature !== lastSignature || !container.isConnected) return;

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
    timer = setTimeout(run, 250);
  }

  new MutationObserver(() => {
    if (!applying) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("turbo:load", schedule);
  window.addEventListener("popstate", schedule);
  schedule();
})();
