// Job boards beyond company career pages: the public feeds and lists named in js/boards.js,
// Adzuna with your own key, and feeds or pages you add yourself. Every reader returns jobs in
// one shape: { id, title, company, location, url, posted, pay }.
// Every read goes through lib/net.mjs: the app names itself, honors robots.txt, never works
// around a block, and fetches links you add over public https only.
import { getPublic, getKnown } from "./net.mjs";
import { blockedBoard } from "../js/boards.js";
import { boardOf } from "./leads.mjs";
import { dayIn } from "../js/engine.js";

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8";
const getJson = async (url, opts) => (await getKnown(url, "application/json", opts)).json();
const getText = async (url) => (await getKnown(url, FEED_ACCEPT)).text();

/* ---------- Reading RSS and Atom, without a library ---------- */

const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const clean = (s) => decode(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")); return m ? clean(m[1]) : ""; };
const isFeed = (body, type) => /(rss|atom|xml)/i.test(type || "") || /^\s*(<\?xml[^>]*>\s*)?<(rss|feed|rdf:RDF)\b/i.test(body);

export function parseFeed(xml) {
  return [...String(xml).matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => {
    const b = m[2];
    let link = tag(b, "link");
    if (!link) { const h = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = h ? decode(h[1]) : ""; }
    return {
      title: tag(b, "title"), link: link || tag(b, "guid"),
      date: tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"),
      creator: tag(b, "dc:creator") || tag(b, "author"),
      region: tag(b, "region") || tag(b, "location") || tag(b, "job_listing:location")
    };
  }).filter((x) => x.title && /^https?:\/\//i.test(x.link));
}

// The posting date on this computer's calendar, not the UTC date.
const day = (d) => (d == null || d === "" ? "" : dayIn(d));
// "Remote, Canada, Mexico, Brazil and 37 more" instead of every country a job allows.
const shortList = (where) => { const p = String(where || "").split(/\s*,\s*/).filter(Boolean); return p.length > 3 ? `${p.slice(0, 3).join(", ")} and ${p.length - 3} more` : p.join(", "); };
const remote = (where) => (where && !/^(anywhere|worldwide|remote)\b/i.test(where) ? `Remote, ${shortList(where)}` : "Remote");
const yearly = (min, max) => (Number(min) > 0 ? { min: Number(min), max: Number(max) > 0 ? Number(max) : Number(min) } : null);
// "Acme: Product Designer" or "Product Designer at Acme".
function splitTitle(t) {
  const colon = t.indexOf(": ");
  if (colon > 0 && colon < 60) return { company: t.slice(0, colon), title: t.slice(colon + 2) };
  const at = t.lastIndexOf(" at ");
  if (at > 0) return { company: t.slice(at + 4), title: t.slice(0, at) };
  return { company: "", title: t };
}

/* ---------- The boards in js/boards.js ---------- */

const READERS = {
  async dribbble() {
    return parseFeed(await getText("https://dribbble.com/jobs.rss")).map((x) => {
      const m = x.title.match(/^(.*?) is hiring for a position of (.*?)(?: in (.*))?$/i);
      return { id: `dr:${x.link.replace(/\?.*$/, "")}`, title: m ? m[2] : x.title, company: x.creator || (m ? m[1] : ""), location: m && m[3] ? m[3] : "", url: x.link, posted: day(x.date), pay: null };
    });
  },
  async weworkremotely() {
    return parseFeed(await getText("https://weworkremotely.com/categories/remote-design-jobs.rss")).map((x) => {
      const s = splitTitle(x.title);
      return { id: `wwr:${x.link}`, title: s.title, company: s.company, location: remote(x.region), url: x.link, posted: day(x.date), pay: null };
    });
  },
  async remoteok() {
    const list = await getJson("https://remoteok.com/api?tag=design");
    return (Array.isArray(list) ? list : []).filter((x) => x && x.position && x.url).map((x) => (
      { id: `rok:${x.id}`, title: clean(x.position), company: clean(x.company), location: remote(clean(x.location)), url: x.url, posted: day(x.date), pay: yearly(x.salary_min, x.salary_max) }));
  },
  async himalayas(L) {
    const out = [];
    for (const t of [...new Set((L.titles && L.titles.length ? L.titles : ["product designer"]).slice(0, 3))]) {
      const j = await getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(t)}&limit=20`);
      for (const x of j.jobs || []) {
        const url = x.guid || x.applicationLink;
        if (!url) continue;
        out.push({ id: `him:${url}`, title: clean(x.title), company: clean(x.companyName), location: remote((x.locationRestrictions || []).join(", ")), url, posted: x.pubDate ? day(x.pubDate * 1000) : "", pay: /annual|year/i.test(x.salaryPeriod || "annual") ? yearly(x.minSalary, x.maxSalary) : null });
      }
    }
    return out;
  },
  async jobicy() {
    const j = await getJson("https://jobicy.com/api/v2/remote-jobs?count=50&industry=design-multimedia");
    return (j.jobs || []).filter((x) => x.url).map((x) => (
      { id: `jcy:${x.id}`, title: clean(x.jobTitle), company: clean(x.companyName), location: remote(clean(x.jobGeo)), url: x.url, posted: day(x.pubDate), pay: yearly(x.annualSalaryMin, x.annualSalaryMax) }));
  },
  async workingnomads() {
    const list = await getJson("https://www.workingnomads.com/api/exposed_jobs/");
    return (Array.isArray(list) ? list : []).filter((x) => x.url && /design/i.test(x.category_name || "")).map((x) => (
      { id: `wn:${x.url}`, title: clean(x.title), company: clean(x.company_name), location: remote(clean(x.location)), url: x.url, posted: day(x.pub_date), pay: null }));
  },
  async adzuna(L, keys) {
    const k = keys && keys.adzuna;
    if (!k || !k.appId || !k.appKey) throw Object.assign(new Error("Needs a free key. Add it in Settings, Job boards."), { needs: true });
    const out = [];
    for (const t of [...new Set((L.titles && L.titles.length ? L.titles : ["product designer"]).slice(0, 2))]) {
      const j = await getJson(adzunaUrl(k, t, 50), { keyed: true });
      for (const x of j.results || []) {
        if (!x.redirect_url) continue;
        out.push({ id: `adz:${x.id}`, title: clean(x.title), company: clean(x.company && x.company.display_name), location: clean(x.location && x.location.display_name), url: x.redirect_url, posted: day(x.created), pay: yearly(x.salary_min, x.salary_max) });
      }
    }
    return out;
  }
};
const adzunaUrl = (k, what, n) => `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(k.country || "us")}/search/1?app_id=${encodeURIComponent(k.appId)}&app_key=${encodeURIComponent(k.appKey)}&results_per_page=${n}&what=${encodeURIComponent(what)}&content-type=application/json`;

export const readBoard = (id, leads, keys) => READERS[id](leads || {}, keys || {});
export const hasReader = (id) => id in READERS;

// True when Adzuna accepts the key. Used before the key is saved.
export async function adzunaWorks(k) {
  try { await getJson(adzunaUrl(k, "designer", 1), { keyed: true }); return true; }
  catch (err) { if (err.status === 401 || err.status === 403) return false; throw new Error("Could not reach Adzuna to check the key. Try again in a minute."); }
}

/* ---------- Boards you add ---------- */

// Job listings described in a page's structured data, the way search engines read them.
function pageJobs(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const items = [].concat(data, (data && data["@graph"]) || [], ((data && data.itemListElement) || []).map((e) => e.item || e));
    for (const j of items) {
      if (!j || ![].concat(j["@type"] || []).includes("JobPosting")) continue;
      const where = [].concat(j.jobLocation || []).map((l) => { const a = (l && l.address) || {}; return [a.addressLocality, a.addressRegion].filter(Boolean).join(", "); }).filter(Boolean).join("; ");
      let url = j.url || base;
      try { url = new URL(url, base).href; } catch { url = base; }
      out.push({ title: clean(j.title), company: clean((j.hiringOrganization || {}).name), location: j.jobLocationType === "TELECOMMUTE" ? remote(where) : where, url, posted: day(j.datePosted) });
    }
  }
  return out.filter((x) => x.title);
}

// What the app can do with a job board link someone adds:
// { status: ok | warn | error, kind: company | feed | page | none, message, feedUrl }.
export async function testBoard(link) {
  const url = String(link || "").trim();
  if (!/^https:\/\//i.test(url)) return { status: "warn", kind: "none", message: "Use the full link, starting with https://" };
  const blocked = blockedBoard(url);
  if (blocked) return { status: "error", kind: "none", message: `You cannot check this website. ${blocked.why}` };
  if (boardOf(url)) return { status: "ok", kind: "company", message: "A company job board. The app reads it on its own." };
  let page;
  try { page = await getPublic(url, FEED_ACCEPT); }
  catch (err) {
    if (err.robots || err.blocked) return { status: "error", kind: "none", message: `You cannot check this website. ${err.message}` };
    if (err.status === 404 || err.status === 410) return { status: "warn", kind: "none", message: "Check the link: that page was not found." };
    if (err.status === 401 || err.status === 403 || err.status === 429) return { status: "error", kind: "none", message: "You cannot check this website. It does not let apps read it." };
    return { status: "error", kind: "none", message: `You cannot check this website. ${String(err.message).replace(/^The posting page/, "It").replace(/ It may be closed\.$/, "")}` };
  }
  const newest = (items) => (items[0] ? ` The newest: "${items[0].title.slice(0, 80)}".` : "");
  if (isFeed(page.text, page.type)) {
    const items = parseFeed(page.text);
    return items.length
      ? { status: "ok", kind: "feed", feedUrl: page.url, message: `Reads this feed: ${items.length} listings in it now.${newest(items)}` }
      : { status: "warn", kind: "feed", feedUrl: page.url, message: "This feed is empty right now. The app keeps checking it." };
  }
  if (/cf-challenge|turnstile|captcha|are you a robot|verify you are human/i.test(page.text.slice(0, 30000))) return { status: "error", kind: "none", message: "You cannot check this website. It blocks apps with a robot check." };
  const jobs = pageJobs(page.text, page.url);
  if (jobs.length) return { status: "ok", kind: "page", message: `Reads the ${jobs.length} job listings on this page.` };
  const alt = page.text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
  const href = alt && alt[0].match(/href=["']([^"']+)["']/i);
  if (href) {
    try {
      const feedUrl = new URL(decode(href[1]), page.url).href;
      const f = await getPublic(feedUrl, FEED_ACCEPT);
      const items = isFeed(f.text, f.type) ? parseFeed(f.text) : [];
      if (items.length) return { status: "ok", kind: "feed", feedUrl: f.url, message: `Reads this site's feed: ${items.length} listings in it now.${newest(items)} Check that it lists jobs, not articles.` };
    } catch { /* no usable feed: fall through */ }
  }
  return { status: "warn", kind: "none", message: "Needs a feed link. This page has no job feed the app can read. Look on the site for an RSS link or a job alerts feed, and add that link instead." };
}

// Reads a board you added, the way testBoard found it.
export async function readCustom(b) {
  if (b.kind === "feed") {
    const f = await getPublic(b.feedUrl || b.url, FEED_ACCEPT);
    return parseFeed(f.text).map((x) => { const s = splitTitle(x.title); return { id: `my:${b.id}:${x.link}`, title: s.title, company: s.company || x.creator || "", location: x.region || "", url: x.link, posted: day(x.date), pay: null }; });
  }
  if (b.kind === "page") {
    const p = await getPublic(b.url, "text/html");
    return pageJobs(p.text, p.url).map((x) => ({ id: `my:${b.id}:${x.url}:${x.title}`, ...x, pay: null }));
  }
  return [];
}
