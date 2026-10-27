// Turns GA4 rows into readers, and scores each reader against applications and contacts.
// Pure functions: no network, no DOM. The rules follow the visitor match playbook:
// a referrer that names an applicant system, a visit within hours of a touch, and a place
// that fits the company raise the odds; everything is an estimate, never a name GA4 gave.

/* ---------- Time ---------- */

// Milliseconds a zone is ahead of UTC at a given instant.
export function zoneOffsetMs(tz, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
}

// A wall-clock time in a zone, as a UTC instant.
export function zonedToUtc(tz, y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - zoneOffsetMs(tz, guess);
  const again = guess - zoneOffsetMs(tz, utc);
  if (again !== utc) utc = again;
  return utc;
}

// A UTC instant as { date: "YYYY-MM-DD", hour: 0-23 } in a zone.
export function partsIn(tz, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24 };
}

export const hourLabel = (h) => (h % 12 || 12) + (h < 12 ? " AM" : " PM");

// "2026-10-15T10:06" or "2026-10-15" in the display zone, as a UTC instant. Date-only means noon.
export function localStringToUtc(tz, s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return NaN;
  return zonedToUtc(tz, +m[1], +m[2], +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
}

/* ---------- Places ---------- */

const METROS = {
  chicago: ["chicago", "aurora", "naperville", "villa park", "crystal lake", "glenview", "schaumburg", "oak brook", "oakbrook terrace", "elmhurst", "lombard", "evanston", "itasca", "lake forest", "deerfield", "northbrook", "oak park", "downers grove", "wheaton", "joliet", "skokie", "rosemont"],
  "new york": ["new york", "brooklyn", "queens", "bronx", "newark", "jersey city", "hoboken", "oyster bay", "white plains", "stamford"],
  "bay area": ["san francisco", "san jose", "santa clara", "oakland", "palo alto", "mountain view", "sunnyvale", "pleasanton", "san ramon", "menlo park", "redwood city", "san mateo", "lafayette", "san bruno", "fremont", "cupertino", "berkeley"],
  boston: ["boston", "cambridge", "somerville", "saugus", "quincy", "waltham", "newton", "burlington", "lexington"],
  seattle: ["seattle", "bellevue", "redmond", "kirkland", "bothell"],
  "washington dc": ["washington", "arlington", "alexandria", "bethesda", "silver spring", "tysons", "mclean", "herndon", "hanover", "elkridge", "columbia"],
  denver: ["denver", "thornton", "aurora co", "boulder", "lakewood", "westminster"],
  detroit: ["detroit", "dearborn", "southfield", "troy", "rochester hills", "ann arbor"],
  "los angeles": ["los angeles", "santa monica", "culver city", "pasadena", "burbank", "irvine"],
  austin: ["austin", "round rock"],
  atlanta: ["atlanta", "dunwoody", "alpharetta", "marietta"],
  minneapolis: ["minneapolis", "st. paul", "saint paul", "bloomington mn", "eden prairie"],
  indianapolis: ["indianapolis", "carmel", "fishers"],
  portland: ["portland", "beaverton", "hillsboro", "lake oswego", "tigard", "vancouver wa"]
};
const REGION_METRO = { "district of columbia": "washington dc", virginia: "washington dc", maryland: "washington dc" };

const norm = (s) => String(s || "").toLowerCase().trim();
function metroOf(city, region) {
  const c = norm(city);
  for (const [metro, cities] of Object.entries(METROS)) if (cities.includes(c)) return metro;
  if (!c || c === "(not set)") return REGION_METRO[norm(region)] || "";
  return "";
}
// "Detroit, MI" -> { city: "detroit", metro: "detroit" }
function parsePlace(p) {
  const city = norm(String(p).split(",")[0]);
  return { city, metro: metroOf(city, "") };
}
// Returns "city" for an exact city, "metro" for the same metro, or "" when the place does not fit.
// Inside the owner's own metro only an exact city counts, since nearly every local visit "fits".
export function placeFits(reader, places, homeMetro = "") {
  if (!places || !places.length) return "";
  const rc = norm(reader.city);
  const rm = metroOf(reader.city, reader.region);
  let fit = "";
  for (const p of places) {
    if (norm(p) === "remote") continue;
    const pp = parsePlace(p);
    if (rc && rc !== "(not set)" && pp.city === rc) return "city";
    if (rm && pp.metro === rm && rm !== homeMetro) fit = "metro";
  }
  return fit;
}
// True when a place is known (not remote) and the reader is somewhere else.
function placeContradicts(reader, places) {
  const known = (places || []).filter((p) => norm(p) && norm(p) !== "remote");
  return known.length > 0 && !placeFits(reader, known);
}
// "Thornton, CO" -> "Denver metro"; a place outside the table stays as it is.
const METRO_NAMES = { "bay area": "Bay Area", "washington dc": "Washington DC metro" };
export function metroLabel(place) {
  const [city, region] = String(place || "").split(",").map((x) => x.trim());
  const m = metroOf(city, region);
  return !m ? place : METRO_NAMES[m] || `${m.replace(/\b\w/g, (c) => c.toUpperCase())} metro`;
}

export function homeMetroOf(settings) {
  const own = ((settings.exclude || {}).ownPlaces || [])[0] || "";
  const [city, region] = own.split(",").map((x) => x.trim());
  return metroOf(city, region);
}

/* ---------- Sources ---------- */

const ATS_HOSTS = [
  ["greenhouse", /greenhouse\.io$/], ["lever", /lever\.co$/], ["ashby", /ashbyhq\.com$/], ["workday", /myworkdayjobs\.com$|workday\.com$/],
  ["smartrecruiters", /smartrecruiters\.com$/], ["icims", /icims\.com$/], ["oracle", /oraclecloud\.com$|taleo\.net$/],
  ["jobvite", /jobvite\.com$/], ["workable", /workable\.com$/], ["bamboohr", /bamboohr\.com$/], ["rippling", /rippling\.com$|rippling-ats\.com$/]
];
const AI_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com)$/;
const SEARCH = /^(google|bing|duckduckgo|yahoo|ecosia|brave|baidu|yandex)$/;

export function atsOfHost(host) {
  const h = norm(host);
  for (const [name, re] of ATS_HOSTS) if (re.test(h)) return name;
  return "";
}
export function atsOfUrl(url) {
  try { return atsOfHost(new URL(url).hostname); } catch { return ""; }
}

// "app8.greenhouse.io / referral" -> { host: "app8.greenhouse.io", medium: "referral", channel: "ats", ats: "greenhouse" }
export function classifySource(sourceMedium) {
  const [src = "", medium = ""] = String(sourceMedium).split(" / ").map((s) => s.trim());
  const host = src.replace(/^www\./, "");
  if (!host || host === "(direct)") return { host: "direct", medium, channel: "direct", ats: "" };
  const ats = atsOfHost(host);
  if (ats) return { host, medium, channel: "ats", ats };
  if (/(^|\.)linkedin\.com$|^lnkd\.in$/.test(host)) return { host: "linkedin.com", medium, channel: "linkedin", ats: "" };
  if (AI_HOSTS.test(host)) return { host, medium, channel: "ai", ats: "" };
  if (SEARCH.test(host) || medium === "organic") return { host, medium, channel: "search", ats: "" };
  return { host, medium, channel: "referral", ats: "" };
}

/* ---------- Pages ---------- */

export function pageKey(path) {
  const p = String(path || "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1].toLowerCase();
}

/* ---------- Filters ---------- */

function listHas(list, value) { return (list || []).some((x) => norm(x) === norm(value)); }

// Why a visit is dropped, or "" to keep it.
export function dropReason(v, exclude, siteHosts) {
  const ex = exclude || {};
  if (siteHosts && siteHosts.length && !listHas(siteHosts, v.host)) return "other-host";
  if (listHas(ex.ownHosts, v.host)) return "own";
  if ((ex.ownPlaces || []).some((p) => { const [c, r] = p.split(",").map(norm); return norm(v.city) === c && (!r || norm(v.region) === r); })) return "own";
  if (listHas(ex.ownScreens, v.screen)) return "own";
  if (v.sources.some((s) => (ex.ownReferrers || []).some((r) => norm(s.host).includes(norm(r))))) return "own";
  if (listHas(ex.machineCities, v.city)) return "machine";
  if (listHas(ex.machineScreens, v.screen)) return "machine";
  if ((ex.machinePairs || []).some((p) => { const [c, s] = p.split("|").map(norm); return norm(v.city) === c && norm(v.screen) === s; })) return "machine";
  if (v.sources.some((s) => (ex.spamReferrers || []).some((r) => norm(s.host).endsWith(norm(r))))) return "spam";
  return "";
}

/* ---------- GA4 rows to visits ---------- */

const val = (row, i) => row.dimensionValues[i].value;
const met = (row, i) => Number(row.metricValues[i].value || 0);

// reports: { sessions, pages, events } as GA4 runReport rows. Returns one visit per hour, city and screen.
export function buildVisits(reports, propertyTz, displayTz, siteId) {
  const visits = new Map();
  const keyOf = (dateHour, city, screen) => `${dateHour}|${city}|${screen}`;
  const get = (dateHour, city, screen) => {
    const k = keyOf(dateHour, city, screen);
    if (!visits.has(k)) {
      const utc = zonedToUtc(propertyTz, +dateHour.slice(0, 4), +dateHour.slice(4, 6), +dateHour.slice(6, 8), +dateHour.slice(8, 10));
      const local = partsIn(displayTz, utc);
      visits.set(k, { key: k, siteId, utc, date: local.date, hour: local.hour, city, region: "", country: "", screen, device: "", host: "", sources: [], newVisitor: false, sessions: 0, pages: {}, pageViews: 0, resume: false, clicks: [] });
    }
    return visits.get(k);
  };
  // sessions: dateHour, city, region, country, sessionSourceMedium, hostName, deviceCategory, screenResolution, newVsReturning
  for (const r of reports.sessions || []) {
    const v = get(val(r, 0), val(r, 1), val(r, 7));
    v.region = val(r, 2); v.country = val(r, 3); v.host = val(r, 5); v.device = val(r, 6);
    const src = classifySource(val(r, 4));
    if (!v.sources.some((s) => s.host === src.host)) v.sources.push(src);
    if (val(r, 8) === "new") v.newVisitor = true;
    v.sessions += met(r, 0);
  }
  // pages: dateHour, city, screenResolution, hostName, pagePath
  for (const r of reports.pages || []) {
    const v = get(val(r, 0), val(r, 1), val(r, 2));
    if (!v.host) v.host = val(r, 3);
    const k = pageKey(val(r, 4));
    v.pages[k] = (v.pages[k] || 0) + met(r, 0);
    v.pageViews += met(r, 0);
  }
  // events: dateHour, city, screenResolution, eventName, linkUrl
  for (const r of reports.events || []) {
    const v = get(val(r, 0), val(r, 1), val(r, 2));
    const name = val(r, 3), url = val(r, 4);
    if (name === "file_download" && /\.pdf($|\?)|resume/i.test(url)) v.resume = true;
    if (name === "click" && url && url !== "(not set)") v.clicks.push(url);
  }
  return [...visits.values()].sort((a, b) => a.utc - b.utc);
}

/* ---------- Visits to readers ---------- */

// Same city and screen across visits reads as one device coming back.
export function groupReaders(visits) {
  const readers = new Map();
  for (const v of visits) {
    const key = `${norm(v.city)}|${v.screen}`;
    if (!readers.has(key)) readers.set(key, { key, city: v.city, region: v.region, country: v.country, screen: v.screen, device: v.device, visits: [], sources: [], pages: {}, resume: false, clicks: [], newVisitor: false });
    const r = readers.get(key);
    r.visits.push(v);
    for (const s of v.sources) if (!r.sources.some((x) => x.host === s.host)) r.sources.push(s);
    for (const [p, n] of Object.entries(v.pages)) r.pages[p] = (r.pages[p] || 0) + n;
    r.resume = r.resume || v.resume;
    r.clicks.push(...v.clicks);
    r.newVisitor = r.newVisitor || v.newVisitor;
    if (!r.region) r.region = v.region;
    if (!r.device) r.device = v.device;
  }
  return [...readers.values()];
}

// A real reader did more than land on the home page once.
export function isRealReader(r) {
  const deepPages = Object.keys(r.pages).filter((p) => p !== "home").length;
  const days = new Set(r.visits.map((v) => v.date)).size;
  const strongSource = r.sources.some((s) => ["ats", "linkedin", "ai"].includes(s.channel));
  // GA4 could not place this visitor, and nothing else vouches for it: usually a machine.
  if ((!r.city || r.city === "(not set)") && !strongSource) return false;
  return deepPages > 0 || r.resume || r.clicks.length > 0 || days > 1 || strongSource;
}

/* ---------- Scoring ---------- */

const H = 3600 * 1000;
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

// Contacts where the other side is active at that moment (they wrote, called or met).
const INBOUND = new Set(["message-in", "email-in", "call", "interview", "profile-view"]);
// A human contact has a named person, or is a live conversation. Rejections and
// acknowledgments without a person are automated mail.
const isHuman = (t) => t.kind !== "rejection" && (!!t.person || ["call", "interview", "referral"].includes(t.kind));

export function scoreReader(reader, applications, touches, settings) {
  const tz = settings.displayTimeZone || "UTC";
  const sc = settings.scoring || {};
  const windowMs = (sc.windowDays || 60) * 24 * H;
  const strong = (sc.strongHours || 2) * H;
  const timing = (sc.timingHours || 24) * H;
  const first = reader.visits[0].utc;
  const last = reader.visits[reader.visits.length - 1].utc;
  const atsSources = reader.sources.filter((s) => s.channel === "ats");
  const homeMetro = homeMetroOf(settings);
  const atHome = !!homeMetro && metroOf(reader.city, reader.region) === homeMetro;
  const at = (s) => localStringToUtc(tz, s);
  const label = (a) => `${a.company} ${a.role}${a.req ? ` (${a.req})` : ""}`;

  // Candidates: live applications, plus contacts that belong to no application (a recruiter,
  // a referral, a firm with no req), grouped by company.
  const live = applications.filter((a) => {
    const t = at(a.submitted + (a.submittedTime ? `T${a.submittedTime}` : ""));
    return Number.isFinite(t) && t <= last && first - t <= windowMs;
  });
  const cands = live.map((a) => ({
    key: a.id, company: a.company, label: label(a), jobUrl: a.jobUrl || "", ats: a.ats || atsOfUrl(a.jobUrl), places: a.places || [],
    submittedAt: at(a.submitted + (a.submittedTime ? `T${a.submittedTime}` : "")),
    touches: touches.filter((t) => t.applicationId === a.id || (!t.applicationId && t.company && norm(t.company) === norm(a.company)))
  }));
  const orphan = new Map();
  for (const t of touches) {
    if (t.applicationId || !t.company || cands.some((c) => norm(c.company) === norm(t.company))) continue;
    const tu = at(t.at);
    if (!Number.isFinite(tu) || Math.abs(first - tu) > windowMs) continue;
    const k = norm(t.company);
    if (!orphan.has(k)) orphan.set(k, { key: `contact:${k}`, company: t.company, label: `${t.company} (no application on file)`, jobUrl: "", ats: "", places: [], submittedAt: NaN, touches: [] });
    orphan.get(k).touches.push(t);
  }
  cands.push(...orphan.values());

  for (const c of cands) {
    c.places = [...c.places, ...c.touches.flatMap((t) => t.places || [])];
    c.placeFit = placeFits(reader, c.places, homeMetro);
    c.contradicts = placeContradicts(reader, c.places);
    c.atsMatch = !!c.ats && atsSources.some((s) => s.ats === c.ats);
    c.sinceSubmit = first - c.submittedAt;
    c.human = null; c.inbound = null; c.auto = null;
    for (const t of c.touches) {
      const tu = at(t.at);
      if (!Number.isFinite(tu)) continue;
      const dateOnly = !/T\d{2}:\d{2}/.test(t.at);
      for (const v of reader.visits) {
        const gap = Math.max(Math.abs(v.utc - tu), dateOnly ? 12 * H : 0);
        const slot = isHuman(t) ? (INBOUND.has(t.kind) ? "inbound" : "human") : "auto";
        const keep = (name) => { if (!c[name] || gap < c[name].gap) c[name] = { gap, touch: t }; };
        keep(slot);
        if (slot === "inbound") keep("human");
      }
    }
  }
  const atsShare = (ats) => cands.filter((c) => c.ats === ats).length;
  const near = (x, w) => x && x.gap <= w;

  // Each rule names itself, so the row can say why.
  for (const c of cands) {
    const r = [];
    if (c.atsMatch && atsShare(c.ats) === 1) r.push([3, "ats-only"]);
    if (near(c.human, strong) && c.placeFit && !atHome) r.push([3, "human-place"]);
    if (near(c.auto, strong) && c.placeFit && !atHome) r.push([3, "auto-place"]);
    if (c.atsMatch) r.push([2, "ats-shared"]);
    if (near(c.human, strong) && c.placeFit === "city" && atHome && c.human.touch.person) r.push([2, "human-home"]);
    if (near(c.human, timing) && c.placeFit && !atHome) r.push([2, "human-day-place"]);
    if (c.sinceSubmit >= 0 && c.sinceSubmit <= timing && c.placeFit && !atHome) r.push([2, "submit-place"]);
    if (near(c.inbound, strong) && !c.contradicts) r.push([2, "inbound-time"]);
    r.sort((a, b) => b[0] - a[0]);
    c.level = r.length ? r[0][0] : 0;
    c.rule = r.length ? r[0][1] : "";
  }
  cands.sort((a, b) => b.level - a.level || ((a.human || a.auto || { gap: Infinity }).gap - (b.human || b.auto || { gap: Infinity }).gap));

  const top = cands.filter((c) => c.level >= 2);
  const deepPages = Object.keys(reader.pages).filter((p) => p !== "home");
  const reasons = [];
  let confidence = "low", who = `Unknown ${reader.city && reader.city !== "(not set)" ? reader.city : reader.region || "unplaced"} reader`;
  let application = "Nothing on file", lag = "n/a", jd = [], viaTouch = false;
  const hrs = (g) => { const h = Math.round(g / H); return h <= 1 ? "Within an hour of" : `${h} hours from`; };
  const kindText = (k) => String(k || "contact").replace("-", " ");

  if (top.length) {
    const best = top[0];
    const tied = top.filter((c) => c.level === best.level);
    const companies = [...new Set(tied.map((c) => c.company))];
    confidence = best.level >= 3 && companies.length === 1 ? "high" : "medium";
    const human = ["human-place", "human-home", "human-day-place", "inbound-time"].includes(best.rule) ? (best.rule === "inbound-time" ? best.inbound : best.human) : null;
    viaTouch = !!(human && human.touch.person);
    who = companies.length > 1 ? `A reviewer at ${companies.slice(0, 3).join(" or ")}` : viaTouch ? `${human.touch.person}, ${best.company}` : `A ${best.company} reviewer`;
    application = tied.slice(0, 3).map((c) => c.label).join(", or ");
    jd = tied.slice(0, 3).filter((c) => c.jobUrl).map((c) => ({ m: c.label, u: c.jobUrl }));
    const by = {
      "ats-only": () => { lag = `Arrived from ${atsSources[0].host}`; reasons.push(`Arrived from ${atsSources[0].host}, the only ${titleCase(best.ats)} application in the window.`); },
      "ats-shared": () => { lag = `Arrived from ${atsSources[0].host}`; reasons.push(`Arrived from ${atsSources[0].host}; more than one application uses ${titleCase(best.ats)}.`); },
      "human-place": () => { lag = `${hrs(best.human.gap)} the ${kindText(best.human.touch.kind)}`; reasons.push(`${lag}${best.human.touch.person ? ` with ${best.human.touch.person}` : ""}, from a place that fits.`); },
      "human-home": () => { lag = `${hrs(best.human.gap)} the ${kindText(best.human.touch.kind)}`; reasons.push(`${lag} with ${best.human.touch.person}. ${reader.city} is your own metro, so the odds stay medium.`); },
      "human-day-place": () => { lag = `${hrs(best.human.gap)} the ${kindText(best.human.touch.kind)}`; reasons.push(`${lag}${best.human.touch.person ? ` with ${best.human.touch.person}` : ""}, from a place that fits.`); },
      "inbound-time": () => { lag = `${hrs(best.inbound.gap)} the ${kindText(best.inbound.touch.kind)}`; reasons.push(`${lag}${best.inbound.touch.person ? ` from ${best.inbound.touch.person}` : ""}. The place is unknown, so this rests on timing.`); },
      "auto-place": () => { lag = `${hrs(best.auto.gap)} the ${kindText(best.auto.touch.kind)}`; reasons.push(`${lag} email, from where ${best.company} is. A person may have looked before deciding.`); },
      "submit-place": () => { const d = Math.floor(best.sinceSubmit / (24 * H)); lag = d < 1 ? "Within a day of the submit" : `${d} days after the submit`; reasons.push(`${lag}, from where ${best.company} is.`); }
    };
    (by[best.rule] || (() => {}))();
    if (companies.length > 1) reasons.push("More than one company fits, so the odds stay medium.");
  }
  if (reader.resume) reasons.push("Downloaded the resume PDF.");
  if (deepPages.length >= 3) reasons.push(`Read ${deepPages.length} pages.`);
  if (new Set(reader.visits.map((v) => v.date)).size > 1) reasons.push("Came back on another day.");
  if (reader.clicks.length) reasons.push(`Clicked out to ${[...new Set(reader.clicks.map((u) => u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]))].join(", ")}.`);

  return { confidence, who, application, lag, jd, viaTouch, note: reasons.join(" ") || "A real reader with no match on file." };
}

/* ---------- Readers to match rows ---------- */

export function visitsByDay(reader) {
  const days = new Map();
  for (const v of reader.visits) {
    if (!days.has(v.date)) days.set(v.date, new Set());
    days.get(v.date).add(v.hour);
  }
  return [...days.entries()].map(([d, hours]) => [d, [...hours].sort((a, b) => a - b).map(hourLabel).join(", ")]);
}

export function channelOf(reader, scored) {
  const chans = reader.sources.map((s) => s.channel);
  if (chans.includes("ats")) return "ats";
  if (scored.viaTouch && scored.confidence !== "low") return "recruiter";
  for (const c of ["ai", "linkedin", "search", "referral"]) if (chans.includes(c)) return c;
  return "direct";
}

export function readerToMatch(reader, scored, pullId) {
  const city = reader.city && reader.city !== "(not set)" ? reader.city : "";
  const region = reader.region && reader.region !== "(not set)" ? reader.region : "";
  const place = [city, region].filter(Boolean).join(", ") || (reader.country && reader.country !== "(not set)" ? reader.country : "Unplaced");
  const pages = Object.keys(reader.pages);
  const day = visitsByDay(reader)[0][0];
  return {
    id: `${day}-${(city || reader.region || "unplaced").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${reader.screen || "screen"}`,
    status: "estimated",
    date: day,
    visits: visitsByDay(reader),
    place,
    city: reader.city,
    screen: reader.screen,
    readerKey: reader.key,
    device: `${titleCase(reader.device || "device")} ${reader.screen}`.trim(),
    referrer: reader.sources.map((s) => s.host).join(", ") || "direct",
    channel: channelOf(reader, scored),
    pages: pages.length ? pages : ["home"],
    resume: reader.resume,
    clicks: [...new Set(reader.clicks)],
    confidence: scored.confidence,
    who: scored.who,
    application: scored.application,
    jd: scored.jd,
    lag: scored.lag,
    note: scored.note,
    pull: pullId
  };
}

// Fold a pull's readers into the stored matches. Reviewed rows keep their wording and gain visits;
// estimated rows are re-scored. Returns { matches, added, updated }.
export function mergeMatches(existing, incoming) {
  const out = existing.map((m) => ({ ...m }));
  const added = [], updated = [];
  for (const n of incoming) {
    const hit = out.find((m) => m.readerKey && m.readerKey === n.readerKey);
    if (!hit) { out.push(n); added.push(n.id); continue; }
    const seen = new Set(hit.visits.map((v) => v[0]));
    const fresh = n.visits.filter((v) => !seen.has(v[0]));
    const sameDays = n.visits.filter((v) => seen.has(v[0]));
    for (const [d, t] of sameDays) {
      const row = hit.visits.find((v) => v[0] === d);
      const hours = new Set([...row[1].split(", "), ...t.split(", ")].filter(Boolean));
      row[1] = [...hours].sort((a, b) => toH(a) - toH(b)).join(", ");
    }
    if (!fresh.length && !sameDays.length) continue;
    hit.visits = [...hit.visits, ...fresh].sort((a, b) => a[0].localeCompare(b[0]));
    hit.pages = [...new Set([...(hit.pages || []), ...n.pages])];
    hit.resume = hit.resume || n.resume;
    hit.clicks = [...new Set([...(hit.clicks || []), ...(n.clicks || [])])];
    if (hit.status !== "reviewed") Object.assign(hit, { confidence: n.confidence, who: n.who, application: n.application, jd: n.jd, lag: n.lag, note: n.note, channel: n.channel, referrer: n.referrer });
    hit.pull = n.pull;
    if (fresh.length) updated.push(hit.id);
  }
  return { matches: out, added, updated };
}
const toH = (label) => { const m = String(label).match(/(\d+)\s*(AM|PM)/); if (!m) return 99; return (+m[1] % 12) + (m[2] === "PM" ? 12 : 0); };

/* ---------- Counts ---------- */

export function countsOf(matches) {
  return {
    high: matches.filter((m) => m.confidence === "high").length,
    medium: matches.filter((m) => m.confidence === "medium").length,
    low: matches.filter((m) => m.confidence === "low").length,
    resume: matches.filter((m) => m.resume).length,
    ats: new Set(matches.filter((m) => m.channel === "ats").map((m) => m.referrer)).size
  };
}

/* ---------- Companies ---------- */

// One key per company, so "Example Inc." and "Example" match. Keeps the first name before " / " or " via ".
export function companyKey(name) {
  return String(name || "").toLowerCase()
    .split(/\s+(?:\/|via)\s+/)[0]
    .replace(/\(.*?\)/g, "")
    .replace(/\b(inc|llc|ltd|corp|corporation|companies|company|co|group|holdings|technologies|technology|the)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
