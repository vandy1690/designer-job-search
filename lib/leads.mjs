// Warm leads: jobs that match you, at companies whose job boards the app can read, plus who to
// reach out to there. Builds a watch list from the job links in your applications and any boards
// added in Settings, and reads each company's own public job feed:
// Greenhouse, Lever, Ashby, Workday and SmartRecruiters. Only design-titled jobs are kept here;
// the page applies your title, location and pay rules, so changing them needs no new check.
import { companyKey } from "../js/engine.js";

const TIMEOUT = 15000;
const DAY = 24 * 3600 * 1000;

// Where a job link says the company posts its jobs, or null.
export function boardOf(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const h = u.hostname, p = u.pathname.split("/").filter(Boolean);
  const ok = (s) => /^[A-Za-z0-9._-]{1,80}$/.test(s || "");
  if (/(^|\.)greenhouse\.io$/.test(h) && ok(p[0]) && p[0] !== "embed") return { type: "greenhouse", token: p[0] };
  if (h === "jobs.lever.co" && ok(p[0])) return { type: "lever", token: p[0] };
  if (h === "jobs.ashbyhq.com" && p[0]) return { type: "ashby", token: decodeURIComponent(p[0]) };
  if (h === "jobs.smartrecruiters.com" && ok(p[0])) return { type: "smartrecruiters", token: p[0] };
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(h)) {
    const j = p.indexOf("job");
    const site = j > 0 ? p[j - 1] : p.filter((x) => !/^[a-z]{2}-[A-Z]{2}$/.test(x))[0];
    if (ok(site)) return { type: "workday", host: h, tenant: h.split(".")[0], site };
  }
  return null;
}
const boardId = (b) => `${b.type}:${b.host || ""}${b.token || ""}${b.site ? "/" + b.site : ""}`;

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Macintosh) DesignerJobSearch/1.0", ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`job board answered ${res.status}`);
  return res.json();
}

// "$170K – $210K" or "$180,000—$220,000" -> { min, max }. Yearly amounts only; never guessed.
export function payFrom(text) {
  const nums = [...String(text || "").matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?/g)]
    .map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1)).filter((n) => n >= 20000 && n <= 2000000);
  if (!nums.length) return null;
  return { min: Math.min(nums[0], nums[1] || nums[0]), max: Math.max(nums[0], nums[1] || nums[0]) };
}
const designish = (t) => /design|ux|user experience/i.test(t || "");
const strip = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function greenhouse(b) {
  const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.token)}/jobs`);
  const jobs = (j.jobs || []).filter((x) => designish(x.title));
  const out = [];
  for (const x of jobs.slice(0, 40)) {
    let pay = null;
    try {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.token)}/jobs/${x.id}?pay_transparency=true`);
      const r = (d.pay_input_ranges || [])[0];
      pay = r && r.min_cents ? { min: r.min_cents / 100, max: r.max_cents / 100 } : payFrom(strip(d.content || "").slice(0, 20000));
    } catch { /* pay stays unknown */ }
    out.push({ id: `gh:${b.token}:${x.id}`, title: x.title, url: x.absolute_url, location: (x.location && x.location.name) || "", posted: (x.first_published || x.updated_at || "").slice(0, 10), pay });
  }
  return out;
}
async function lever(b) {
  const list = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(b.token)}?mode=json`);
  return (Array.isArray(list) ? list : []).filter((x) => designish(x.text)).map((x) => ({
    id: `lv:${b.token}:${x.id}`, title: x.text, url: x.hostedUrl,
    location: [x.categories && x.categories.location, x.workplaceType === "remote" ? "Remote" : ""].filter(Boolean).join("; "),
    posted: x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 10) : "",
    pay: x.salaryRange && x.salaryRange.min && /year/i.test(x.salaryRange.interval || "year") ? { min: x.salaryRange.min, max: x.salaryRange.max || x.salaryRange.min } : null
  }));
}
async function ashby(b) {
  const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.token)}?includeCompensation=true`);
  return (j.jobs || []).filter((x) => designish(x.title)).map((x) => ({
    id: `ab:${b.token}:${x.id}`, title: x.title, url: x.jobUrl || `https://jobs.ashbyhq.com/${encodeURIComponent(b.token)}/${x.id}`,
    location: [x.location, ...(x.secondaryLocations || []).map((s) => s.location || s), x.isRemote ? "Remote" : ""].filter(Boolean).join("; "),
    posted: (x.publishedAt || "").slice(0, 10),
    pay: x.compensation ? payFrom(x.compensation.compensationTierSummary || x.compensation.scrapeableCompensationSalarySummary || "") : null
  }));
}
async function workday(b) {
  const j = await getJson(`https://${b.host}/wday/cxs/${b.tenant}/${b.site}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "designer" })
  });
  const today = Date.now();
  const postedOn = (s) => { const t = String(s || ""); if (/today/i.test(t)) return 0; if (/yesterday/i.test(t)) return 1; const m = t.match(/(\d+)\+?\s*Days?/i); return m ? Number(m[1]) : null; };
  return (j.jobPostings || []).filter((x) => designish(x.title)).map((x) => {
    const days = postedOn(x.postedOn);
    return { id: `wd:${b.host}:${x.externalPath}`, title: x.title, url: `https://${b.host}/${b.site}${x.externalPath}`, location: x.locationsText || "", posted: days == null ? "" : new Date(today - days * DAY).toISOString().slice(0, 10), postedNote: /30\+/.test(x.postedOn || "") ? "30+ days ago" : "", req: (x.bulletFields || [])[0] || "", pay: null };
  });
}
async function smartrecruiters(b) {
  const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.token)}/postings?q=designer&limit=100`);
  return (j.content || []).filter((x) => designish(x.name)).map((x) => ({
    id: `sr:${b.token}:${x.id}`, title: x.name, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(b.token)}/${x.id}`,
    location: [x.location && x.location.city, x.location && x.location.region, x.location && x.location.remote ? "Remote" : ""].filter(Boolean).join(", "),
    posted: (x.releasedDate || "").slice(0, 10), pay: null
  }));
}
const READERS = { greenhouse, lever, ashby, workday, smartrecruiters };

// Companies with a named contact and a readable job board.
export function watchList(applications, touches, extraBoards = []) {
  const people = new Set(touches.filter((t) => t.person && t.kind !== "rejection").map((t) => companyKey(t.company)).filter(Boolean));
  const boards = new Map();
  const add = (company, url) => {
    const b = boardOf(url);
    const key = companyKey(company);
    if (!b || !key) return;
    const id = boardId(b);
    if (!boards.has(id)) boards.set(id, { company, key, board: b, id });
  };
  for (const a of applications) add(a.company, a.jobUrl);
  for (const line of extraBoards) { const [company, url] = String(line).split("|").map((x) => x.trim()); if (company && url) add(company, url); }
  const all = [...boards.values()];
  // Every company with a readable board is checked; contacts decide who to reach out to, not which jobs show.
  return { watch: all, withoutBoard: [...people].filter((k) => !all.some((w) => w.key === k)) };
}

export async function checkLeads(applications, touches, settings, previous) {
  const { watch, withoutBoard } = watchList(applications, touches, (settings.leads || {}).extraBoards || []);
  const jobs = [], errors = [];
  let i = 0;
  const worker = async () => {
    while (i < watch.length) {
      const w = watch[i++];
      try {
        for (const job of await READERS[w.board.type](w.board)) jobs.push({ ...job, company: w.company, companyKey: w.key, boardType: w.board.type });
      } catch (err) { errors.push({ company: w.company, board: w.board.type, error: err.message }); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // Remember when each job was first seen, so new ones can be marked.
  const firstSeen = Object.fromEntries(((previous && previous.jobs) || []).map((j) => [j.id, j.firstSeen]));
  const at = new Date().toISOString();
  for (const j of jobs) j.firstSeen = firstSeen[j.id] || at;
  return { checkedAt: at, companies: watch.length, withoutBoard, jobs, errors, hidden: (previous && previous.hidden) || [] };
}
