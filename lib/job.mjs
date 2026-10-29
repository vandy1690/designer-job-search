// Reads a job posting from its link, so adding an application is mostly paste and check.
// Uses the public job feeds of Greenhouse, Lever, Ashby and Workday, and falls back to the
// structured "JobPosting" data most career sites publish for search engines.
// Reads go through lib/net.mjs: public https only, robots.txt honored, and a site that blocks
// apps is never worked around.
import { getPublic, assertPublic } from "./net.mjs";
import { blockedBoard } from "../js/boards.js";

// Every read goes through lib/net.mjs: public https only, robots.txt honored, blocks respected.
const get = getPublic;
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
  try { return await readJobInner(link); }
  catch (err) {
    if (err.robots || err.blocked) throw new Error(`${err.message} Type the details in instead.`);
    throw err;
  }
}
async function readJobInner(link) {
  const u = await assertPublic(String(link || "").trim());
  const no = blockedBoard(u.href);
  if (no) throw Object.assign(new Error(no.why), { blocked: true });
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
