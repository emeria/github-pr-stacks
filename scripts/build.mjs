// Builds store-ready folders and zips for Chrome and Firefox from the same source files.
//   node scripts/build.mjs            -> dist/chrome, dist/firefox and a zip of each
// The repo root stays loadable as an unpacked Chrome extension; only Firefox needs a different manifest.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "options.html",
  "options.js",
  "problems.js",
  "status.js",
  "settings.js",
  "stacks.js",
  "tickets.js",
  "icons",
  "LICENSE",
];

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

function firefoxManifest(m) {
  const out = { ...m };
  // Firefox runs MV3 background code as an event page, not a service worker.
  out.background = { scripts: ["settings.js", "background.js"] };
  out.browser_specific_settings = {
    gecko: {
      id: "github-pr-stacks@emeria",
      strict_min_version: "140.0",
      // Nothing is collected at install. A GitHub token or Jira credentials are only sent to GitHub or Jira
      // after the user saves them and agrees to Firefox's prompt (see options.js).
      data_collection_permissions: { required: ["none"], optional: ["authenticationInfo", "websiteContent"] },
    },
    gecko_android: { strict_min_version: "142.0" },
  };
  return out;
}

rmSync(dist, { recursive: true, force: true });
for (const [browser, m] of [
  ["chrome", manifest],
  ["firefox", firefoxManifest(manifest)],
]) {
  const dir = join(dist, browser);
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) cpSync(join(root, f), join(dir, f), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  const zip = join(dist, `github-pr-stacks-${browser}-${m.version}.zip`);
  // The bsdtar that ships with Windows 10+ and macOS writes zips; Linux usually has zip instead.
  // Files are listed by name so the archive has manifest.json at its root, not ./manifest.json.
  if (process.platform === "linux") execFileSync("zip", ["-q", "-r", zip, ...FILES], { cwd: dir, stdio: "inherit" });
  else {
    // On Windows, name System32's tar so Git Bash's GNU tar (no zip support) isn't picked up from PATH.
    const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
    execFileSync(tar, ["-a", "-c", "-f", zip, ...FILES], { cwd: dir, stdio: "inherit" });
  }
  console.log(`Built ${zip}`);
}
