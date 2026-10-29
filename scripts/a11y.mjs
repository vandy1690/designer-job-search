// Accessibility check: runs axe-core (WCAG 2.2 A and AA rules) on every page, dialog and setup
// question of the demo, in the light and dark themes, in headless Google Chrome.
//   node scripts/a11y.mjs
// axe-core is not a dependency of this app. Point AXE at its axe.min.js file, or keep the default,
// which is the copy in the maintainer's portfolio project. Uses made-up demo data only.
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AXE = process.env.AXE || join(homedir(), "portfolio-astro", "node_modules", "axe-core", "axe.min.js");
const DEMO = 4361, EMPTY = 4362, CDP = 9343;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
const run = (cmd, args, env = {}) => { const c = spawn(cmd, args, { stdio: "ignore", env: { ...process.env, ...env } }); kids.push(c); return c; };
async function waitFor(url) { for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* starting */ } await sleep(250); } throw new Error(`Nothing at ${url}`); }

async function main() {
  const axeSource = await readFile(AXE, "utf8").catch(() => { throw new Error(`axe-core not found at ${AXE}. Set AXE to its axe.min.js.`); });
  const tmp = await mkdtemp(join(tmpdir(), "djs-a11y-"));
  run(process.execPath, [join(ROOT, "scripts", "demo.mjs")], { PORT: String(DEMO), SA_STORE: join(tmp, "s1"), SA_CONFIG: join(tmp, "c1") });
  run(process.execPath, [join(ROOT, "scripts", "demo.mjs"), "--empty"], { PORT: String(EMPTY), SA_STORE: join(tmp, "s2"), SA_CONFIG: join(tmp, "c2") });
  run(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(tmp, "chrome")}`, "--no-first-run", "--window-size=1440,900", "about:blank"]);
  await waitFor(`http://localhost:${DEMO}/`); await waitFor(`http://localhost:${EMPTY}/`);
  const pages = await (await waitFor(`http://127.0.0.1:${CDP}/json/list`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) waiters.splice(0).forEach((w) => w(m)); };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const event = (name) => new Promise((r) => { const w = (m) => (m.method === name ? r(m) : waiters.push(w)); waiters.push(w); });
  const js = async (expression) => { const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || "page error"); return m.result.result.value; };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const open = async (url) => { const l = event("Page.loadEventFired"); await send("Page.navigate", { url }); await l; await sleep(700); await js("document.fonts.ready.then(() => true)"); };
  const theme = async (t) => { await js(`localStorage.setItem("dash-theme", "${t}"); document.documentElement.setAttribute("data-theme", "${t}"); true`); await sleep(150); };

  const results = new Map(); // rule -> { impact, help, url, where: Set }
  const check = async (where) => {
    await js(`window.axe ? true : (function () { ${axeSource}\n; return true; })()`);
    const r = await js(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then((x) => x.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, url: v.helpUrl, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + (n.any[0] && n.any[0].message ? " :: " + n.any[0].message.slice(0, 140) : "")) })))`);
    for (const v of r) {
      const cur = results.get(v.id) || { impact: v.impact, help: v.help, url: v.url, where: new Map() };
      cur.where.set(where, v.nodes);
      results.set(v.id, cur);
    }
    return r.length;
  };

  const VIEWS = ["overview", "pull", "leads", "latest", "conclusions", "reading", "health", "applications", "contacts", "settings"];
  await open(`http://localhost:${DEMO}/#overview`);
  for (const t of ["light", "dark"]) {
    await theme(t);
    for (const v of VIEWS) { await js(`location.hash = "#${v}"; true`); await sleep(400); console.log(`${t} ${v}: ${await check(`${t} ${v}`)} problems`); }
  }
  await theme("light");
  const dialogs = [
    ["reach out", "#leads", `document.querySelector("[data-lead-reach]").click()`],
    ["add application", "#applications", `document.getElementById("app-add").click()`],
    ["log a contact", "#contacts", `document.getElementById("touch-add").click()`],
    ["edit a read", "#pull", `document.querySelector("[data-edit-match]").click()`],
    ["terms", "#overview", `document.querySelector("#foot [data-show=terms]").click()`]
  ];
  for (const [name, hash, opener] of dialogs) {
    await js(`location.hash = "${hash}"; true`); await sleep(400);
    await js(`${opener}; true`); await sleep(400);
    console.log(`dialog ${name}: ${await check(`dialog ${name}`)} problems`);
    await js(`document.getElementById("dialog").close(); true`);
  }
  // The setup questions, on a fresh install.
  await open(`http://localhost:${EMPTY}/`);
  const next = () => js(`document.getElementById("w-next").click(); true`).then(() => sleep(600));
  const fill = (pairs) => js(`(${JSON.stringify(pairs)}).forEach(([i, v]) => { document.getElementById(i).value = v; }); true`);
  const steps = [
    ["welcome", async () => { await js(`document.getElementById("w-terms").click(); true`); }],
    ["you", () => fill([["w-name", "Alex"]])], ["place", () => fill([["w-city", "Portland, Oregon"]])], ["jobs", null], ["terms", null], ["boards", null],
    ["sites", () => fill([["w-sites", "alexrivera.example"]])], ["ga", async () => { await js(`document.querySelector('input[name="w-ga"][value="no"]').click(); true`); }],
    ["google", async () => { await js(`document.getElementById("w-alt").click(); true`); await sleep(600); }], ["apps", null], ["done", null]
  ];
  for (const [name, act] of steps) {
    console.log(`setup ${name}: ${await check(`setup ${name}`)} problems`);
    if (name === "done") break;
    if (act) await act();
    if (name !== "google") await next();
  }
  await theme("dark");
  console.log(`setup done (dark): ${await check("setup done dark")} problems`);

  console.log("\n==== Results ====");
  if (!results.size) console.log("No WCAG 2.2 A or AA problems found by axe.");
  for (const [rule, v] of results) {
    console.log(`\n${rule} (${v.impact}): ${v.help}\n  ${v.url}`);
    for (const [where, nodes] of v.where) console.log(`  - ${where}\n      ${nodes.join("\n      ")}`);
  }
  ws.close();
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
const guard = setTimeout(() => { console.error("Timed out."); kids.forEach((k) => k.kill()); process.exit(1); }, 240000);
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => { clearTimeout(guard); kids.forEach((k) => k.kill()); });
