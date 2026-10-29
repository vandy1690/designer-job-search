// Application links: jobs that match you, at companies whose job boards the app can read, plus who to
// reach out to there. Builds a watch list from the job links in your applications and any boards
// added in Settings, and reads each company's own public job feed:
// Greenhouse, Lever, Ashby and Workday. Only design-titled jobs are kept here;
// the page applies your title, location and pay rules, so changing them needs no new check.
import { companyKey } from "../js/engine.js";
import { getKnown } from "./net.mjs";
import { BOARDS, boardOn } from "../js/boards.js";
import { readBoard, readCustom, hasReader } from "./feeds.mjs";

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
  // SmartRecruiters is left out: its job API's robots.txt asks every app but LinkedIn's not to read it.
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(h)) {
    const j = p.indexOf("job");
    const site = j > 0 ? p[j - 1] : p.filter((x) => !/^[a-z]{2}-[A-Z]{2}$/.test(x))[0];
    if (ok(site)) return { type: "workday", host: h, tenant: h.split(".")[0], site };
  }
  return null;
}
const boardId = (b) => `${b.type}:${b.host || ""}${b.token || ""}${b.site ? "/" + b.site : ""}`;

async function getJson(url, init = {}) {
  return (await getKnown(url, "application/json", { method: init.method, body: init.body, headers: init.headers })).json();
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
const READERS = { greenhouse, lever, ashby, workday };

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

// Checks every job board that is turned on. Company boards come first, so when the same job
// shows on a company board and a job site, the company's own posting is kept.
export async function checkLeads(applications, touches, settings, previous, keys = {}) {
  const L = settings.leads || {};
  const custom = (L.customBoards || []).filter((b) => b.on !== false && b.status !== "error");
  const companyLines = [...(L.extraBoards || []), ...custom.filter((b) => b.kind === "company").map((b) => `${b.name} | ${b.url}`)];
  const { watch, withoutBoard } = watchList(applications, touches, companyLines);
  const jobs = [], errors = [], sources = [];

  if (boardOn(L, "company")) {
    let i = 0, found = 0;
    const worker = async () => {
      while (i < watch.length) {
        const w = watch[i++];
        try {
          for (const job of await READERS[w.board.type](w.board)) { jobs.push({ ...job, company: w.company, companyKey: w.key, boardType: w.board.type }); found++; }
        } catch (err) { errors.push({ company: w.company, board: w.board.type, error: err.message }); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    sources.push({ id: "company", ok: true, jobs: found, companies: watch.length, failed: errors.length });
  }

  const add = (list, boardType, source) => {
    let n = 0;
    for (const j of list) {
      if (!designish(j.title)) continue;
      jobs.push({ ...j, companyKey: companyKey(j.company), boardType, source });
      n++;
    }
    return n;
  };
  const sites = BOARDS.filter((b) => b.id !== "company" && hasReader(b.id) && boardOn(L, b.id));
  await Promise.all(sites.map(async (b) => {
    try { sources.push({ id: b.id, ok: true, jobs: add(await readBoard(b.id, L, keys), b.id, b.name) }); }
    catch (err) { sources.push({ id: b.id, ok: false, needs: !!err.needs, message: err.message }); }
  }));
  await Promise.all(custom.filter((b) => b.kind === "feed" || b.kind === "page").map(async (b) => {
    try { sources.push({ id: b.id, ok: true, jobs: add(await readCustom(b), "custom", b.name) }); }
    catch (err) { sources.push({ id: b.id, ok: false, message: err.message }); }
  }));

  // The same role at the same company, from two places: keep the first.
  const seen = new Set();
  const unique = jobs.filter((j) => {
    const k = `${j.companyKey}|${String(j.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (j.companyKey && seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Remember when each job was first seen, so new ones can be marked.
  const firstSeen = Object.fromEntries(((previous && previous.jobs) || []).map((j) => [j.id, j.firstSeen]));
  const at = new Date().toISOString();
  for (const j of unique) j.firstSeen = firstSeen[j.id] || at;
  return { checkedAt: at, companies: watch.length, withoutBoard, jobs: unique, errors, sources, hidden: (previous && previous.hidden) || [] };
}
