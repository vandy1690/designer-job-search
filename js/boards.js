// The job boards the app knows, shared by the server (which reads them) and the page (which
// shows them). can says what the app is able to do with each one:
//   ok    the app reads it on its own
//   warn  the app can read it, once you give it something (a free key, a link)
//   error the app cannot read it: the site does not let other apps read its listings
// Checked by hand on 2026-10-27. When a site changes, change its line here.
// A site the app cannot check can still get a search link on Application links (link: shown by
// default; search: the link, built from your job titles and places), so you can check it yourself.

const titlesOf = (L) => (L && L.titles && L.titles.length ? L.titles : ["product designer"]);
const remoteOk = (L) => ((L && L.locations) || []).some((x) => /remote/i.test(x));
const placeOf = (L) => ((L && L.locations) || []).find((x) => !/remote/i.test(x)) || "";
// (principal OR staff) AND ("product designer" OR "design systems"): LinkedIn and Indeed read this.
const boolean = (L) => { const s = (L && L.seniority) || []; const t = titlesOf(L).map((x) => `"${x}"`).join(" OR "); return s.length ? `(${s.join(" OR ")}) AND (${t})` : `(${t})`; };
const enc = encodeURIComponent;
const slugOf = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const BOARDS = [
  { id: "company", name: "Company job boards", site: "", can: "ok", on: true,
    note: "The career pages of the companies you applied to, or add below. Greenhouse, Lever, Ashby and Workday work." },
  { id: "dribbble", name: "Dribbble Jobs", site: "https://dribbble.com/jobs", can: "ok", on: true,
    note: "Design jobs, worldwide. Read from its public job feed." },
  { id: "weworkremotely", name: "We Work Remotely", site: "https://weworkremotely.com/categories/remote-design-jobs", can: "ok", on: true,
    note: "Remote design jobs. Read from its public job feed." },
  { id: "remoteok", name: "Remote OK", site: "https://remoteok.com/remote-design-jobs", can: "ok", on: true,
    note: "Remote design jobs. Read from its public job list." },
  { id: "himalayas", name: "Himalayas", site: "https://himalayas.app/jobs", can: "ok", on: true,
    note: "Remote jobs, searched by your job titles." },
  { id: "jobicy", name: "Jobicy", site: "https://jobicy.com/jobs", can: "ok", on: true,
    note: "Remote design jobs. Read from its public job list." },
  { id: "workingnomads", name: "Working Nomads", site: "https://www.workingnomads.com/jobs", can: "ok", on: false,
    note: "Remote jobs. It shares only its newest 40, of any kind, so it finds few design roles." },
  { id: "adzuna", name: "Adzuna", site: "https://www.adzuna.com", can: "warn", on: false, needsKey: true,
    note: "Searches listings gathered from thousands of sites.",
    needs: "Needs a free key. Sign up at developer.adzuna.com, then paste the app ID and app key below." },
  { id: "linkedin", name: "LinkedIn Jobs", site: "https://www.linkedin.com/jobs", can: "error", on: false, link: true,
    why: "LinkedIn does not let other apps read its job listings.", hosts: ["linkedin.com", "lnkd.in"],
    search: (L) => `https://www.linkedin.com/jobs/search/?keywords=${enc(boolean(L))}${remoteOk(L) ? "&f_WT=2" : placeOf(L) ? `&location=${enc(placeOf(L))}` : ""}&sortBy=DD` },
  { id: "indeed", name: "Indeed", site: "https://www.indeed.com", can: "error", on: false, link: true,
    why: "Indeed blocks apps with a security check and closed its job feed.", hosts: ["indeed.com"],
    search: (L) => `https://www.indeed.com/jobs?q=${enc(boolean(L))}&l=${enc(remoteOk(L) ? "Remote" : placeOf(L))}&sort=date` },
  { id: "glassdoor", name: "Glassdoor", site: "https://www.glassdoor.com", can: "error", on: false, link: true,
    why: "Glassdoor blocks apps with a robot check.", hosts: ["glassdoor.com"],
    // Glassdoor keeps the search in the address itself; remote here means remote in the United States.
    search: (L) => { const t = slugOf(titlesOf(L)[0]); return remoteOk(L) ? `https://www.glassdoor.com/Job/united-states-${t}-jobs-SRCH_IL.0,13_KO14,${14 + t.length}.htm?remoteWorkType=1` : `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${enc(titlesOf(L)[0])}`; } },
  { id: "wellfound", name: "Wellfound", site: "https://wellfound.com/jobs", can: "error", on: false, link: false,
    why: "Wellfound blocks apps with a robot check.", hosts: ["wellfound.com", "angel.co"],
    search: (L) => `https://wellfound.com/role/r/${slugOf(titlesOf(L)[0])}` },
  { id: "builtin", name: "Built In", site: "https://builtin.com/jobs", can: "error", on: false, link: false,
    why: "Built In has no job feed for other apps to read.", hosts: ["builtin.com"],
    search: (L) => `https://builtin.com/jobs${remoteOk(L) ? "/remote" : ""}/design-ux?search=${enc(titlesOf(L)[0])}` }
];

export const boardById = (id) => BOARDS.find((b) => b.id === id);

// Whether a board is turned on: your choice if you made one, otherwise the board's default.
// Boards the app cannot read are never on.
export function boardOn(leads, id) {
  const b = boardById(id);
  if (!b || b.can === "error") return false;
  const set = (leads && leads.boards) || {};
  return id in set ? !!set[id] : b.on;
}

// Whether a site the app cannot check gets a search link on Application links.
export function linkOn(leads, id) {
  const b = boardById(id);
  if (!b || !b.search) return false;
  const set = (leads && leads.boards) || {};
  return id in set ? !!set[id] : !!b.link;
}

// A site the app knows it cannot read, from any address on it.
export function blockedBoard(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  return BOARDS.find((b) => b.can === "error" && (b.hosts || []).some((h) => host === h || host.endsWith(`.${h}`))) || null;
}
