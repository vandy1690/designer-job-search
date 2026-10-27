// Reads a job posting from its link, so adding an application is mostly paste and check.
// Uses the public job feeds of Greenhouse, Lever, Ashby and Workday, and falls back to the
// structured "JobPosting" data most career sites publish for search engines.
// Only public https addresses are fetched; private and local addresses are refused.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT = 12000;

function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}

async function assertPublic(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Use the full https:// link to the job posting.");
  if (u.username || u.password) throw new Error("That link has a login in it. Use the plain posting link.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || isIP(host)) throw new Error("That is not a public web address.");
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("That is not a public web address.");
  return u;
}

// Fetch with redirects checked one by one, a time limit and a size limit.
async function get(url, accept = "text/html,application/json") {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (Macintosh) SiteAnalytics/1.0" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location"), current).href; continue; }
    if (!res.ok) throw new Error(`The posting page answered ${res.status}. It may be closed.`);
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel(); break; }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), url: current };
  }
  throw new Error("The link redirects too many times.");
}
const getJson = async (url) => JSON.parse((await get(url, "application/json")).text);

const title = (slug) => String(slug || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const clean = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const placesFrom = (...xs) => [...new Set(xs.flat().map(clean).filter(Boolean).flatMap((s) => s.split(/\s*(?:;|\||\/| or )\s*/)).map((s) => s.trim()).filter(Boolean))].slice(0, 6);

async function greenhouse(u) {
  const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/) || (u.searchParams.get("gh_jid") && u.hostname.includes("greenhouse") && [null, u.pathname.split("/")[1], u.searchParams.get("gh_jid")]);
  if (!m) return null;
  const [, board, id] = m;
  const job = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}`);
  let company = title(board);
  try { company = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`)).name || company; } catch { /* keep the slug */ }
  return { company, role: clean(job.title), req: String(job.requisition_id || job.internal_job_id || id), places: placesFrom(job.location && job.location.name), ats: "greenhouse" };
}

async function lever(u) {
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const job = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(m[1])}/${m[2]}`);
  const c = job.categories || {};
  return { company: title(m[1]), role: clean(job.text), req: "", places: placesFrom(c.location, c.allLocations || [], job.workplaceType === "remote" ? "Remote" : ""), ats: "lever" };
}

async function ashby(u) {
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const board = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(m[1])}`);
  const job = (board.jobs || []).find((j) => j.id === m[2]);
  if (!job) return null;
  const extra = (job.secondaryLocations || []).map((x) => x.location || x);
  return { company: title(decodeURIComponent(m[1])), role: clean(job.title), req: "", places: placesFrom(job.location, extra, job.isRemote ? "Remote" : ""), ats: "ashby" };
}

async function workday(u) {
  // https://tenant.wd5.myworkdayjobs.com/en-US/site/job/Location/Title_R123 -> /wday/cxs/tenant/site/job/Location/Title_R123
  const parts = u.pathname.split("/").filter(Boolean);
  const jobAt = parts.indexOf("job");
  if (jobAt < 1) return null;
  const site = parts[jobAt - 1];
  const tenant = u.hostname.split(".")[0];
  const j = await getJson(`https://${u.hostname}/wday/cxs/${tenant}/${site}/${parts.slice(jobAt).join("/")}`);
  const info = j.jobPostingInfo || {};
  return { company: clean((j.hiringOrganization && j.hiringOrganization.name) || title(tenant)), role: clean(info.title), req: clean(info.jobReqId), places: placesFrom(info.location, info.additionalLocations || [], info.remoteType === "Remote" ? "Remote" : ""), ats: "workday" };
}

// The JobPosting data search engines read. Present on most career sites.
function fromStructuredData(html, url) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let data; try { data = JSON.parse(b.trim()); } catch { continue; }
    const items = [].concat(data, data && data["@graph"] ? data["@graph"] : []);
    const job = items.find((x) => x && (x["@type"] === "JobPosting" || [].concat(x["@type"] || []).includes("JobPosting")));
    if (!job) continue;
    const locs = [].concat(job.jobLocation || []).map((l) => { const a = (l && l.address) || {}; return [a.addressLocality, a.addressRegion].filter(Boolean).join(", "); });
    const org = job.hiringOrganization || {};
    const id = job.identifier ? (job.identifier.value || job.identifier.name || "") : "";
    return { company: clean(org.name), role: clean(job.title), req: clean(id), places: placesFrom(locs, job.jobLocationType === "TELECOMMUTE" ? "Remote" : "") };
  }
  const meta = (name) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)`, "i")); return m ? clean(m[1]) : ""; };
  const t = meta("og:title") || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const site = meta("og:site_name");
  if (!t || t.length < 4 || t === site) return null;
  return { company: site || title(new URL(url).hostname.replace(/^(www|careers|jobs)\./, "").split(".")[0]), role: t, req: "", places: [], guess: true };
}

// Returns what it could read, plus a note when something is missing. Never guesses a role.
export async function readJob(link) {
  const u = await assertPublic(String(link || "").trim());
  const h = u.hostname;
  const known = /(^|\.)greenhouse\.io$/.test(h) ? ["greenhouse", greenhouse] : h === "jobs.lever.co" ? ["lever", lever] : h === "jobs.ashbyhq.com" ? ["ashby", ashby] : /\.myworkdayjobs\.com$/.test(h) ? ["workday", workday] : null;
  if (known) {
    let out = null;
    try { out = await known[1](u); } catch { out = null; }
    if (out && out.role) return { ...out, note: "" };
    // A known applicant system that no longer lists the job: keep what the address says.
    const slug = h.endsWith("myworkdayjobs.com") ? h.split(".")[0] : u.pathname.split("/").filter(Boolean)[0];
    return { company: title(slug), role: "", req: "", places: [], ats: known[0], note: "That posting looks closed or moved, so only the company and applicant system were filled in." };
  }
  const page = await get(u.href);
  const out = fromStructuredData(page.text, page.url);
  if (!out || !out.role) throw new Error("Could not read that posting. Type the details in instead.");
  // Requisition numbers are short (R15357, 26-0491); long internal codes are left out.
  const req = /^[A-Za-z0-9._-]{1,20}$/.test(out.req || "") ? out.req : "";
  const ats = u.searchParams.has("gh_jid") ? "greenhouse" : u.searchParams.has("lever-origin") ? "lever" : "";
  return { company: out.company || "", role: out.role || "", req, places: out.places || [], ats, note: out.guess ? "This site does not publish job details, so the role is a guess from the page title. Check it." : "" };
}
