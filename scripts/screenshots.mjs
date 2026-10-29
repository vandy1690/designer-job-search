// Regenerates the pictures in docs/screenshots from the demo, in headless Google Chrome.
//   node scripts/screenshots.mjs
// It runs the made-up demo data and a fresh install on their own ports, never your own store/,
// so the pictures carry no personal information. Set CHROME to Chrome's path if it lives elsewhere.
import { spawn } from "node:child_process";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEMO = 4351, EMPTY = 4352, CDP = 9339;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* not up yet */ } await sleep(250); }
  throw new Error(`Nothing answered at ${url}`);
}
function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, { stdio: "ignore", env: { ...process.env, ...env } });
  kids.push(child);
  return child;
}

// A tiny Chrome DevTools Protocol client: just enough to load, click and capture.
async function connect() {
  const pages = await (await waitFor(`http://127.0.0.1:${CDP}/json/list`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map(), waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const [r, j] = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(m.error.message)) : r(m.result); }
    else if (m.method) for (const w of waiters.splice(0)) w(m);
  };
  const send = (method, params = {}) => new Promise((r, j) => { pending.set(++id, [r, j]); ws.send(JSON.stringify({ id, method, params })); });
  const event = (name) => new Promise((r) => { const wait = (m) => (m.method === name ? r(m) : waiters.push(wait)); waiters.push(wait); });
  return { send, event, close: () => ws.close() };
}

async function main() {
  // Throwaway data and config folders, so nothing from a real install (a Google key someone
  // uploaded while testing) can reach a picture.
  const profile = await mkdtemp(join(tmpdir(), "sa-shots-"));
  run(process.execPath, [join(ROOT, "scripts", "demo.mjs")], { PORT: String(DEMO), SA_STORE: join(profile, "demo-store"), SA_CONFIG: join(profile, "demo-config") });
  run(process.execPath, [join(ROOT, "scripts", "demo.mjs"), "--empty"], { PORT: String(EMPTY), SA_STORE: join(profile, "empty-store"), SA_CONFIG: join(profile, "empty-config") });
  run(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "about:blank"], { TZ: "America/Los_Angeles" });
  await waitFor(`http://localhost:${DEMO}/`);
  await waitFor(`http://localhost:${EMPTY}/`);
  const c = await connect();
  await c.send("Page.enable");
  await mkdir(OUT, { recursive: true });

  const js = async (expression) => (await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const size = (height) => c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height, deviceScaleFactor: 2, mobile: false });
  // Show the font everyone else gets. This Mac may have Nickel Gothic installed, which the app
  // would otherwise find and use.
  const publicFont = `if (!document.getElementById("shot-font")) document.head.insertAdjacentHTML("beforeend", '<style id="shot-font">:root { --sdc-font-display: "League Gothic", "Inter", system-ui, sans-serif; }</style>'); true`;
  const settle = async () => { await js(`new Promise((r) => { const t = setInterval(() => { if (!document.getElementById("boot")) { clearInterval(t); r(true); } }, 50); })`); await js(publicFont); await js("document.fonts.ready.then(() => true)"); await sleep(500); };
  const open = async (url) => { const loaded = c.event("Page.loadEventFired"); await c.send("Page.navigate", { url }); await loaded; await settle(); };
  const reload = async () => { const loaded = c.event("Page.loadEventFired"); await c.send("Page.reload", {}); await loaded; await settle(); };
  const view = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}; true`); await sleep(500); };
  // at: a selector to scroll to the top of the picture, below the sticky top bar.
  const shot = async (name, height = 900, at = "") => {
    await size(height);
    await js(`(() => { const el = ${JSON.stringify(at)} && document.querySelector(${JSON.stringify(at)}); window.scrollTo(0, el ? el.getBoundingClientRect().top + window.scrollY - 96 : 0); document.activeElement && document.activeElement.blur(); return true; })()`);
    await sleep(300);
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`docs/screenshots/${name}.png`);
  };

  await size(900);
  // The demo: every person, company and website is made up.
  await open(`http://localhost:${DEMO}/#overview`);
  await shot("overview");
  await view("#pull"); await shot("application-pull", 1180);
  await view("#leads"); await shot("job-matches", 1180);
  await js(`document.querySelector("[data-lead-reach]").click(); true`); await sleep(500);
  await shot("reach-out", 1150);
  await js(`document.getElementById("dialog").close(); true`);
  await view("#latest"); await shot("latest-pull", 1000);
  await view("#reading"); await shot("reading-and-reach", 1100);
  await view("#health"); await shot("data-health");
  await view("#applications"); await shot("applications");
  await view("#settings?go=boards"); await sleep(300); await shot("job-boards", 1400, "#set-boards");
  await view("#overview");
  await js(`localStorage.setItem("dash-theme", "dark"); true`);
  await reload();
  await shot("overview-dark");
  await js(`localStorage.removeItem("dash-theme"); true`);

  // A fresh install: the setup questions, from the welcome to the summary.
  await open(`http://localhost:${EMPTY}/`);
  const next = () => js(`document.getElementById("w-next").click(); true`).then(() => sleep(500));
  const fill = (values) => js(`(${JSON.stringify(values)}).forEach(([id, v]) => { document.getElementById(id).value = v; }); true`);
  await js(`document.getElementById("w-terms").click(); true`);
  await shot("setup-1-welcome");
  await next();
  await fill([["w-name", "Alex"], ["w-pitch", "I design payments products and the design systems behind them."]]);
  await shot("setup-2-about-you");
  await next(); await fill([["w-city", "Portland, Oregon"]]);
  await next(); await shot("setup-3-jobs");
  await next(); await fill([["w-floor", "160000"]]);
  await next(); await sleep(300); await shot("setup-4-job-boards", 1180);
  await next(); await fill([["w-sites", "alexrivera.example"]]);
  await next(); await js(`document.querySelector('input[name="w-ga"][value="unsure"]').click(); true`); await sleep(200);
  await shot("setup-5-google-analytics", 1000);
  await next(); await shot("setup-6-connect-google", 1180);
  await js(`document.getElementById("w-alt").click(); true`); await sleep(500);
  await next(); await shot("setup-7-done", 1000);

  c.close();
  await rm(profile, { recursive: true, force: true });
}

// Never hang: give up after two minutes.
const guard = setTimeout(() => { console.error("Timed out waiting for Chrome or the app."); for (const k of kids) k.kill(); process.exit(1); }, 120000);
main().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => { clearTimeout(guard); for (const k of kids) k.kill(); });
