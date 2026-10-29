// Designer Job Search local server. No dependencies: `node server.mjs`, then open http://localhost:4340/
// Serves the app, keeps its data as JSON files in ./store, holds the Google connection, and pulls
// Google Analytics on its own every few hours while it runs. Answers this machine only: it binds
// to the loopback addresses, checks the Host header, and refuses cross-site writes.
import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, readdir, unlink, stat, chmod } from "node:fs/promises";
import { join, extname, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGoogle } from "./lib/google.mjs";
import { createPuller } from "./lib/pull.mjs";
import { readJob } from "./lib/job.mjs";
import { checkLeads } from "./lib/leads.mjs";
import { testBoard, adzunaWorks } from "./lib/feeds.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
// SA_STORE and SA_CONFIG move the data folders; SA_DEMO=1 runs on made-up data with Google and
// the job boards switched off (see scripts/demo.mjs).
const STORE = process.env.SA_STORE ? resolve(process.env.SA_STORE) : join(ROOT, "store");
const CONFIG = process.env.SA_CONFIG ? resolve(process.env.SA_CONFIG) : join(ROOT, "config");
const DEMO = process.env.SA_DEMO === "1";
const BACKUPS = join(STORE, ".backups");
const PORT = Number(process.env.PORT || 4340);
const NAMES = new Set(["settings", "matches", "notes", "pulls", "applications", "touches", "leads"]);
const MAX_BODY = 20 * 1024 * 1024;
const KEEP_BACKUPS = 30;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"
};
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
// Only these files are ever served, matched exactly and case-sensitively. macOS ignores case in
// file names, so a deny list is not enough: /STORE/... would otherwise reach ./store.
const PUBLIC = /^(index\.html|sdc\.css|css\/[a-z0-9-]+\.css|js\/[a-z0-9-]+\.js|fonts\/[a-z0-9-]+\.woff2|assets\/(icon\.svg|icon-180\.png))$/;
// Sent with every response.
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://use.typekit.net https://p.typekit.net https://fonts.googleapis.com",
    "font-src 'self' https://use.typekit.net https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join("; "),
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cache-Control": "no-store"
};

const google = createGoogle(CONFIG, `http://127.0.0.1:${PORT}/oauth/callback`);
const puller = createPuller(STORE, google);

function send(res, code, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": type, ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const redirect = (res, to) => { res.writeHead(302, { ...SECURITY_HEADERS, Location: to }); res.end(); };

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const jsonBody = async (req) => {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) throw Object.assign(new Error("JSON only"), { status: 415 });
  const text = await readBody(req);
  return text ? JSON.parse(text) : {};
};

// Data files are readable by this Mac user only (folders 700, files 600).
async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}
async function lockDown(dir) {
  try { await chmod(dir, 0o700); } catch { return; }
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, f.name);
    if (f.isDirectory()) await lockDown(full);
    else await chmod(full, 0o600).catch(() => {});
  }
}

async function backup(name) {
  const file = join(STORE, `${name}.json`);
  try { await stat(file); } catch { return; }
  await mkdir(BACKUPS, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(join(BACKUPS, `${name}-${stamp}.json`), await readFile(file), { mode: 0o600 });
  const old = (await readdir(BACKUPS)).filter((f) => f.startsWith(`${name}-`)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) await unlink(join(BACKUPS, f));
}

// Only this app's own page may call the API. Browsers label every request with where it came
// from (Sec-Fetch-Site, Origin); anything from another site is refused. Changes also need a JSON
// body and a custom header, which a page on another site cannot send without the server's consent.
function apiAllowed(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ""))) return false;
  if (req.method !== "GET") {
    if (req.headers["x-site-analytics"] !== "1") return false;
    if (!(req.headers["content-type"] || "").startsWith("application/json")) return false;
  }
  return true;
}

// Application links: read every watched job board and keep the result. One check at a time.
let leadsRunning = null;
// Keys for job boards that need one (Adzuna), kept beside the Google key and never sent to the page.
const BOARD_KEYS = join(CONFIG, "boards.json");
async function boardKeys() { try { return JSON.parse(await readFile(BOARD_KEYS, "utf8")); } catch { return {}; } }
const keyState = (k) => ({ adzuna: k.adzuna ? { saved: true, country: k.adzuna.country || "us" } : { saved: false } });

async function refreshLeads() {
  if (leadsRunning) return leadsRunning;
  leadsRunning = (async () => {
    const read = async (n, d) => { try { return JSON.parse(await readFile(join(STORE, `${n}.json`), "utf8")); } catch { return d; } };
    const [apps, touches, settings, previous] = await Promise.all([read("applications", []), read("touches", []), read("settings", {}), read("leads", null)]);
    const fresh = await checkLeads(apps, touches, settings, previous, await boardKeys());
    // Keep jobs you hid, even if a later check happens before you look again.
    const latest = await read("leads", null);
    fresh.hidden = (latest && latest.hidden) || fresh.hidden;
    await writeJson(join(STORE, "leads.json"), fresh);
    return fresh;
  })().finally(() => { leadsRunning = null; });
  return leadsRunning;
}

async function api(req, res, path) {
  if (!apiAllowed(req)) return send(res, 403, { error: "Refused: this request did not come from the Designer Job Search page." });

  const m = path.match(/^\/api\/store\/([a-z]+)$/);
  if (m) {
    const name = m[1];
    if (!NAMES.has(name)) return send(res, 404, { error: "Unknown store" });
    const file = join(STORE, `${name}.json`);
    if (req.method === "GET") {
      try { return send(res, 200, await readFile(file, "utf8")); }
      catch { return send(res, 404, { error: "Not found" }); }
    }
    if (req.method === "PUT") {
      const data = await jsonBody(req);
      await backup(name);
      await writeJson(file, data);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "Method not allowed" });
  }

  if (DEMO) {
    if (path === "/api/google/status") return send(res, 200, { mode: "service", connected: true, serviceEmail: "designer-job-search@demo-project.iam.gserviceaccount.com", connectedAt: new Date().toISOString(), hasClient: false, clientId: "" });
    if (path === "/api/google/properties") {
      const st = JSON.parse(await readFile(join(STORE, "settings.json"), "utf8").catch(() => "{}"));
      return send(res, 200, (st.sites || []).filter((x) => x.propertyId).map((x) => ({ id: x.propertyId, name: x.propertyName || x.name, account: "Demo account" })));
    }
    if (path === "/api/pull" || path === "/api/leads/refresh" || path === "/api/google/check") return send(res, 409, { error: "This is the demo, so it does not read Google Analytics or job boards." });
    if (path === "/api/job") return send(res, 409, { error: "This is the demo, so it does not read job postings." });
    if (path === "/api/boards/keys" && req.method === "GET") return send(res, 200, keyState({}));
    if (path.startsWith("/api/boards/")) return send(res, 409, { error: "This is the demo, so it does not check job boards." });
  }
  if (path === "/api/pull" && req.method === "POST") {
    try {
      for (const n of ["matches", "pulls", "settings"]) await backup(n);
      return send(res, 200, { ok: true, pull: await puller.pull("button") });
    } catch (err) {
      return send(res, err.needsConnect ? 409 : 502, { error: err.message, needsConnect: !!err.needsConnect });
    }
  }
  if (path === "/api/leads/refresh" && req.method === "POST") {
    try { const r = await refreshLeads(); return send(res, 200, { ok: true, checkedAt: r.checkedAt, jobs: r.jobs.length, errors: r.errors.length }); }
    catch (err) { return send(res, 502, { error: err.message }); }
  }
  if (path === "/api/boards/test" && req.method === "POST") {
    try { return send(res, 200, await testBoard((await jsonBody(req)).url)); }
    catch (err) { return send(res, err.status || 400, { error: err.message }); }
  }
  if (path === "/api/boards/keys" && req.method === "GET") return send(res, 200, keyState(await boardKeys()));
  if (path === "/api/boards/keys" && req.method === "PUT") {
    try {
      const b = await jsonBody(req);
      if (b.board !== "adzuna") return send(res, 400, { error: "Only Adzuna takes a key." });
      const keys = await boardKeys();
      const appId = String(b.appId || "").trim(), appKey = String(b.appKey || "").trim();
      const country = /^[a-z]{2}$/.test(b.country || "") ? b.country : "us";
      if (!appId && !appKey) { delete keys.adzuna; await writeJson(BOARD_KEYS, keys); return send(res, 200, keyState(keys)); }
      if (!/^[A-Za-z0-9]{4,64}$/.test(appId) || !/^[A-Za-z0-9]{8,64}$/.test(appKey)) return send(res, 400, { error: "Paste the app ID and app key exactly as Adzuna shows them: letters and numbers only." });
      if (!(await adzunaWorks({ appId, appKey, country }))) return send(res, 400, { error: "Adzuna did not accept that app ID and key. Check both on developer.adzuna.com." });
      keys.adzuna = { appId, appKey, country };
      await writeJson(BOARD_KEYS, keys);
      return send(res, 200, keyState(keys));
    } catch (err) { return send(res, err.status || 400, { error: err.message }); }
  }
  if (path === "/api/job" && req.method === "POST") {
    try { return send(res, 200, await readJob((await jsonBody(req)).url)); }
    catch (err) { return send(res, 422, { error: err.message }); }
  }
  if (path === "/api/pull/status" && req.method === "GET") return send(res, 200, { running: puller.isRunning(), nextCheckMinutes: 60 });

  if (path === "/api/google/status" && req.method === "GET") return send(res, 200, await google.status());
  if (path === "/api/google/client" && req.method === "PUT") return send(res, 200, await google.setClient(await jsonBody(req)));
  if (path === "/api/google/service-account" && req.method === "PUT") return send(res, 200, await google.setServiceAccount(await jsonBody(req)));
  if (path === "/api/google/check" && req.method === "POST") {
    // Proves the connection works by listing the properties Google lets this account see.
    try {
      const list = await google.properties();
      if (list.length) puller.pull("schedule").catch((e) => console.error("First pull failed:", e.message));
      return send(res, 200, { ok: true, properties: list });
    } catch (err) { return send(res, err.needsConnect ? 409 : 502, { error: err.message, needsConnect: !!err.needsConnect }); }
  }
  if (path === "/api/google/disconnect" && req.method === "POST") { await google.disconnect(); return send(res, 200, await google.status()); }
  if (path === "/api/google/properties" && req.method === "GET") {
    try { return send(res, 200, await google.properties()); }
    catch (err) { return send(res, err.needsConnect ? 409 : 502, { error: err.message, needsConnect: !!err.needsConnect }); }
  }
  return send(res, 404, { error: "Not found" });
}

async function serveFile(res, path) {
  if (path === "/") path = "/index.html";
  let rel;
  try { rel = decodeURIComponent(path).replace(/^\/+/, ""); } catch { return send(res, 404, "Not found", "text/plain"); }
  if (!PUBLIC.test(rel) || normalize(rel) !== rel) return send(res, 404, "Not found", "text/plain");
  try {
    const file = join(ROOT, rel);
    return send(res, 200, await readFile(file), TYPES[extname(file)] || "application/octet-stream");
  } catch {
    return send(res, 404, "Not found", "text/plain");
  }
}

async function handle(req, res) {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host || "")) return send(res, 403, "Local only", "text/plain");
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    // Google sign-in. Desktop OAuth clients redirect back to the loopback address.
    if (path === "/oauth/start" && req.method === "GET") {
      try { return redirect(res, await google.authUrl()); }
      catch (err) { return redirect(res, `http://localhost:${PORT}/#settings?google=${encodeURIComponent(err.message)}`); }
    }
    if (path === "/oauth/callback" && req.method === "GET") {
      try {
        await google.finish(url.searchParams);
        // Pull right away, so the first look at the dashboard is current.
        puller.pull("schedule").catch((e) => console.error("First pull failed:", e.message));
        return redirect(res, `http://localhost:${PORT}/#settings?google=connected`);
      } catch (err) {
        return redirect(res, `http://localhost:${PORT}/#settings?google=${encodeURIComponent(err.message)}`);
      }
    }
    if (path.startsWith("/api/")) return await api(req, res, path);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
    return await serveFile(res, path);
  } catch (err) {
    return send(res, err.status || 400, { error: err.message });
  }
}

// Automatic pulls: check once a minute after start, then hourly; pull when the last one is older
// than the "Pull automatically every" setting and Google is connected.
async function autoPull() {
  if (DEMO) return;
  // Job boards change slowly: check application links once a day, whether or not Google is connected.
  try {
    let leads = null; try { leads = JSON.parse(await readFile(join(STORE, "leads.json"), "utf8")); } catch { /* first check */ }
    if (!leads || Date.now() - Date.parse(leads.checkedAt) > 24 * 3600 * 1000) { const r = await refreshLeads(); console.log(`Application links checked: ${r.jobs.length} design jobs at ${r.companies} companies.`); }
  } catch (err) { console.error("Application links check failed:", err.message); }
  try {
    const s = await google.status();
    if (!s.connected || puller.isRunning() || !(await puller.due())) return;
    const p = await puller.pull("schedule");
    console.log(`Automatic pull ${p.id}: ${p.realReaders} readers, ${p.newMatches.length} new.`);
  } catch (err) {
    console.error("Automatic pull failed:", err.message);
  }
}

await lockDown(STORE);
await lockDown(CONFIG);
createServer(handle).listen(PORT, "127.0.0.1", () => {
  console.log(`Designer Job Search${DEMO ? " (demo)" : ""}: http://localhost:${PORT}/`);
  setTimeout(autoPull, 60 * 1000);
  setInterval(autoPull, 60 * 60 * 1000);
});
createServer(handle).listen(PORT, "::1").on("error", () => {});
