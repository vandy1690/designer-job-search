// Every web read the app makes on its own goes through here, so the same rules hold everywhere:
//   1. The app says who it is (USER_AGENT). It never poses as a browser.
//   2. It reads a page only if the site's robots.txt allows apps to read it (RFC 9309).
//   3. It never gets around a block. A captcha, robot check, login wall, 401, 403 or 429 is an
//      answer, not a puzzle: the read stops and the board is marked as one the app cannot check.
//   4. Links people paste are fetched over https only, never to private or local addresses, and
//      every redirect is checked again.
// The one read that skips robots.txt is an API used with your own key under that API's terms
// (Adzuna); its robots.txt keeps search engines out, not key holders.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const USER_AGENT = "DesignerJobSearch/1.0 (+https://github.com/vandy1690/designer-job-search)";
const AGENT_TOKEN = "designerjobsearch";
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT = 15000;
const DAY = 24 * 3600 * 1000;

/* ---------- Public addresses only ---------- */

function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}

export async function assertPublic(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Use the full https:// link.");
  if (u.username || u.password) throw new Error("That link has a login in it. Use the plain link.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || isIP(host)) throw new Error("That is not a public web address.");
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("That is not a public web address.");
  return u;
}

/* ---------- robots.txt ---------- */

const robotsCache = new Map(); // origin -> { at, groups }

// Groups of { agents: [...], rules: [{ allow, path }] }.
function parseRobots(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      if (val) cur.rules.push({ allow: key === "allow", path: val });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

// A robots.txt path pattern: * matches anything, a trailing $ anchors the end.
function matches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

export function robotsAllow(groups, url) {
  const u = new URL(url);
  const path = (u.pathname || "/") + (u.search || "");
  // The section written for this app by name, if any; otherwise the one for all apps (*).
  const mine = groups.filter((g) => g.agents.includes(AGENT_TOKEN));
  const group = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const g of group) for (const r of g.rules) {
    if (!matches(r.path, path)) continue;
    const len = r.path.replace(/[*$]/g, "").length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

async function robotsFor(origin) {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < DAY) return hit.groups;
  let groups = [];
  let url = `${origin}/robots.txt`;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    let res;
    try { res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), headers: { "User-Agent": USER_AGENT, Accept: "text/plain" } }); }
    catch { groups = [{ agents: ["*"], rules: [{ allow: false, path: "/" }] }]; break; } // could not ask: do not read
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).href; continue; }
    if (res.ok) groups = parseRobots((await res.text()).slice(0, 512 * 1024));
    else if (res.status >= 500 || res.status === 429) groups = [{ agents: ["*"], rules: [{ allow: false, path: "/" }] }]; // RFC 9309: unreachable means do not read
    // Any other 4xx (no robots.txt): the site sets no limits.
    break;
  }
  robotsCache.set(origin, { at: Date.now(), groups });
  return groups;
}

export async function assertRobots(url) {
  const groups = await robotsFor(new URL(url).origin);
  if (!robotsAllow(groups, url)) throw Object.assign(new Error("This site asks apps not to read this page (in its robots.txt), so the app does not."), { robots: true });
}

/* ---------- Reading ---------- */

const blocked = (status) => status === 401 || status === 403 || status === 429;
const blockError = (status) => Object.assign(new Error(status === 429 ? "It asked the app to slow down, so the app stopped." : "It does not let apps read it, so the app stopped."), { status, blocked: true });

// A page someone pasted or added: public https only, robots.txt checked, every redirect checked
// again, with size and time limits. Returns { text, url, type }.
export async function getPublic(url, accept = "text/html,application/json") {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    await assertRobots(current);
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: accept, "User-Agent": USER_AGENT } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location"), current).href; continue; }
    if (blocked(res.status)) throw blockError(res.status);
    if (!res.ok) throw Object.assign(new Error(`It answered ${res.status}.`), { status: res.status });
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel(); break; }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), url: current, type: res.headers.get("content-type") || "" };
  }
  throw new Error("The link redirects too many times.");
}

// A job board's own feed or API, at an address the app knows. robots.txt is checked unless the
// read is an API you hold a key for (opts.keyed). Errors name the status only, never the address,
// because a keyed address carries the key.
export async function getKnown(url, accept, opts = {}) {
  if (!opts.keyed) await assertRobots(url);
  const res = await fetch(url, { method: opts.method || "GET", body: opts.body, signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: accept, "User-Agent": USER_AGENT, ...(opts.headers || {}) } });
  if (blocked(res.status)) throw blockError(res.status);
  if (!res.ok) throw Object.assign(new Error(`It answered ${res.status}.`), { status: res.status });
  return res;
}
