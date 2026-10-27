// Designer Job Search: the page. Reads the app's data from the local server, renders every view,
// and edits applications, contacts, matches and settings. Pulls run on the server.
import { loadAll, save, api } from "./store.js";
import { countsOf, atsOfUrl, companyKey, metroLabel } from "./engine.js";

const $ = (id) => document.getElementById(id);
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, extra) => `<svg class="dash-icon${extra ? " " + extra : ""}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${id}"/></svg>`;
const tile = (id, tone) => `<span class="dash-tile${tone ? " dash-tile--" + tone : ""}">${icon(id)}</span>`;
const panel = (title, inner, iconId, tone) => `<sdc-card><div class="dash-panel"><div class="dash-panel__head"><div class="dash-panel__title">${iconId ? tile(iconId, tone) : ""}<h3>${esc(title)}</h3></div></div>${inner}</div></sdc-card>`;
// Only real web addresses become links. Anything else (a javascript: address in an imported file) stays text.
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch (e) { return ""; } };
const dot = (iso) => { const p = String(iso).split("-"); return p.length < 3 ? "" : `${+p[1]}.${p[2].slice(0, 2)}`; };

// Page names come from the address ("checkout-redesign" reads "Checkout Redesign"). Settings,
// Advanced, Page names fixes any that read wrong, like "paypal" | "PayPal".
const PAGE = { "home": "Home", "resume": "Resume" };
const pageName = (p) => ((S && S.settings.pageNames) || {})[p] || PAGE[p] || String(p).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const CH = { recruiter: "Recruiter or referral touch first", ats: "From inside an applicant system", linkedin: "LinkedIn", search: "Google search", ai: "AI assistant", referral: "Another website", direct: "Direct (email, PDF or stripped)" };
const CH_ICON = { recruiter: "users", ats: "briefcase", linkedin: "link", search: "search", ai: "sparkle", referral: "link", direct: "mail" };
const ODDS = {
  high: { icon: "high", tone: "high", label: "High odds" },
  medium: { icon: "medium", tone: "medium", label: "Medium odds" },
  low: { icon: "eye", tone: "mute", label: "Low odds" },
  person: { icon: "users", tone: "mute", label: "A contact, not an application" }
};
const oddsIcon = (c) => { const o = ODDS[c] || ODDS.low; return `<span class="dash-tile dash-tile--sm dash-tile--${o.tone}" role="img" aria-label="${o.label}" title="${o.label}">${icon(o.icon)}</span>`; };
const ATS = ["", "greenhouse", "lever", "ashby", "workday", "smartrecruiters", "icims", "oracle", "linkedin", "dice", "braintrust", "upwork", "other"];
const STATUS = ["submitted", "interviewing", "offer", "rejected", "closed"];
const KINDS = ["call", "interview", "message-in", "message-out", "email-in", "email-out", "connection", "referral", "profile-view", "rejection"];
const cap = (s) => ({ smartrecruiters: "SmartRecruiters", icims: "iCIMS", bamboohr: "BambooHR" }[s] || (s ? s[0].toUpperCase() + s.slice(1) : ""));
const kindLabel = (k) => ({ "message-in": "Message in", "message-out": "Message out", "email-in": "Email in", "email-out": "Email out", "profile-view": "Profile view" }[k] || (k ? k[0].toUpperCase() + k.slice(1) : ""));
const PAGE_SIZE = 10;

let S = null; // stored data
let G = { hasClient: false, connected: false }; // Google connection
let props = null; // GA4 properties, once connected
const paging = {};
let filterOdds = "all";
let filterOnly = ""; // "resume", "ats" or "ai": a narrower slice opened from an Overview card
let focusRead = "";  // a read to show and highlight, opened from Latest reads
const ONLY = {
  resume: { label: "downloaded your resume PDF", test: (m) => m.resume },
  ats: { label: "arrived from inside an applicant system", test: (m) => m.channel === "ats" },
  ai: { label: "arrived from an AI assistant", test: (m) => m.channel === "ai" || /chatgpt|perplexity|claude\.ai|gemini|copilot/i.test(m.referrer || "") }
};
// Reads the Application pull filters from the address, so Overview links land filtered.
function applyPullParams() {
  const q = hashParams();
  filterOdds = ["high", "medium", "low"].includes(q.get("odds")) ? q.get("odds") : "all";
  filterOnly = ONLY[q.get("only")] ? q.get("only") : "";
  focusRead = q.get("read") || "";
  paging.pull = 0;
}

/* ---------- Views and navigation ---------- */

// Reads that came in or changed in pulls after a moment (ms). Pulls run every few hours, so
// "latest" means the last 7 days, not only the very last pull (which is often empty).
const DAY_MS = 24 * 3600 * 1000;
function readsSince(ms) {
  const ids = new Set();
  for (const p of S.pulls) if (Date.parse(p.at) > ms) [...(p.newMatches || []), ...(p.updatedMatches || [])].forEach((id) => ids.add(id));
  return ids;
}
const latestSeen = () => { try { return Number(localStorage.getItem("dash-latest-seen")) || Date.now() - 7 * DAY_MS; } catch (e) { return Date.now() - 7 * DAY_MS; } };

function views() {
  const last = S.pulls[S.pulls.length - 1];
  const latestCount = readsSince(latestSeen()).size;
  return [
    { id: "overview", group: "main", label: "Overview", icon: "overview", sub: "Your sites at a glance" },
    { id: "pull", group: "main", label: "Application pull", icon: "pull", sub: "An estimate of which applications drew a reader, and who it likely was" },
    { id: "leads", group: "jobs", label: "Warm leads", icon: "warm", sub: "Jobs that match you, and who to reach out to about each one", badge: newLeadCount() },
    { id: "latest", group: "main", label: "Latest pull", icon: "latest", sub: last ? `What came in over the last 7 days · last pulled ${dot(pulledDate(last))}` : "No pull yet", badge: latestCount },
    { id: "conclusions", group: "main", label: "Conclusions", icon: "bulb", sub: "What the data says" },
    { id: "reading", group: "main", label: "Reading and reach", icon: "book", sub: "Pages, arrival paths and places" },
    { id: "health", group: "main", label: "Data health", icon: "pulse", sub: "Analytics sources on every site", badge: healthIssues().length, warn: true },
    { id: "applications", group: "track", label: "Applications", icon: "briefcase", sub: "What you applied to. The odds are scored against this list.", badge: 0 },
    { id: "contacts", group: "track", label: "Contacts", icon: "chat", sub: "Calls, messages and notes that can prompt a visit" },
    { id: "settings", group: "setup", label: "Settings", icon: "gear", sub: "Connect Google Analytics and choose your websites" }
  ];
}

function navItem(v) {
  return `<li><a class="dash-nav__item" href="#${v.id}" data-label="${esc(v.label)}">${icon(v.icon)}<span class="dash-nav__label">${esc(v.label)}</span>` +
    (v.badge ? `<span class="dash-badge${v.warn ? " dash-badge--warn" : ""}" aria-label="${v.badge}${v.warn ? " issues" : " new or updated"}">${v.badge}</span>` : "") + "</a></li>";
}

function renderNav() {
  const V = views();
  $("nav-main").innerHTML = V.filter((v) => v.group === "main").map(navItem).join("");
  $("nav-track").innerHTML = V.filter((v) => v.group === "track").map(navItem).join("");
  $("nav-jobs").innerHTML = V.filter((v) => v.group === "jobs").map(navItem).join("");
  $("nav-setup").innerHTML = V.filter((v) => v.group === "setup").map(navItem).join("");
  $("nav-sites").innerHTML = S.settings.sites.map((s) => {
    const tone = !s.propertyId ? "bad" : G.connected ? "ok" : "warn";
    return `<li><a class="dash-nav__item" href="#health" data-label="${esc(s.name)}">${icon("globe")}<span class="dash-nav__label">${esc(s.name)}</span><span class="dash-dot dash-dot--${tone}" aria-hidden="true"></span></a></li>`;
  }).join("");
  setCollapsed($("shell").getAttribute("data-collapsed") === "true", false);
  markCurrent();
}

function currentView() { return (location.hash.slice(1).split("?")[0]) || "overview"; }
function hashParams() { return new URLSearchParams(location.hash.split("?")[1] || ""); }

function markCurrent() {
  const id = currentView();
  // Sites link to Data health but are shortcuts, not sections, so they never show as current.
  document.querySelectorAll("#nav-main .dash-nav__item, #nav-jobs .dash-nav__item, #nav-track .dash-nav__item, #nav-setup .dash-nav__item").forEach((a) => {
    if (a.getAttribute("href") === `#${id}`) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function show(focus) {
  const V = views();
  const v = V.find((x) => x.id === currentView()) || V[0];
  document.querySelectorAll(".dash-view").forEach((s) => { s.hidden = s.getAttribute("data-view") !== v.id; });
  $("view-title").textContent = v.label;
  $("view-sub").textContent = v.sub;
  document.title = `${v.label} · Designer Job Search`;
  markCurrent();
  window.scrollTo(0, 0);
  if (focus) $("view-title").focus();
}

/* ---------- Sidebar collapse and theme ---------- */

const narrow = window.matchMedia("(max-width: 720px)");
function setCollapsed(c, remember) {
  const shell = $("shell"), btn = $("collapse");
  shell.setAttribute("data-collapsed", c ? "true" : "false");
  btn.setAttribute("aria-expanded", c ? "false" : "true");
  btn.setAttribute("aria-label", c ? "Expand sidebar" : "Collapse sidebar");
  btn.querySelector("use").setAttribute("href", c ? "#i-show" : "#i-hide");
  document.querySelectorAll(".dash-nav__item").forEach((a) => { if (c) a.setAttribute("title", a.getAttribute("data-label")); else a.removeAttribute("title"); });
  if (remember) { try { localStorage.setItem("dash-collapsed", c ? "1" : "0"); } catch (e) { /* private mode */ } }
}
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("theme-toggle").setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
  try { localStorage.setItem("dash-theme", t); } catch (e) { /* private mode */ }
}

// Loads the Adobe Fonts kit from Settings (or removes it), and remembers it so boot.js can load
// it before the page draws next time.
function useFontKit(kit) {
  const ok = kit && /^[a-z0-9]{5,12}$/.test(kit);
  try { if (ok) localStorage.setItem("dash-font-kit", kit); else localStorage.removeItem("dash-font-kit"); } catch (e) { /* private mode */ }
  const cur = $("font-kit");
  if (cur && (!ok || cur.getAttribute("href") !== `https://use.typekit.net/${kit}.css`)) cur.remove();
  if (ok && !$("font-kit")) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `https://use.typekit.net/${kit}.css`; l.id = "font-kit";
    document.head.appendChild(l);
  }
}

/* ---------- Helpers over the data ---------- */

const visitsOf = (m) => (m.visits && m.visits.length ? m.visits : [[m.date, ""]]);
const zoneFmt = () => new Intl.DateTimeFormat("en-US", { timeZone: S.settings.displayTimeZone || LOCAL_TZ, timeZoneName: "short" });
const zoneOf = (iso) => zoneFmt().formatToParts(new Date(`${iso}T17:00:00Z`)).find((p) => p.type === "timeZoneName").value;
const zoneFor = (list) => { const z = new Set(); list.forEach((m) => visitsOf(m).forEach((v) => z.add(zoneOf(v[0])))); return z.size === 1 ? [...z][0] : z.size ? "local" : zoneOf(new Date().toISOString().slice(0, 10)); };
const pulledDate = (p) => new Intl.DateTimeFormat("en-CA", { timeZone: S.settings.displayTimeZone || LOCAL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(p.at));
const sortedMatches = () => S.matches.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const aiTotal = (pulls) => pulls.reduce((n, p) => n + (p.aiVisits ? p.aiVisits.length : p.ai || 0), 0);
const lastPull = () => S.pulls[S.pulls.length - 1];
function flagFor(m) {
  const last = lastPull();
  if (!last) return "";
  if ((last.newMatches || []).includes(m.id)) return "New";
  if ((last.updatedMatches || []).includes(m.id)) return "Updated";
  return "";
}

/* ---------- Pager ---------- */

function paged(key, list, render, tableId, pagerId, size = PAGE_SIZE) {
    const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  paging[key] = Math.min(paging[key] || 0, pages - 1);
  const p = paging[key];
  const start = p * size;
  $(tableId).innerHTML = render(list.slice(start, start + size), list);
  const pager = $(pagerId);
  if (total <= size) { pager.innerHTML = total ? `<span class="dash-pagerbar__count">${total} ${total === 1 ? "row" : "rows"}</span>` : ""; return; }
  const chev = (prev) => `<span class="sdc-pager__cap" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${prev ? "M10 3.5 5.5 8l4.5 4.5" : "m6 3.5 4.5 4.5L6 12.5"}"/></svg></span>`;
  pager.innerHTML = `<span class="dash-pagerbar__count" aria-live="polite">${start + 1} to ${Math.min(start + size, total)} of ${total}</span>
    <span class="dash-pagerbar__btns">
      <button type="button" class="sdc-pager sdc-pager--prev" data-dir="-1" ${p === 0 ? "disabled" : ""}>${chev(true)}Previous<span class="sdc-u-sr-only"> ${size}</span></button>
      <button type="button" class="sdc-pager" data-dir="1" ${p >= pages - 1 ? "disabled" : ""}>Next<span class="sdc-u-sr-only"> ${size}</span>${chev(false)}</button>
    </span>`;
  pager.onclick = (e) => {
    const b = e.target.closest("[data-dir]");
    if (!b || b.disabled) return;
    const dir = +b.getAttribute("data-dir");
    paging[key] = p + dir;
    paged(key, list, render, tableId, pagerId, size);
    const again = pager.querySelector(`[data-dir="${dir}"]`);
    (again && !again.disabled ? again : pager.querySelector("[data-dir]:not([disabled])") || pager).focus();
    $(tableId).scrollIntoView({ block: "nearest" });
  };
}

/* ---------- Match table ---------- */

function matchTable(rows, all) {
  const heads = ["Odds", `When (${zoneFor(all)})`, "Likely who", "Application", "Arrived from", "Place", "Read", ""];
  return `<table><thead><tr>${heads.map((h) => `<th scope="col" class="dash-label">${h ? esc(h) : '<span class="sdc-u-sr-only">Edit</span>'}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((x) => {
      const when = visitsOf(x).map((v, i) => `<span class="dash-when"><span class="dash-when__day">${i ? "Returns " : ""}<strong>${dot(v[0])}</strong></span>${v[1] ? " " + esc(v[1]).replace(/ (AM|PM)/g, " $1") : ""}</span>`).join("");
      let app = esc(x.application);
      for (const j of x.jd || []) {
        const e = esc(j.m), u = safeUrl(j.u);
        if (!u) continue;
        app = app.replace(e, () => `<a class="dash-jd" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${e}${icon("external")}<span class="sdc-u-sr-only"> (job description, opens in a new tab)</span></a>`);
      }
      const pages = (x.pages || []).filter((p) => p !== "home").map(pageName);
      if (!pages.length) pages.push("Home only");
      if (x.resume) pages.push("Resume PDF downloaded");
      const flag = flagFor(x);
      const tags = (flag ? ` <span class="dash-chip dash-chip--new">${flag}</span>` : "") + (x.status === "estimated" ? ' <span class="dash-chip dash-chip--low">Estimate</span>' : "");
      return `<tr data-row="${esc(x.id)}"${x.id === focusRead ? ' class="is-target" tabindex="-1"' : ""}><td>${oddsIcon(x.confidence)}</td><td class="dash-whencell">${when}<span class="dash-sub">${esc(x.lag)}</span></td>` +
        `<td class="dash-who">${esc(x.who)}${tags}<span class="dash-sub">${esc(x.note)}</span></td>` +
        `<td class="dash-appcell">${app}</td><td>${esc(x.referrer)}<span class="dash-sub">${esc(x.device)}</span></td>` +
        `<td>${esc(x.place)}</td><td><ul class="dash-read">${pages.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></td>` +
        `<td><button type="button" class="dash-rowbtn" data-edit-match="${esc(x.id)}" aria-label="Edit ${esc(x.who)}">${icon("edit", "dash-icon--sm")}Edit</button></td></tr>`;
    }).join("") + "</tbody></table>";
}

/* ---------- Renderers ---------- */

function renderTop() {
  const last = lastPull();
  $("fresh").innerHTML = icon("clock", "dash-icon--sm") + (last ? `Analytics pulled ${esc(dot(pulledDate(last)))}` : "No pull yet");
  $("fresh").title = `Pulls automatically every ${S.settings.autoPullHours || 6} hours while the app is running.`;
}

function renderOverview() {
  const cur = countsOf(S.matches);
  const prev = S.pulls.length > 1 ? S.pulls[S.pulls.length - 2] : null;
  const pc = prev ? prev.counts : cur;
  const ats = [...new Set(S.matches.filter((m) => m.channel === "ats").map((m) => m.referrer))];
  const ai = aiTotal(S.pulls), aiPrev = aiTotal(S.pulls.slice(0, -1));
  const since = prev ? dot(pulledDate(prev)) : "";
  const K = [
    [cur.high, pc.high, "High odds reads", "high", "high", "#pull?odds=high", "Show the high odds reads"],
    [cur.medium, pc.medium, "Medium odds reads", "medium", "medium", "#pull?odds=medium", "Show the medium odds reads"],
    [cur.low, pc.low, "Real readers, no match", "eye", "mute", "#pull?odds=low", "Show the readers with no match"],
    [cur.resume, pc.resume, "Outside resume downloads", "resume", "", "#pull?only=resume", "Show the reads that downloaded the resume"],
    [cur.ats, pc.ats, "Applicant systems that passed a referrer", "briefcase", "", "#pull?only=ats", "Show the reads from inside an applicant system"],
    [ai, aiPrev, "AI assistant referrals", "sparkle", "", "#pull?only=ai", "Show the reads from AI assistants"]
  ];
  $("kpis").innerHTML = K.map(([n, was, label, ic, tone, href, action]) => {
    const d = n - (was || 0);
    return `<sdc-card class="dash-kpi-card"><div class="dash-kpi"><div class="dash-kpi__top">${tile(ic, tone)}<span class="dash-kpi__trend${d > 0 ? "" : " dash-kpi__trend--flat"}">${icon(d > 0 ? "trend" : "flat")}</span></div>
      <a class="sdc-card__link dash-kpi__label" href="${href}" title="${esc(action)}">${esc(label)}<span class="sdc-u-sr-only">. ${esc(action)}.</span></a><span class="dash-kpi__n">${n}</span>
      <span class="dash-kpi__delta">${prev ? (d > 0 ? `+${d} since ${since}` : `No change since ${since}`) : "First pull"}</span></div></sdc-card>`;
  }).join("");
  const highApps = new Set(S.matches.filter((m) => m.confidence === "high").map((m) => m.application.split(/[ ,(]/)[0]));
  $("kpi-note").textContent = `High odds reads cover ${highApps.size} companies. Referrers seen from applicant systems: ${ats.join(", ") || "none yet"}.`;

  $("activity").innerHTML = sortedMatches().filter((m) => m.confidence !== "person").slice(0, 6).map((x) => {
    const tone = x.confidence === "high" ? "high" : x.confidence === "medium" ? "medium" : "mute";
    return `<li class="dash-activity__item">${tile(CH_ICON[x.channel] || "mail", tone)}<div><a class="sdc-card__link dash-activity__title" href="#pull?read=${encodeURIComponent(x.id)}">${esc(x.who)}<span class="sdc-u-sr-only">. Open this read on Application pull.</span></a><span class="dash-activity__sub">${esc(x.place)} · ${esc(x.application)}</span></div>
      <div class="dash-activity__meta"><strong>${dot(x.date)}</strong>${oddsIcon(x.confidence)}</div></li>`;
  }).join("") || '<li><div></div><div class="dash-note">No reads yet. Finish the Google Analytics setup in Settings.</div></li>';
  $("ov-channels").innerHTML = bars(channelRows());
  $("ov-pages").innerHTML = pageRows().slice(0, 5).map((r) => `<li><span>${esc(r[0])}</span><strong>${r[1]}</strong></li>`).join("");
}

function tally(list, key) {
  const t = {};
  list.forEach((x) => [].concat(key(x)).forEach((k) => { if (k) t[k] = (t[k] || 0) + 1; }));
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}
function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return rows.map((r) => `<li><div class="dash-bar__row"><span>${esc(r[0])}</span><strong>${r[1]}</strong></div><div class="dash-bar__track" aria-hidden="true"><div class="dash-bar__fill" style="width:${Math.round(r[1] / max * 100)}%"></div></div></li>`).join("");
}
const readers = () => S.matches.filter((m) => m.confidence !== "person");
const pageRows = () => tally(readers(), (x) => (x.pages || []).filter((p) => p !== "home").map(pageName));
const channelRows = () => tally(S.matches.filter((m) => m.confidence === "high" || m.confidence === "medium"), (x) => CH[x.channel] || x.channel);
const metro = metroLabel;

function renderPull() {
  const base = sortedMatches();
  const all = filterOnly ? base.filter(ONLY[filterOnly].test) : base;
  $("pull-only").innerHTML = filterOnly ? `<p class="dash-active-filter" role="status">${icon("filter", "dash-icon--sm")}<span>Showing only reads that ${esc(ONLY[filterOnly].label)}.</span><a class="dash-rowbtn" href="#pull">Show all reads</a></p>` : "";
  const counts = { all: all.length, high: 0, medium: 0, low: 0 };
  all.forEach((m) => { if (counts[m.confidence] !== undefined) counts[m.confidence]++; });
  // Same icons as the Odds column and the legend; "All" uses the overview icon.
  $("filters").innerHTML = [["all", "All", "overview", "all"], ["high", "High", "high", "high"], ["medium", "Medium", "medium", "medium"], ["low", "Low", "eye", "low"]].map(([k, l, ic, tone]) =>
    `<button type="button" class="sdc-btn dash-filter dash-filter--${tone}${k === filterOdds ? " sdc-btn--primary" : ""}" aria-pressed="${k === filterOdds}" data-f="${k}">${icon(ic, "dash-icon--sm")}${l} · ${counts[k]}</button>`).join("");
  $("legend").innerHTML = [["high", "High:", "the referrer or hour matches a touch, and the place fits."], ["medium", "Medium:", "the timing fits, with more than one candidate."], ["low", "Low:", "a real reader, with no solid match."]]
    .map((r) => `<li>${oddsIcon(r[0])}<span><strong>${r[1]}</strong> ${r[2]}</span></li>`).join("");
  const list = filterOdds === "all" ? all : all.filter((m) => m.confidence === filterOdds);
  if (focusRead) {
    const i = list.findIndex((m) => m.id === focusRead);
    if (i >= 0) paging.pull = Math.floor(i / PAGE_SIZE);
  }
  if (!list.length) { $("pull-table").innerHTML = '<p class="dash-note" style="padding: var(--sdc-space-md)">No reads match this filter yet.</p>'; $("pull-pager").innerHTML = ""; return; }
  paged("pull", list, matchTable, "pull-table", "pull-pager");
  const row = focusRead && document.querySelector(`#pull-table tr[data-row="${CSS.escape(focusRead)}"]`);
  if (row) requestAnimationFrame(() => { row.scrollIntoView({ block: "center" }); row.focus({ preventScroll: true }); });
}

function renderLatest() {
  const last = lastPull();
  if (!last) { $("c-latest").innerHTML = panel("No pull yet", '<p>Finish the Google Analytics setup in Settings. The first check for new visits runs right after.</p>', "latest"); $("latest-table").innerHTML = ""; $("latest-pager").innerHTML = ""; return; }
  let cards = last.items;
  if (!cards) {
    const f = last.filtered || {};
    const fresh = S.matches.filter((m) => (last.newMatches || []).includes(m.id));
    // (cards describe the most recent pull only)
    const byOdds = (c) => fresh.filter((m) => m.confidence === c).length;
    cards = [
      { icon: "latest", title: "What came in", items: [
        `${last.events || 0} events, ${last.pageViews || 0} page views, ${last.firstVisits || 0} first visits.`,
        `${last.realReaders || 0} readers worth a look, ${last.thin || 0} too thin to score.`,
        `<strong>New:</strong> ${byOdds("high")} high, ${byOdds("medium")} medium, ${byOdds("low")} low. ${(last.updatedMatches || []).length} earlier ${(last.updatedMatches || []).length === 1 ? "reader" : "readers"} came back.`
      ] },
      { icon: "sparkle", title: "AI assistants", items: [last.ai ? `${last.ai} new ${last.ai === 1 ? "visit" : "visits"} from an AI assistant.` : "No AI assistant visits this pull."] },
      { icon: "filter", title: "Filtered out", items: [`Your own visits: ${f.own || 0}.`, `Machines: ${f.machine || 0}.`, `Referral spam: ${f.spam || 0}.`, `Other sites in the same property: ${f["other-host"] || 0}.`] },
      { icon: "clock", title: "This pull", items: [`${last.source || "Pull"}, ${new Date(last.at).toLocaleString("en-US", { timeZone: S.settings.displayTimeZone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}.`, `Covers ${dot(last.range.start)} to ${dot(last.range.end)}.`, `Next automatic pull within ${S.settings.autoPullHours || 6} hours while the app runs.`] }
    ];
  }
  if (!last.items && !(last.newMatches || []).length && !(last.updatedMatches || []).length) cards[0].items.unshift("<strong>Nothing new since the pull before.</strong> The table below shows the last 7 days.");
  $("c-latest").innerHTML = cards.map((c) => panel(c.title, `<ul class="dash-list">${c.items.map((i) => `<li>${i}</li>`).join("")}</ul>`, c.icon)).join("");
  const ids = readsSince(Date.now() - 7 * DAY_MS);
  const list = sortedMatches().filter((m) => ids.has(m.id));
  $("latest-heading").textContent = `New and updated reads, last 7 days (${list.length})`;
  if (!list.length) { $("latest-table").innerHTML = '<p class="dash-note" style="padding: var(--sdc-space-md)">No new readers in the last 7 days.</p>'; $("latest-pager").innerHTML = ""; }
  else paged("latest", list, matchTable, "latest-table", "latest-pager");
  try { if (currentView() === "latest") localStorage.setItem("dash-latest-seen", String(Date.now())); } catch (e) { /* private mode */ }
}

function renderConclusions() {
  $("notes-written").textContent = S.notes.written ? `Written ${dot(S.notes.written)}. These are notes, not live numbers.` : "";
  if (!(S.notes.conclusions || []).length) { $("c-conclusions").innerHTML = '<p class="dash-note">Nothing here yet. After a few weeks of visits, this is where notes about what the data shows go.</p>'; return; }
  $("c-conclusions").innerHTML = `<ul class="dash-iconlist">${(S.notes.conclusions || []).map((c) => `<li>${tile(c.icon)}<div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div></li>`).join("")}</ul>`;
}

function renderReading() {
  const places = tally(readers(), (x) => metro(x.place));
  $("c-reading").innerHTML =
    panel("What they read", `<p class="dash-note">Real readers who opened each page (home left out, every reader lands there).</p><ul class="dash-bars" style="margin-top: var(--sdc-space-sm)">${bars(pageRows())}</ul>`, "book") +
    panel("How they arrived", `<p class="dash-note">High and medium reads, by what came right before the visit.</p><ul class="dash-bars" style="margin-top: var(--sdc-space-sm)">${bars(channelRows())}</ul>`, "route") +
    panel("Where they read from", `<p class="dash-note">Real readers by metro (you and machines filtered out).</p><ul class="dash-bars" style="margin-top: var(--sdc-space-sm)">${bars(places)}</ul>`, "pin") +
    panel("Where nobody showed up", `<ul class="dash-list">${(S.notes.silences || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`, "eyeoff");
}

const GA = "https://analytics.google.com/analytics/web/";
function siteChecks(site) {
  const out = [];
  const h = site.health || {};
  const name = `GA4 property ${site.propertyName ? `${site.propertyName} (${site.propertyId})` : site.propertyId}`;
  const robot = G.mode === "service" ? G.serviceEmail : "";
  const toSites = { href: "#settings?go=websites", label: "Choose it in Settings" };
  if (!site.propertyId) out.push(["bad", "No Google Analytics property", `Pick this site's property under Settings, Your websites. If the site has no GA4 property yet, create one in Google Analytics${robot ? `, then add the robot account to it as a Viewer` : ""}.`, toSites]);
  else if (!G.connected) out.push(["warn", name, "Not connected yet.", { href: "#settings?go=google", label: "Finish the setup" }]);
  else if (props && !props.some((x) => x.id === site.propertyId)) out.push(["bad", `${name} is not readable`, robot ? `The robot account cannot read this property. In Google Analytics: Admin, Property access management, the blue +, Add users. Add ${robot} as a Viewer.` : "Your Google sign-in cannot read this property. Reconnect with the account that owns it.", { href: GA, label: "Open Google Analytics", external: true }]);
  else out.push(["ok", name, robot ? `Connected through the robot account. New visits come in on their own.` : "Connected. New visits come in on their own."]);
  if (site.propertyId && h.retention && !["FOURTEEN_MONTHS", "TWENTY_SIX_MONTHS", "THIRTY_EIGHT_MONTHS", "FIFTY_MONTHS"].includes(h.retention))
    out.push(["warn", "Data retention is short", "Google Analytics keeps visits for 2 months, so older ones cannot be matched. In Google Analytics: Admin, Data collection and modification, Data retention. Choose 14 months, then Save.", { href: GA, label: "Open Google Analytics", external: true }]);
  if (site.propertyId && h.checkedAt && !h.timeZone)
    out.push(["warn", "Reporting time zone is not set", "This app already converts the hours. To make Google Analytics' own reports read right too: Admin, Property details, Reporting time zone.", { href: GA, label: "Open Google Analytics", external: true }]);
  for (const n of site.notes || []) out.push(["info", "Note", n, !site.propertyId ? toSites : null]);
  return out;
}
// Notes inform; only checks that need a fix count toward the badge.
function healthIssues() { return S.settings.sites.flatMap((s) => siteChecks(s).filter((c) => c[0] === "warn" || c[0] === "bad")); }

function renderHealth() {
  const LBL = { ok: "Working", warn: "Fix", bad: "Missing", info: "Note" };
  const act = (a) => !a ? "" : a.external ? `<a class="dash-fix" href="${a.href}" target="_blank" rel="noopener noreferrer">${esc(a.label)}${icon("external", "dash-icon--sm")}<span class="sdc-u-sr-only"> (opens in a new tab)</span></a>` : `<a class="dash-fix" href="${a.href}">${esc(a.label)}${icon("arrow", "dash-icon--sm")}</a>`;
  $("c-sites").innerHTML = S.settings.sites.map((s) => {
    const checks = siteChecks(s);
    const bad = checks.some((c) => c[0] === "bad");
    return panel(s.name, `<p class="dash-note" style="margin-bottom: var(--sdc-space-sm)">${esc(s.role || "")}</p><div class="dash-src">` +
      checks.map((c) => `<div><div class="dash-src__row"><span class="dash-chip dash-chip--${c[0] === "info" ? "low" : c[0]}">${LBL[c[0]]}</span><strong>${esc(c[1])}</strong></div><div class="dash-note">${esc(c[2])}</div>${act(c[3])}</div>`).join("") + "</div>", "globe", bad ? "bad" : null);
  }).join("");
  const last = lastPull();
  $("gaps").innerHTML = panel("Pulls", `<ul class="dash-list"><li>${last ? `Last pull ${esc(dot(pulledDate(last)))}, ${esc(last.source || "")}.` : "No pull yet."}</li><li>Pulls run on their own every ${S.settings.autoPullHours || 6} hours while the app is running, and right after you connect Google.</li><li>${S.applications.length} applications and ${S.touches.length} contacts on file to score against.</li></ul>`, "clock");
}


/* ---------- Warm leads ---------- */
// Jobs that match you first; then who to reach out to about each one.

// How warm a contact is, from the strongest thing that has happened with them.
const WARMTH = { call: 3, interview: 3, referral: 3, "message-in": 3, "email-in": 3, "profile-view": 2, connection: 1, "message-out": 1, "email-out": 1 };
const warmText = (k) => ({ call: "You talked", interview: "Interviewed", referral: "Referral", "message-in": "They wrote to you", "email-in": "They emailed you", "profile-view": "Viewed your profile", connection: "You sent a connection request", "message-out": "You wrote to them", "email-out": "You emailed them" }[k] || "Contact");
const CONNECT_NOTE = "Hi {first}, I saw the {role} role at {company}. {pitch} I would be glad to connect. Thanks, {me}";
const MESSAGE_NOTE = "Hi {first},\n\nI saw the {role} role at {company} and wanted to reach out directly. {pitch}\n\nWould you be open to a short conversation, or could you point me to the person hiring for this role?\n\nThanks,\n{me}";
const LEAD_DEFAULTS = { titles: ["product designer", "design systems"], seniority: ["principal", "staff", "lead", "senior"], skip: ["manager", "director"], locations: ["remote"], payFloor: 0, postedWithinDays: 0, minWarmth: 2, extraBoards: [], connectNote: CONNECT_NOTE, messageNote: MESSAGE_NOTE };
const leadRules = () => ({ ...LEAD_DEFAULTS, ...(S.settings.leads || {}) });
const word = (w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`, "i");
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
let leadsShowHidden = false;
let leadsOnlyKnown = false;

function peopleAt(key) {
  const by = new Map();
  for (const t of S.touches) {
    if (!t.person || t.kind === "rejection" || companyKey(t.company) !== key) continue;
    const cur = by.get(t.person) || { person: t.person, company: t.company, warmth: 0, last: "", kind: "" };
    const w = WARMTH[t.kind] || 1;
    if (w > cur.warmth || (w === cur.warmth && String(t.at) > cur.last)) { cur.warmth = w; cur.kind = t.kind; }
    if (String(t.at) > cur.last) cur.last = String(t.at);
    by.set(t.person, cur);
  }
  return [...by.values()].sort((a, b) => b.warmth - a.warmth || b.last.localeCompare(a.last));
}

const urlKey = (u) => { try { const x = new URL(u); return (x.hostname + x.pathname).replace(/\/+$/, "").toLowerCase(); } catch (e) { return ""; } };
const roleKey = (r) => String(r || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function alreadyApplied(job) {
  const u = urlKey(job.url);
  return S.applications.find((a) => (u && urlKey(a.jobUrl) === u) || (companyKey(a.company) === job.companyKey && roleKey(a.role) === roleKey(job.title)) || (job.req && a.req && a.req === job.req && companyKey(a.company) === job.companyKey));
}
// Outreach already logged about this job (its link is in the note).
const outreachFor = (job) => S.touches.filter((t) => companyKey(t.company) === job.companyKey && String(t.notes || "").includes(job.url)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];

function leadList() {
  const L = leadRules();
  const now = Date.now();
  const hidden = new Set((S.leads && S.leads.hidden) || []);
  const out = { shown: [], applied: 0, hidden: 0, known: 0, all: 0 };
  const days = (iso) => (now - Date.parse(String(iso).length === 10 ? `${iso}T12:00:00` : iso)) / DAY_MS;
  for (const j of (S.leads && S.leads.jobs) || []) {
    const t = String(j.title).toLowerCase();
    if (!L.titles.some((w) => t.includes(w.toLowerCase())) || !L.seniority.some((w) => word(w).test(t)) || L.skip.some((w) => word(w).test(t))) continue;
    const loc = String(j.location).toLowerCase();
    if (L.locations.length && !L.locations.some((w) => loc.includes(w.toLowerCase()))) continue;
    if (L.postedWithinDays > 0 && j.posted && days(j.posted) > L.postedWithinDays) continue;
    if (alreadyApplied(j)) { out.applied++; continue; }
    const isHidden = hidden.has(j.id);
    if (isHidden) out.hidden++;
    if (isHidden !== leadsShowHidden) continue;

    // How well the job fits, before anyone you know is counted.
    const why = [];
    let score = 0;
    if (/principal|staff|distinguished/.test(t)) { score += 6; why.push(`${(t.match(/principal|staff|distinguished/) || [""])[0].replace(/^./, (c) => c.toUpperCase())} level`); }
    else if (word("lead").test(t)) { score += 4; why.push("Lead level"); }
    else if (word("senior").test(t)) { score += 3; why.push("Senior level"); }
    if (/design system/.test(t)) { score += 4; why.push("Design systems"); }
    else if (/product designer/.test(t)) score += 3;
    if (/remote/.test(loc)) { score += 2; why.push("Remote"); }
    const near = L.locations.filter((w) => !/remote/i.test(w));
    if (near.some((w) => loc.includes(w.toLowerCase()))) { score += 3; why.push("Near you"); }
    const below = j.pay && L.payFloor && j.pay.max < L.payFloor;
    if (j.pay) { score += below ? -5 : 3; why.push(below ? "Pay under your floor" : "Pay meets your floor"); }
    if (j.posted) { const d = days(j.posted); if (d <= 7) { score += 3; why.push("Posted this week"); } else if (d <= 30) score += 1; }
    const people = peopleAt(j.companyKey);
    const warm = people.filter((p) => p.warmth >= (L.minWarmth || 2));
    if (warm.length) { score += 4; why.push(`You know ${warm[0].person.split(" ")[0]}`); }
    else if (people.length) score += 1;
    if (warm.length) out.known++;
    out.all++;
    if (leadsOnlyKnown && !warm.length) continue;
    const match = score >= 12 ? "Strong match" : score >= 8 ? "Good match" : "Possible match";
    out.shown.push({ ...j, people, warm, score, below, why, match, reached: outreachFor(j) });
  }
  out.shown.sort((a, b) => b.score - a.score || String(b.posted).localeCompare(String(a.posted)));
  return out;
}

const leadsSeen = () => { try { return Number(localStorage.getItem("dash-leads-seen")) || 0; } catch (e) { return 0; } };
function newLeadCount() {
  if (!S.leads) return 0;
  const seen = leadsSeen();
  return seen ? leadList().shown.filter((j) => Date.parse(j.firstSeen) > seen).length : 0;
}

function leadRows(rows) {
  const seen = leadsSeen();
  return `<ul class="dash-leads">${rows.map((j) => {
    const pay = j.pay ? `${money(j.pay.min)}${j.pay.max !== j.pay.min ? ` to ${money(j.pay.max)}` : ""}` : "Pay not posted";
    const isNew = seen > 0 && Date.parse(j.firstSeen) > seen;
    const posted = j.postedNote || (j.posted ? `posted ${dot(j.posted)}` : "");
    const tone = j.match === "Strong match" ? "high" : j.match === "Good match" ? "medium" : "low";
    let who;
    if (j.reached) who = `${tile("high", "high")}<div><strong>You reached out${j.reached.person ? ` to ${esc(j.reached.person)}` : ""}</strong><span class="dash-sub">${esc(kindLabel(j.reached.kind))} ${esc(dot(String(j.reached.at).slice(0, 10)))}</span></div>`;
    else if (j.warm.length) who = `${tile("users", "high")}<div><strong>Reach out to ${esc(j.warm[0].person)}</strong><span class="dash-sub">${esc(warmText(j.warm[0].kind))} ${esc(dot(j.warm[0].last.slice(0, 10)))}${j.warm.length > 1 ? ` · ${j.warm.length - 1} more you know there` : ""}</span></div>`;
    else if (j.people.length) who = `${tile("users", "mute")}<div><strong>${esc(j.people[0].person)}</strong><span class="dash-sub">${esc(warmText(j.people[0].kind))} ${esc(dot(j.people[0].last.slice(0, 10)))}, no reply yet</span></div>`;
    else who = `${tile("search", "mute")}<div><strong>No one on file yet</strong><span class="dash-sub">Reach out finds people there</span></div>`;
    return `<li><sdc-card><div class="dash-panel dash-lead">
      <div class="dash-lead__main">
        <div class="dash-lead__tags"><span class="dash-chip dash-chip--${tone}">${j.match}</span>${isNew ? '<span class="dash-chip dash-chip--new">New</span>' : ""}</div>
        <a class="dash-lead__title" href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">${esc(j.title)}${icon("external", "dash-icon--sm")}<span class="sdc-u-sr-only"> (job posting, opens in a new tab)</span></a>
        <p class="dash-note">${esc(j.company)} · ${esc(j.location || "Location not listed")}${posted ? ` · ${esc(posted)}` : ""}</p>
        <p class="dash-lead__pay${j.below ? " is-below" : ""}">${esc(pay)}${j.below ? ` · under your ${money(leadRules().payFloor)} floor` : ""}</p>
        ${j.why.length ? `<p class="dash-note dash-lead__why">${esc(j.why.join(" · "))}</p>` : ""}
        <div class="dash-lead__contact">${who}</div>
      </div>
      <div class="dash-lead__actions">
        <button type="button" class="sdc-btn sdc-btn--primary dash-lead__btn" data-lead-apply="${esc(j.id)}" title="Start an application for this job">Apply<span class="sdc-u-sr-only">: start an application for ${esc(j.title)}</span></button>
        <button type="button" class="sdc-btn dash-lead__btn" data-lead-reach="${esc(j.id)}" title="Find someone and write the note">Reach out<span class="sdc-u-sr-only"> about ${esc(j.title)}</span></button>
        <button type="button" class="sdc-btn dash-lead__btn" data-lead-hide="${esc(j.id)}" title="${leadsShowHidden ? "Put this job back on the list" : "Hide this job"}">${leadsShowHidden ? "Show" : "Hide"}</button>
      </div>
    </div></sdc-card></li>`;
  }).join("")}</ul>`;
}

function renderLeads() {
  const L = leadRules();
  if (!S.leads) {
    $("leads-summary").innerHTML = '<p>The first check has not run yet. It runs on its own within a minute of starting the app, or press <b>Check now</b>.</p>';
    $("leads-list").innerHTML = ""; $("leads-pager").innerHTML = ""; $("leads-more").innerHTML = ""; $("leads-filters").innerHTML = "";
    return;
  }
  const r = leadList();
  const list = (x) => x.map((w) => w.toLowerCase()).join(", ");
  $("leads-checked").textContent = `Checked ${dot(new Date(S.leads.checkedAt).toISOString().slice(0, 10))} · ${S.leads.companies} companies`;
  $("leads-filters").innerHTML = `<p class="sdc-field__label" id="leads-filter-label">Show</p><div class="dash-filters" role="group" aria-labelledby="leads-filter-label">
    <button type="button" class="sdc-btn dash-filter dash-filter--all${!leadsOnlyKnown ? " sdc-btn--primary" : ""}" aria-pressed="${!leadsOnlyKnown}" data-leads-known="0">${icon("overview", "dash-icon--sm")}All matches · ${r.all}</button>
    <button type="button" class="sdc-btn dash-filter dash-filter--high${leadsOnlyKnown ? " sdc-btn--primary" : ""}" aria-pressed="${leadsOnlyKnown}" data-leads-known="1">${icon("users", "dash-icon--sm")}Where you know someone · ${r.known}</button>
  </div>`;
  $("leads-summary").innerHTML = `<p class="dash-note">Jobs with <b>${list(L.seniority)}</b> and <b>${list(L.titles)}</b> in the title, ${L.locations.length ? `in <b>${list(L.locations)}</b>` : "in any location"}${L.postedWithinDays > 0 ? `, posted in the last ${L.postedWithinDays} days` : ""}. Best match first. ${r.applied} you already applied to ${r.applied === 1 ? "is" : "are"} left out. <a href="#settings?go=leads">Change these</a>${r.hidden ? ` · <button type="button" class="dash-rowbtn" id="leads-toggle-hidden">${leadsShowHidden ? "Back to the list" : `Show the ${r.hidden} you hid`}</button>` : ""}</p>`;
  if (!r.shown.length) { $("leads-list").innerHTML = `<p class="dash-note">${leadsShowHidden ? "Nothing hidden." : leadsOnlyKnown ? "No matching jobs where you know someone right now." : "No open jobs match right now. The next check runs tomorrow."}</p>`; $("leads-pager").innerHTML = ""; }
  else paged("leads", r.shown, leadRows, "leads-list", "leads-pager", 9);
  const names = new Map(S.touches.filter((t) => t.person && t.company).map((t) => [companyKey(t.company), t.company]));
  const missing = (S.leads.withoutBoard || []).map((k) => names.get(k) || k).sort((a, b) => a.localeCompare(b));
  $("leads-more").innerHTML = (missing.length ? `<details class="dash-more-options"><summary>${missing.length} companies where you know someone are not checked, because no job board is on file</summary>
      <p class="dash-note">To include one, paste a link to any of its job postings under <a href="#settings?go=leads">Settings, Warm leads</a>. Links from Greenhouse, Lever, Ashby, Workday and SmartRecruiters work.</p>
      <p>${missing.map(esc).join(" · ")}</p></details>` : "") +
    ((S.leads.errors || []).length ? `<p class="dash-note">Could not check: ${S.leads.errors.map((e) => esc(e.company)).join(", ")}.</p>` : "");
  $("leads-filters").onclick = (e) => { const b = e.target.closest("[data-leads-known]"); if (!b) return; leadsOnlyKnown = b.dataset.leadsKnown === "1"; paging.leads = 0; renderLeads(); $("leads-filters").querySelector(`[data-leads-known="${b.dataset.leadsKnown}"]`).focus(); };
  const tog = $("leads-toggle-hidden");
  if (tog) tog.onclick = () => { leadsShowHidden = !leadsShowHidden; paging.leads = 0; renderLeads(); };
  try { if (currentView() === "leads") localStorage.setItem("dash-leads-seen", String(Date.now())); } catch (e) { /* private mode */ }
}

function leadById(id) { return ((S.leads && S.leads.jobs) || []).find((j) => j.id === id); }
async function checkLeadsNow() {
  const b = $("leads-check"), st = $("leads-status");
  b.disabled = true; st.textContent = "Checking the job boards…";
  try {
    const r = await api("/api/leads/refresh", "POST", {});
    S.leads = (await loadAll()).leads;
    st.textContent = `Checked. ${r.jobs} design jobs found.`;
    renderNav(); renderLeads();
  } catch (err) { st.textContent = err.message; }
  finally { b.disabled = false; }
}

// LinkedIn searches. LinkedIn takes Boolean keywords; network F and S are your 1st and 2nd connections.
const liSearch = (keywords, network) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}${network ? `&network=${encodeURIComponent('["F","S"]')}` : ""}`;

// Find someone, write the note, send it on LinkedIn yourself, then log it here.
function reachOut(id) {
  const j = leadById(id);
  if (!j) return;
  const L = leadRules();
  const people = peopleAt(j.companyKey);
  const prof = S.settings.profile || {};
  const fill = (tpl, name) => String(tpl).replace(/\{me\}/g, prof.name || "").replace(/\{pitch\}/g, prof.pitch || "").replace(/ {2,}/g, " ").replace(/\{first\}/g, (name || "").split(" ")[0] || "there").replace(/\{name\}/g, name || "there").replace(/\{role\}/g, j.title).replace(/\{company\}/g, j.company).replace(/\{link\}/g, j.url);
  const quoted = `"${j.company}"`;
  const finds = [
    ["People you know there (1st and 2nd connections)", liSearch(quoted, true)],
    ["Design leaders there", liSearch(`${quoted} AND ("design manager" OR "head of design" OR "design director" OR "director of design")`)],
    ["Recruiters there", liSearch(`${quoted} AND (recruiter OR "talent acquisition")`)]
  ];
  const options = people.map((p, i) => `<label class="dash-pick"><input type="radio" name="r-who" value="${i}"${i === 0 ? " checked" : ""}><span><b>${esc(p.person)}</b><span class="dash-sub">${esc(warmText(p.kind))} ${esc(dot(p.last.slice(0, 10)))}</span></span></label>`).join("");
  openDialog({
    title: `Reach out about ${j.title}`,
    submitLabel: "Log outreach",
    body: `<p class="dash-note">${esc(j.company)}. Pick who to contact, copy the note, and send it on LinkedIn yourself. Then press Log outreach so this job shows that you reached out.</p>
      <fieldset class="dash-pickset"><legend class="sdc-field__label">Who</legend>
        ${options}
        <label class="dash-pick"><input type="radio" name="r-who" value="new"${people.length ? "" : " checked"}><span><b>Someone new</b><span class="dash-sub">Find them with a search below, then type their name.</span></span></label>
        <div class="dash-inline">${finds.map(([l, u]) => `<a class="dash-rowbtn" href="${u}" target="_blank" rel="noopener noreferrer">${esc(l)}${icon("external", "dash-icon--sm")}</a>`).join("")}</div>
        ${field("r-name", "Their name", input("r-name", "", "text", 'placeholder="First and last name" autocomplete="off"'))}
      </fieldset>
      <div class="dash-form-grid">
        ${field("r-how", "How", select("r-how", "connection", [["connection", "Connection request"], ["message-out", "Message (already connected)"]]))}
        <div class="sdc-field"><div class="sdc-field__head"><span class="sdc-field__label">Their profile</span></div><a class="sdc-btn" id="r-open" href="#" target="_blank" rel="noopener noreferrer">${icon("external", "dash-icon--sm")}Open on LinkedIn</a></div>
      </div>
      <div class="sdc-field"><div class="sdc-field__head"><label class="sdc-field__label" for="r-note">Note</label><span class="sdc-field__value" id="r-count"></span></div>
        <textarea class="sdc-field__input" id="r-note" name="r-note" rows="7"></textarea>
        <p class="sdc-field__hint">Edit it here, or change the starting text under Settings, Warm leads.</p></div>
      <div class="dash-inline"><button type="button" class="sdc-btn" id="r-copy">${icon("steps", "dash-icon--sm")}Copy note</button><span class="dash-note" id="r-copy-status" role="status" aria-live="polite"></span></div>`,
    onOpen: (form) => {
      let edited = false;
      const who = () => { const v = (form.querySelector('input[name="r-who"]:checked') || {}).value; return v === "new" || v === undefined ? $("r-name").value.trim() : people[Number(v)].person; };
      const update = () => {
        const name = who(), how = $("r-how").value;
        if (!edited) $("r-note").value = fill(how === "connection" ? L.connectNote : L.messageNote, name);
        const n = $("r-note").value.length;
        $("r-count").textContent = how === "connection" ? `${n} of 200 characters${n > 200 ? ". Too long for a free LinkedIn account (Premium allows 300)" : ""}` : `${n} characters`;
        $("r-open").href = name ? liSearch(`"${name}" ${quoted}`) : finds[0][1];
        $("r-name").closest(".sdc-field").hidden = (form.querySelector('input[name="r-who"]:checked') || {}).value !== "new";
      };
      form.addEventListener("change", (e) => { if (e.target.name === "r-who" || e.target.id === "r-how") { edited = false; update(); } });
      $("r-name").addEventListener("input", () => { if (!edited) update(); else update(); });
      $("r-note").addEventListener("input", () => { edited = true; update(); });
      $("r-copy").onclick = async () => { try { await navigator.clipboard.writeText($("r-note").value); $("r-copy-status").textContent = "Copied. Paste it into LinkedIn."; } catch (e) { $("r-note").select(); $("r-copy-status").textContent = "Press Command C to copy."; } };
      update();
      form.querySelector('input[name="r-who"]:checked').focus();
      form._who = who;
    },
    onSubmit: async (fd, form) => {
      const person = form._who();
      if (!person) return { "r-name": "Add the name of the person you contacted." };
      const now = localNow();
      const touch = { id: uniqueId(slugify(`${now.date}-${j.company}-${person}`), S.touches), at: `${now.date}T${now.time}`, company: j.company, person, kind: fd.get("r-how"), applicationId: "", places: [], notes: `About ${j.title}: ${j.url}` };
      S.touches.push(touch);
      await save("touches", S.touches);
      renderAll();
    }
  });
}

/* ---------- Applications ---------- */

function appRows(rows) {
  const heads = ["Submitted", "Company", "Role", "System", "Places", "Status", "Reads", ""];
  return `<table><thead><tr>${heads.map((h) => `<th scope="col" class="dash-label">${h ? h : '<span class="sdc-u-sr-only">Edit</span>'}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((a) => {
      const reads = S.matches.filter((m) => m.application.toLowerCase().includes(String(a.company).toLowerCase())).length;
      const role = safeUrl(a.jobUrl) ? `<a class="dash-jd" href="${esc(safeUrl(a.jobUrl))}" target="_blank" rel="noopener noreferrer">${esc(a.role)}${icon("external")}<span class="sdc-u-sr-only"> (job description, opens in a new tab)</span></a>` : esc(a.role);
      return `<tr><td><strong>${dot(a.submitted)}</strong>${a.submittedTime ? ` ${esc(a.submittedTime)}` : ""}</td><td>${esc(a.company)}</td><td class="dash-appcell">${role}${a.req ? `<span class="dash-sub">${esc(a.req)}</span>` : ""}</td>` +
        `<td>${esc(cap(a.ats || atsOfUrl(a.jobUrl) || ""))}</td><td>${esc((a.places || []).join("; "))}</td><td>${esc(cap(a.status || ""))}</td><td>${reads || ""}</td>` +
        `<td><button type="button" class="dash-rowbtn" data-edit-app="${esc(a.id)}" aria-label="Edit ${esc(a.company)} ${esc(a.role)}">${icon("edit", "dash-icon--sm")}Edit</button></td></tr>`;
    }).join("") + "</tbody></table>";
}
function renderApps() {
  const q = ($("app-search").value || "").toLowerCase();
  const when = (a) => `${a.submitted || ""}T${a.submittedTime || "00:00"}`;
  const list = S.applications.slice().sort((a, b) => when(b).localeCompare(when(a)))
    .filter((a) => !q || `${a.company} ${a.role} ${a.req}`.toLowerCase().includes(q));
  paged("apps", list, appRows, "app-table", "app-pager");
}

/* ---------- Contacts ---------- */

function touchRows(rows) {
  const heads = ["When", "Company", "Person", "Kind", "Application", "Notes", ""];
  return `<table><thead><tr>${heads.map((h) => `<th scope="col" class="dash-label">${h ? h : '<span class="sdc-u-sr-only">Edit</span>'}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((t) => {
      const [d, time] = String(t.at).split("T");
      const app = S.applications.find((a) => a.id === t.applicationId);
      return `<tr><td><strong>${dot(d)}</strong>${time ? ` ${esc(time)}` : ""}</td><td>${esc(t.company)}</td><td>${esc(t.person)}</td><td>${esc(kindLabel(t.kind))}</td>` +
        `<td>${app ? esc(`${app.company} ${app.role}`) : ""}</td><td>${esc(t.notes)}</td>` +
        `<td><button type="button" class="dash-rowbtn" data-edit-touch="${esc(t.id)}" aria-label="Edit contact with ${esc(t.person || t.company)}">${icon("edit", "dash-icon--sm")}Edit</button></td></tr>`;
    }).join("") + "</tbody></table>";
}
function renderTouches() {
  const q = ($("touch-search").value || "").toLowerCase();
  const list = S.touches.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .filter((t) => !q || `${t.company} ${t.person} ${t.notes}`.toLowerCase().includes(q));
  paged("touches", list, touchRows, "touch-table", "touch-pager");
}

/* ---------- Dialogs ---------- */

const field = (id, label, inputHtml, opts = {}) => `<div class="sdc-field${opts.span ? " dash-span2" : ""}"><div class="sdc-field__head"><label class="sdc-field__label" for="${id}">${esc(label)}${opts.req ? '<span class="sdc-field__req" aria-hidden="true">*</span>' : ""}</label></div>${inputHtml}${opts.hint ? `<p class="sdc-field__hint" id="${id}-hint">${opts.hint}</p>` : ""}<p class="sdc-field__error" id="${id}-err" hidden></p></div>`;
const input = (id, value, type = "text", extra = "") => `<input class="sdc-field__input" id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
const select = (id, value, options) => `<span class="dash-select"><select class="sdc-select" id="${id}" name="${id}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></span>`;
const textarea = (id, value) => `<textarea class="sdc-field__input" id="${id}" name="${id}" rows="3">${esc(value)}</textarea>`;

function openDialog({ title, body, submitLabel = "Save", onSubmit, onDelete, onOpen }) {
  const dlg = $("dialog");
  const opener = document.activeElement;
  dlg.innerHTML = `<form method="dialog" novalidate>
    <div class="dash-dialog__head"><h2 id="dialog-title" class="sdc-display-3">${esc(title)}</h2></div>
    ${body}
    <p class="dash-status" id="dialog-status" role="status" aria-live="polite"></p>
    <div class="dash-dialog__actions">${onDelete ? '<button type="button" class="sdc-btn dash-danger" data-act="delete">Delete</button><span class="dash-toolbar__grow"></span>' : ""}
      <button type="button" class="sdc-btn" data-act="cancel">Cancel</button>
      <button type="submit" class="sdc-btn sdc-btn--primary">${esc(submitLabel)}</button></div></form>`;
  const form = dlg.querySelector("form");
  const close = () => { dlg.close(); if (opener && opener.focus) opener.focus(); };
  form.querySelector('[data-act="cancel"]').onclick = close;
  const del = form.querySelector('[data-act="delete"]');
  if (del) del.onclick = async () => { if (del.dataset.confirm) { await onDelete(); close(); } else { del.dataset.confirm = "1"; del.textContent = "Delete for good?"; } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    form.querySelectorAll(".sdc-field__error").forEach((p) => { p.hidden = true; p.textContent = ""; });
    form.querySelectorAll(".sdc-field--invalid").forEach((f) => f.classList.remove("sdc-field--invalid"));
    const errors = await onSubmit(new FormData(form), form);
    if (errors && Object.keys(errors).length) {
      for (const [id, msg] of Object.entries(errors)) {
        const p = $(`${id}-err`);
        if (p) { p.textContent = msg; p.hidden = false; p.closest(".sdc-field").classList.add("sdc-field--invalid"); $(id).setAttribute("aria-invalid", "true"); }
      }
      const first = Object.keys(errors)[0];
      if ($(first)) $(first).focus(); else $("dialog-status").textContent = errors[first];
      return;
    }
    close();
  };
  dlg.showModal();
  const firstInput = form.querySelector("input, select, textarea");
  if (firstInput) firstInput.focus();
  if (onOpen) onOpen(form);
}

function localNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: S.settings.displayTimeZone || LOCAL_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const uniqueId = (base, list) => { let id = base || "item", n = 2; while (list.some((x) => x.id === id)) id = `${base}-${n++}`; return id; };
const splitList = (s) => String(s || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);

function editApp(id, prefill = {}) {
  const now = localNow();
  const a = S.applications.find((x) => x.id === id) || { company: "", role: "", req: "", submitted: now.date, submittedTime: now.time, jobUrl: "", ats: "", places: [], status: "submitted", notes: "", ...prefill };
  openDialog({
    title: id ? "Edit application" : "Add application",
    body: `<div class="dash-form-grid">
      <div class="sdc-field dash-span2">
        <div class="sdc-field__head"><label class="sdc-field__label" for="f-url">Job posting link</label></div>
        <div class="dash-urlrow">${input("f-url", a.jobUrl, "url", 'placeholder="https://" autocomplete="off"')}<button type="button" class="sdc-btn" id="f-fill">${icon("latest", "dash-icon--sm")}Fill from link</button></div>
        <p class="sdc-field__hint" id="f-fill-status" role="status" aria-live="polite">Paste the link and the details fill in on their own. Check them before saving.</p>
        <p class="sdc-field__error" id="f-url-err" hidden></p>
      </div>
      ${field("f-company", "Company", input("f-company", a.company, "text", "required"), { req: true })}
      ${field("f-role", "Role", input("f-role", a.role, "text", "required"), { req: true })}
      ${field("f-submitted", "Date applied", input("f-submitted", a.submitted, "date", "required"), { req: true })}
      ${field("f-time", "Time applied", input("f-time", a.submittedTime, "time"))}
      ${field("f-status", "Status", select("f-status", a.status || "submitted", STATUS.map((x) => [x, cap(x)])))}
      ${field("f-ats", "Applicant system", select("f-ats", a.ats || "", ATS.map((x) => [x, x ? cap(x) : "Work it out from the link"])))}
      ${field("f-req", "Requisition number", input("f-req", a.req, "text", 'placeholder="Optional"'))}
      ${field("f-places", "Locations", input("f-places", (a.places || []).join("; "), "text", 'placeholder="City, ST; Remote"'))}
      ${field("f-notes", "Notes", textarea("f-notes", a.notes), { span: true })}
    </div>
    <p class="dash-note">Only company, role and date are required. The time and locations make the odds sharper, because the app matches visits by hour and place.</p>`,
    onOpen: (form) => {
      const status = $("f-fill-status");
      const set = (fid, v) => { const el = $(fid); if (el && v && !el.value.trim()) { el.value = v; return true; } return false; };
      const fill = async () => {
        const url = $("f-url").value.trim();
        if (!/^https:\/\//.test(url)) { status.textContent = "Paste the full link, starting with https://"; return; }
        const same = S.applications.find((x) => x.id !== id && x.jobUrl && x.jobUrl === url);
        $("f-fill").disabled = true; status.textContent = "Reading the posting…";
        try {
          const j = await api("/api/job", "POST", { url });
          const filled = [];
          if (set("f-company", j.company)) filled.push("company");
          if (set("f-role", j.role)) filled.push("role");
          if (set("f-req", j.req)) filled.push("requisition");
          if (set("f-places", (j.places || []).join("; "))) filled.push("locations");
          if (j.ats && !$("f-ats").value) { $("f-ats").value = j.ats; filled.push("applicant system"); }
          status.textContent = (filled.length ? `Filled in the ${filled.join(", ")} from the posting. Check them before saving.` : "Nothing new to fill in.") + (j.note ? ` ${j.note}` : "") + (same ? ` You already have this posting, applied ${dot(same.submitted)}.` : "");
        } catch (err) { status.textContent = err.message; }
        finally { $("f-fill").disabled = false; }
      };
      $("f-fill").onclick = fill;
      $("f-url").addEventListener("paste", () => setTimeout(fill, 0));
      if (!id) $("f-url").focus();
    },
    onDelete: id ? async () => { S.applications = S.applications.filter((x) => x.id !== id); await save("applications", S.applications); renderAll(); } : null,
    onSubmit: async (fd) => {
      const errors = {};
      const company = fd.get("f-company").trim(), role = fd.get("f-role").trim(), submitted = fd.get("f-submitted");
      if (!company) errors["f-company"] = "Add the company.";
      if (!role) errors["f-role"] = "Add the role.";
      if (!submitted) errors["f-submitted"] = "Add the date you applied.";
      const url = fd.get("f-url").trim();
      if (url && !/^https?:\/\//.test(url)) errors["f-url"] = "Use the full link, starting with https://";
      if (Object.keys(errors).length) return errors;
      const next = { ...a, company, role, submitted, submittedTime: fd.get("f-time"), jobUrl: url, ats: fd.get("f-ats") || atsOfUrl(url), status: fd.get("f-status"), req: fd.get("f-req").trim(), places: splitList(fd.get("f-places")), notes: fd.get("f-notes").trim() };
      if (id) S.applications = S.applications.map((x) => (x.id === id ? next : x));
      else S.applications.push({ ...next, id: uniqueId(slugify(`${company}-${role}`), S.applications) });
      await save("applications", S.applications);
      renderAll();
    }
  });
}

function importApps() {
  openDialog({
    title: "Import applications",
    submitLabel: "Import",
    body: field("f-csv", "Paste CSV", textarea("f-csv", ""), { span: true, hint: "First row is the header. Columns: company, role, submitted (YYYY-MM-DD), jobUrl, places, status, req. Places can hold several, separated by semicolons." }),
    onSubmit: async (fd) => {
      const rows = parseCsv(fd.get("f-csv") || "");
      if (rows.length < 2) return { "f-csv": "Paste a header row and at least one application." };
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (r, name) => { const i = head.indexOf(name.toLowerCase()); return i < 0 ? "" : (r[i] || "").trim(); };
      if (head.indexOf("company") < 0 || head.indexOf("role") < 0) return { "f-csv": "The header needs company and role columns." };
      let added = 0;
      for (const r of rows.slice(1)) {
        const company = col(r, "company"), role = col(r, "role"), submitted = col(r, "submitted");
        if (!company || !role) continue;
        if (S.applications.some((a) => a.company === company && a.role === role && a.submitted === submitted)) continue;
        const jobUrl = col(r, "jobUrl");
        S.applications.push({ id: uniqueId(slugify(`${company}-${role}`), S.applications), company, role, req: col(r, "req"), submitted, submittedTime: "", jobUrl, ats: atsOfUrl(jobUrl), places: splitList(col(r, "places")), status: col(r, "status") || "submitted", statusDate: "", notes: "" });
        added++;
      }
      await save("applications", S.applications);
      renderAll();
      setStatus(`Imported ${added} ${added === 1 ? "application" : "applications"}.`);
    }
  });
}
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some((x) => x.trim())) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function editTouch(id, prefill = {}) {
  const now = localNow();
  const t = S.touches.find((x) => x.id === id) || { at: `${now.date}T${now.time}`, company: "", person: "", kind: "message-out", applicationId: "", places: [], notes: "", ...prefill };
  const apps = [["", "None"]].concat(S.applications.slice().sort((a, b) => (b.submitted || "").localeCompare(a.submitted || "")).map((a) => [a.id, `${a.company}, ${a.role}`]));
  openDialog({
    title: id ? "Edit contact" : "Log a contact",
    body: `<div class="dash-form-grid">
      ${field("t-at", "When", input("t-at", String(t.at).length === 10 ? `${t.at}T12:00` : t.at, "datetime-local", "required"), { req: true, hint: "Your local time. The hour matters most." })}
      ${field("t-kind", "Kind", select("t-kind", t.kind, KINDS.map((k) => [k, kindLabel(k)])))}
      ${field("t-company", "Company", input("t-company", t.company, "text", "required"), { req: true })}
      ${field("t-person", "Person", input("t-person", t.person))}
      ${field("t-app", "Application", select("t-app", t.applicationId || "", apps), { span: true })}
      ${field("t-places", "Places", input("t-places", (t.places || []).join("; ")), { hint: "Where this person or office is, separated by semicolons." })}
      ${field("t-notes", "Notes", textarea("t-notes", t.notes), { span: true })}
    </div>`,
    onDelete: id ? async () => { S.touches = S.touches.filter((x) => x.id !== id); await save("touches", S.touches); renderAll(); } : null,
    onSubmit: async (fd) => {
      const errors = {};
      const company = fd.get("t-company").trim(), at = fd.get("t-at");
      if (!company) errors["t-company"] = "Add the company.";
      if (!at) errors["t-at"] = "Add when it happened.";
      if (Object.keys(errors).length) return errors;
      const next = { ...t, at, company, person: fd.get("t-person").trim(), kind: fd.get("t-kind"), applicationId: fd.get("t-app"), places: splitList(fd.get("t-places")), notes: fd.get("t-notes").trim() };
      if (id) S.touches = S.touches.map((x) => (x.id === id ? next : x));
      else S.touches.push({ ...next, id: uniqueId(slugify(`${at.slice(0, 10)}-${company}-${next.person || next.kind}`), S.touches) });
      await save("touches", S.touches);
      renderAll();
    }
  });
}

function editMatch(id) {
  const m = S.matches.find((x) => x.id === id);
  if (!m) return;
  openDialog({
    title: "Edit read",
    body: `<div class="dash-form-grid">
      ${field("m-odds", "Odds", select("m-odds", m.confidence, [["high", "High"], ["medium", "Medium"], ["low", "Low"], ["person", "A contact, not an application"]]))}
      ${field("m-who", "Likely who", input("m-who", m.who))}
      ${field("m-app", "Application", input("m-app", m.application), { span: true })}
      ${field("m-note", "Notes", textarea("m-note", m.note), { span: true })}
    </div><p class="dash-note">Saving marks this read as reviewed, so later pulls add visits but keep your wording.</p>`,
    onSubmit: async (fd) => {
      Object.assign(m, { confidence: fd.get("m-odds"), who: fd.get("m-who").trim(), application: fd.get("m-app").trim(), note: fd.get("m-note").trim(), status: "reviewed" });
      await save("matches", S.matches);
      renderAll();
    }
  });
}

/* ---------- Settings ---------- */

async function loadProps() {
  if (!G.connected) { props = null; return; }
  try { props = await api("/api/google/properties"); } catch (err) { props = null; if (err.needsConnect) G.connected = false; }
}

/* The one-time Google setup, written for someone who has never used Google Cloud.
   One step open at a time; each step opens the exact Google page and names the exact buttons. */
const copyChip = (text) => `<span class="dash-copy"><code class="dash-code">${esc(text)}</code><button type="button" class="dash-rowbtn" data-copy="${esc(text)}">Copy</button></span>`;
const extLink = (label, url, primary) => `<a class="sdc-btn${primary ? " sdc-btn--primary" : ""}" href="${url}" target="_blank" rel="noopener">${esc(label)}${icon("external", "dash-icon--sm")}<span class="sdc-u-sr-only"> (opens Google Cloud in a new tab)</span></a>`;

function setupSteps() {
  const robot = G.serviceEmail || "";
  return [
    { id: "project", title: "Open Google Cloud",
      body: `<p>Sign in with the Google account you use for Google Analytics.</p>
        <p>At the top left, next to the words <b>Google Cloud</b>, you will see a project name. The one already there is fine.</p>
        <p class="dash-note">If it says <b>Select a project</b> instead: click it, click <b>New project</b>, type ${copyChip("Designer Job Search")}, and click <b>Create</b>.</p>`,
      links: [["Open Google Cloud", "https://console.cloud.google.com/"]] },
    { id: "apis", title: "Turn on Google Analytics access",
      body: `<p>There are two pages. On each one, click the blue <b>Enable</b> button.</p>
        <p class="dash-note">When it is on, the page shows <b>API Enabled</b> with a green check.</p>`,
      links: [["Open page 1 of 2", "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com"], ["Open page 2 of 2", "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com"]] },
    { id: "robot", title: "Make a robot account for the app",
      body: `<p>The app signs in to Google with its own robot account. Google calls it a <b>service account</b>.</p>
        <ol class="dash-steps-list">
          <li><b>Service account name:</b> paste ${copyChip("designer-job-search")}</li>
          <li>Click <b>Create and continue</b>.</li>
          <li>On <b>Permissions (optional)</b>, click <b>Continue</b> without choosing anything.</li>
          <li>Click <b>Done</b>.</li>
        </ol>`,
      links: [["Open the robot account page", "https://console.cloud.google.com/iam-admin/serviceaccounts/create"]] },
    { id: "key", title: "Download the robot's key",
      body: `<ol class="dash-steps-list">
          <li>In the list, click the email that starts with <b>designer-job-search</b>.</li>
          <li>Click the <b>Keys</b> tab.</li>
          <li>Click <b>Add key</b>, then <b>Create new key</b>.</li>
          <li>Choose <b>JSON</b> and click <b>Create</b>. A file downloads to your Downloads folder.</li>
        </ol>
        <p class="dash-note">Keep that file private. It works like a password for the robot. If Google says key creation is turned off for your account, use <b>Another way to connect</b> at the bottom of this card.</p>`,
      links: [["Open the robot account list", "https://console.cloud.google.com/iam-admin/serviceaccounts"]] },
    { id: "upload", title: "Give the key to this app",
      body: `<p>Choose the file that just downloaded. Its name ends in <b>.json</b>.</p>
        <form id="g-sa" class="dash-inline" novalidate>
          <label class="sdc-u-sr-only" for="g-sa-file">Key file</label>
          <input class="sdc-field__input" id="g-sa-file" type="file" accept=".json,application/json" style="max-width: 420px">
          <button type="submit" class="sdc-btn sdc-btn--primary">Save the key</button>
          <span class="dash-note" id="g-sa-status" role="status" aria-live="polite"></span>
        </form>
        <p class="dash-note">The app keeps its own copy, readable only by your Mac account. After saving, <b>delete the downloaded file</b> from Downloads and empty the Trash, so the key exists in one place.</p>`,
      noDoneButton: true },
    { id: "access", title: "Let the robot read Google Analytics",
      body: `${robot ? `<p>The robot's email: ${copyChip(robot)}</p>` : '<p class="dash-note">Save the key first. The robot\'s email shows here with a Copy button.</p>'}
        <ol class="dash-steps-list">
          <li>In Google Analytics, click <b>Admin</b> (the gear at the bottom left).</li>
          <li>Check that the property at the top is your website. Then click <b>Property access management</b>.</li>
          <li>Click the blue <b>+</b> at the top right, then <b>Add users</b>.</li>
          <li>Paste the robot's email. Uncheck <b>Notify new users by email</b>. Under <b>Direct roles</b>, choose <b>Viewer</b>. Click <b>Add</b>.</li>
        </ol>
        <p class="dash-note">Viewer can only read. Do this once for each website's property.</p>`,
      links: [["Open Google Analytics", "https://analytics.google.com/analytics/web/"]] },
    { id: "check", title: "Check the connection",
      body: `<p>The app asks Google which properties the robot can see. If it works, the first check for new visits starts on its own.</p>
        <div class="dash-inline"><button type="button" class="sdc-btn sdc-btn--primary" id="g-check"${robot ? "" : " disabled"}>Check the connection</button><span class="dash-note" id="g-check-status" role="status" aria-live="polite"></span></div>`,
      noDoneButton: true }
  ];
}

const setupDone = () => { try { return new Set(JSON.parse(localStorage.getItem("dash-setup") || "[]")); } catch (e) { return new Set(); } };
const saveSetupDone = (set) => { try { localStorage.setItem("dash-setup", JSON.stringify([...set])); } catch (e) { /* private mode */ } };
let openStep = null;

// The other way: a Google sign-in. Needs more steps, and Google ends it weekly unless the app is published.
function signInHtml() {
  return `<details class="dash-more-options">
    <summary>Another way to connect: a Google sign-in</summary>
    <div class="dash-setup">
      <p class="dash-note">Use this only if Google will not let you make a key. After steps 1 and 2 above:</p>
      <ol class="dash-steps-list">
        <li>Open the ${extLinkText("sign-in setup", "https://console.cloud.google.com/auth/overview")}, click <b>Get started</b>, name it ${copyChip("Designer Job Search")}, pick your email, choose <b>External</b>, type your email, agree, and click <b>Create</b>.</li>
        <li>Open ${extLinkText("Data access", "https://console.cloud.google.com/auth/scopes")}, click <b>Add or remove scopes</b>, filter for ${copyChip("analytics.readonly")}, check it, click <b>Update</b>, then <b>Save</b>.</li>
        <li>Open ${extLinkText("Audience", "https://console.cloud.google.com/auth/audience")}. Under <b>Test users</b>, click <b>+ Add users</b>, add your own Gmail address, and save. Leave the status on <b>Testing</b>.</li>
        <li>Open ${extLinkText("Clients", "https://console.cloud.google.com/auth/clients")}, click <b>+ Create client</b>, choose <b>Desktop app</b>, click <b>Create</b>, and paste the two codes below.</li>
      </ol>
      <form id="g-client" class="dash-form-grid" novalidate>
        ${field("g-id", "Client ID", input("g-id", G.clientId || "", "text", 'autocomplete="off" spellcheck="false"'), { span: true, hint: "Ends in .apps.googleusercontent.com" })}
        ${field("g-secret", "Client secret", input("g-secret", "", "password", `autocomplete="off" placeholder="${G.hasClient ? "Saved. Paste a new one only to replace it." : ""}"`), { span: true, hint: "Starts with GOCSPX-" })}
        <div class="dash-span2 dash-inline"><button type="submit" class="sdc-btn">Save the codes</button>${G.hasClient ? '<a class="sdc-btn sdc-btn--primary" href="/oauth/start">Connect Google Analytics</a>' : ""}<span class="dash-note" id="g-client-status" role="status" aria-live="polite"></span></div>
      </form>
      <p class="dash-note">In Testing, Google ends the connection every 7 days, and the app asks you to reconnect. To stop that, Google requires a home page and a privacy policy page on its Branding screen before you can publish.</p>
    </div>
  </details>`;
}
const extLinkText = (label, url) => `<a href="${url}" target="_blank" rel="noopener">${esc(label)}${icon("external", "dash-icon--sm")}<span class="sdc-u-sr-only"> (opens in a new tab)</span></a>`;

function setupHtml() {
  const steps = setupSteps();
  const done = setupDone();
  if (G.mode === "service") ["project", "apis", "robot", "key", "upload"].forEach((id) => done.add(id));
  const current = openStep || (steps.find((s) => !done.has(s.id)) || steps[steps.length - 1]).id;
  const count = steps.filter((s) => done.has(s.id)).length;
  return `<p>Google needs you to approve this app once before it can read your Analytics. It takes about 10 minutes. Keep this page open next to Google and go step by step.</p>
    <p class="dash-note" aria-live="polite">${count} of ${steps.length} steps done.</p>
    <ol class="dash-wizard">${steps.map((s, i) => {
      const isDone = done.has(s.id), isOpen = s.id === current;
      return `<li class="dash-wizard__step${isOpen ? " is-open" : ""}${isDone ? " is-done" : ""}">
        <button type="button" class="dash-wizard__head" data-step="${s.id}" aria-expanded="${isOpen}">
          <span class="dash-tile dash-tile--sm${isDone ? " dash-tile--high" : ""}" aria-hidden="true">${isDone ? icon("high") : `<span class="dash-wizard__n">${i + 1}</span>`}</span>
          <span class="dash-wizard__title">${esc(s.title)}</span>
          ${isDone ? '<span class="dash-note">Done</span>' : ""}
        </button>
        ${isOpen ? `<div class="dash-wizard__body">${s.body}
          ${(s.links || []).length || !s.noDoneButton ? `<div class="dash-inline">${(s.links || []).map((l, j) => extLink(l[0], l[1], j === 0)).join("")}${s.noDoneButton ? "" : `<button type="button" class="sdc-btn" data-step-done="${s.id}">${icon("high", "dash-icon--sm")}I did this. Next step</button>`}</div>` : ""}
        </div>` : ""}
      </li>`;
    }).join("")}</ol>
    ${signInHtml()}`;
}

function renderSettings() {
  const p = hashParams().get("google");
  const msg = p === "connected" ? '<p class="sdc-form-status sdc-form-status--ok">Connected. The first check for new visits is running now. Refresh at the top right shows it when it finishes.</p>' : p ? `<p class="sdc-form-status sdc-form-status--err">${esc(p)}</p>` : "";
  const st = S.settings;

  const live = G.connected && props && props.length > 0;
  const googleCard = panel(live ? "Google Analytics is connected" : "Connect Google Analytics", `
    ${msg}
    ${live
      ? `<p><span class="dash-chip dash-chip--ok">Connected</span> ${G.mode === "service" ? `with the robot account <b>${esc(G.serviceEmail)}</b>` : "with your Google sign-in"}. It can see ${props.length} ${props.length === 1 ? "property" : "properties"}. New visits come in on their own every ${st.autoPullHours || 6} hours.</p>
         <div class="dash-inline">${G.mode === "oauth" ? '<a class="sdc-btn" href="/oauth/start">Reconnect</a>' : ""}<button type="button" class="sdc-btn" id="g-disconnect">Disconnect</button></div>
         ${G.mode === "service" ? `<p class="dash-note">Disconnect deletes the key from this app. To shut the robot out completely, also delete its key in Google Cloud (${extLinkText("robot accounts", "https://console.cloud.google.com/iam-admin/serviceaccounts")}, the robot, Keys) or remove it from Google Analytics, Property access management.</p>` : ""}`
      : setupHtml()}`, "gear");

  const propOptions = (site) => {
    if (!props) return null;
    const opts = [["", "Choose a property"]].concat(props.map((x) => [x.id, `${x.name} (${x.id})`]));
    if (site.propertyId && !props.some((x) => x.id === site.propertyId)) opts.push([site.propertyId, `${site.propertyId} (not in this Google account)`]);
    return opts;
  };
  const sitesCard = panel("Your websites", `
    <p class="dash-note">${props ? `Pick each website's Google Analytics property. The list shows what ${G.mode === "service" ? "the robot account" : "your Google sign-in"} can read. If a property is missing, add the robot to it as a Viewer (setup step 6).` : "Pick each website's Google Analytics property. After the setup above, you pick from a list; until then, type the property number."}</p>
    <form id="sites-form" novalidate>
      ${st.sites.map((s, i) => `<div class="dash-site" data-i="${i}">
        <div class="dash-form-grid">
          ${field(`s-name-${i}`, "Website", input(`s-name-${i}`, s.name, "text", 'placeholder="example.com"'))}
          ${field(`s-prop-${i}`, "Google Analytics property", propOptions(s) ? select(`s-prop-${i}`, s.propertyId || "", propOptions(s)) : input(`s-prop-${i}`, s.propertyId || "", "text", 'inputmode="numeric"'))}
        </div>
        <details class="dash-more-options">
          <summary>More options for this website</summary>
          <div class="dash-form-grid">
            ${field(`s-role-${i}`, "What it is for", input(`s-role-${i}`, s.role || ""))}
            ${field(`s-hosts-${i}`, "Web addresses to count", input(`s-hosts-${i}`, (s.hosts || []).join("; ")), { hint: "Separate with semicolons. Visits to other addresses in the same property are left out." })}
            ${field(`s-tz-${i}`, "Time zone fix", input(`s-tz-${i}`, s.timeZoneOverride || "", "text", 'placeholder="Leave empty"'), { hint: "Only if Google reports the wrong hours. Example: UTC." })}
            <div class="dash-inline" style="align-self: end"><button type="button" class="dash-rowbtn" data-remove-site="${i}">Remove this website</button></div>
          </div>
        </details>
      </div>`).join("")}
      <div class="dash-inline">
        <button type="submit" class="sdc-btn sdc-btn--primary">Save websites</button>
        <button type="button" class="sdc-btn" id="site-add">${icon("plus", "dash-icon--sm")}Add a website</button>
        <span class="dash-note" id="sites-status" role="status" aria-live="polite"></span>
      </div>
    </form>`, "globe");

  const tzs = [["America/Chicago", "Central"], ["America/New_York", "Eastern"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["UTC", "UTC"], ["Europe/London", "London"]];
  const pullCard = panel("Checking for new visits", `
    <form id="pull-form" class="dash-form-grid" novalidate>
      ${field("p-every", "Check automatically every", select("p-every", String(st.autoPullHours || 6), [["3", "3 hours"], ["6", "6 hours"], ["12", "12 hours"], ["24", "Day"]]), { hint: "While the app is running. Refresh, at the top right, checks right away." })}
      ${field("p-tz", "Show times in", select("p-tz", st.displayTimeZone || LOCAL_TZ, tzs))}
      <div class="dash-span2 dash-inline"><button type="submit" class="sdc-btn sdc-btn--primary">Save</button><span class="dash-note" id="pull-status" role="status" aria-live="polite"></span></div>
    </form>`, "clock");

  const ex = st.exclude || {};
  const lists = [["ownPlaces", "Your own places", "City, State. Example: Springfield, Illinois."], ["ownScreens", "Your own screens", "Screen sizes only you use, like 3440x1440."], ["ownHosts", "Your own web addresses", "Preview and test addresses."], ["ownReferrers", "Your own tools", "Tools that link to the site when you use them."], ["machineCities", "Robot towns", "Data center towns where visits are robots, not people."], ["machineScreens", "Robot screens", "Sizes like 800x600 that only robots report."], ["machinePairs", "Robot town and screen pairs", "Town|screen. Example: Singapore|1280x1200."], ["spamReferrers", "Spam sites", "Sites that send fake visits."]];
  const advancedCard = `<sdc-card><div class="dash-panel"><details class="dash-advanced">
    <summary><span class="dash-panel__title">${tile("filter")}<h3>Advanced</h3></span><span class="dash-note">Matching rules and filters. The defaults work; change these only if results look wrong.</span></summary>
    <form id="filter-form" class="dash-form-grid" novalidate>
      ${field("p-window", "Match applications from the last", select("p-window", String((st.scoring || {}).windowDays || 60), [["30", "30 days"], ["45", "45 days"], ["60", "60 days"], ["90", "90 days"]]))}
      ${field("p-strong", "Same-hour window", select("p-strong", String((st.scoring || {}).strongHours || 2), [["1", "1 hour"], ["2", "2 hours"], ["3", "3 hours"]]), { hint: "A visit this close to a contact, from a place that fits, earns high odds." })}
      <p class="dash-note dash-span2">Visits that match any line below are left out. One entry per line.</p>
      ${lists.map(([k, label, hint]) => field(`x-${k}`, label, textarea(`x-${k}`, (ex[k] || []).join("\n")), { hint })).join("")}
      ${field("x-kit", "Adobe Fonts kit (optional)", input("x-kit", st.fontKit || "", "text", 'placeholder="abc1234" autocomplete="off" spellcheck="false"'), { hint: "Headings use Nickel Gothic when your Adobe Fonts kit has it, and League Gothic otherwise. To use your kit, type its ID (the code in its embed link) and add localhost to the kit's domains in Adobe Fonts." })}
      ${field("x-pages", "Page names", textarea("x-pages", Object.entries(st.pageNames || {}).map(([k, v]) => `${k} | ${v}`).join("\n")), { span: true, hint: "Only for pages whose name reads wrong. One per line: the page's address | its name. Example: paypal | PayPal." })}
      <div class="dash-span2 dash-inline"><button type="submit" class="sdc-btn sdc-btn--primary">Save</button><span class="dash-note" id="filter-status" role="status" aria-live="polite"></span></div>
    </form></details></div></sdc-card>`;

  const LR = leadRules();
  const leadsCard = panel("Warm leads", `
    <p class="dash-note">Which jobs show on Warm leads. Changes show right away; new job boards are read on the next check.</p>
    <form id="leads-form" class="dash-form-grid" novalidate>
      ${field("l-titles", "Job titles to look for", textarea("l-titles", LR.titles.join("\n")), { hint: "One per line. A job shows if its title has any of these." })}
      ${field("l-seniority", "Seniority", textarea("l-seniority", LR.seniority.join("\n")), { hint: "One per line. The title must have one of these words." })}
      ${field("l-skip", "Skip titles with", textarea("l-skip", LR.skip.join("\n")), { hint: "One per line. Manager and director keep the list to individual roles." })}
      ${field("l-locations", "Locations that work", textarea("l-locations", LR.locations.join("\n")), { hint: "One per line. Leave empty to see every location." })}
      ${field("l-floor", "Pay floor", input("l-floor", String(LR.payFloor || ""), "number", 'min="0" step="1000"'), { hint: "Posted pay under this is flagged, not hidden. Pay is never guessed." })}
      ${field("l-warmth", "Count someone as a warm contact when", select("l-warmth", String(LR.minWarmth || 2), [["3", "They wrote, called, referred or interviewed you"], ["2", "They engaged at all, including viewing your profile"], ["1", "You reached out, even with no reply"]]))}
      ${field("l-days", "Posted within", select("l-days", String(LR.postedWithinDays || 0), [["0", "Any time, while it is open"], ["30", "30 days"], ["60", "60 days"], ["90", "90 days"]]))}
      ${field("l-connect", "Connection note", textarea("l-connect", LR.connectNote), { span: true, hint: "Starting text for a connection request. {first} and {name} are the person; {role}, {company} and {link} the job; {me} and {pitch} come from your profile. Free LinkedIn accounts allow 200 characters." })}
      ${field("l-message", "Message", textarea("l-message", LR.messageNote), { span: true, hint: "Starting text when you are already connected. Same fill-ins." })}
      ${field("l-extra", "More job boards", textarea("l-extra", (LR.extraBoards || []).join("\n")), { span: true, hint: "One per line: Company | a link to any of its job postings. Example: Example Co | https://example.wd1.myworkdayjobs.com/careers/job/... Links from Greenhouse, Lever, Ashby, Workday and SmartRecruiters work." })}
      <div class="dash-span2 dash-inline"><button type="submit" class="sdc-btn sdc-btn--primary">Save</button><span class="dash-note" id="leads-form-status" role="status" aria-live="polite"></span></div>
    </form>`, "warm");

  const box = $("c-settings");
  box.innerHTML = `<div id="set-google">${googleCard}</div><div id="set-websites">${sitesCard}</div><div id="set-pulls">${pullCard}</div><div id="set-leads">${leadsCard}</div><div id="set-advanced">${advancedCard}</div>`;

  // Setup steps
  box.querySelectorAll("[data-step]").forEach((b) => { b.onclick = () => { openStep = openStep === b.dataset.step && b.getAttribute("aria-expanded") === "true" ? "__none" : b.dataset.step; renderSettings(); const again = box.querySelector(`[data-step="${b.dataset.step}"]`); if (again) again.focus(); }; });
  box.querySelectorAll("[data-step-done]").forEach((b) => {
    b.onclick = () => {
      const done = setupDone(); done.add(b.dataset.stepDone); saveSetupDone(done);
      const steps = setupSteps(); const i = steps.findIndex((s) => s.id === b.dataset.stepDone);
      openStep = (steps.slice(i + 1).find((s) => !done.has(s.id)) || steps[steps.length - 1]).id;
      renderSettings();
      const next = box.querySelector(`[data-step="${openStep}"]`); if (next) next.focus();
    };
  });
  box.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch (e) { b.textContent = "Select and copy"; }
      setTimeout(() => { b.textContent = "Copy"; }, 2000);
    };
  });
  const saForm = $("g-sa");
  if (saForm) saForm.onsubmit = async (e) => {
    e.preventDefault();
    const status = $("g-sa-status");
    const file = $("g-sa-file").files[0];
    if (!file) { status.textContent = "Choose the .json file first."; $("g-sa-file").focus(); return; }
    let key;
    try { key = JSON.parse(await file.text()); } catch (err) { status.textContent = "That file is not the key. Choose the .json file Google downloaded."; return; }
    try {
      G = await api("/api/google/service-account", "PUT", key);
      const done = setupDone(); ["project", "apis", "robot", "key", "upload"].forEach((id) => done.add(id)); saveSetupDone(done);
      openStep = "access";
      renderSettings();
      const next = box.querySelector('[data-step="access"]'); if (next) next.focus();
    } catch (err) { status.textContent = err.message; }
  };
  const check = $("g-check");
  if (check) check.onclick = async () => {
    const status = $("g-check-status");
    check.disabled = true; status.textContent = "Checking…";
    try {
      const r = await api("/api/google/check", "POST", {});
      props = r.properties;
      if (!props.length) { status.textContent = "Google connected, but the robot cannot see any Analytics property yet. Do step 6, then check again."; check.disabled = false; return; }
      const done = setupDone(); done.add("access"); done.add("check"); saveSetupDone(done);
      G = await api("/api/google/status");
      renderAll();
      location.hash = "#settings?google=connected";
    } catch (err) { status.textContent = err.message; check.disabled = false; }
  };
  const clientForm = $("g-client");
  if (clientForm) clientForm.onsubmit = async (e) => {
    e.preventDefault();
    const status = $("g-client-status");
    if (!$("g-id").value.trim()) { status.textContent = "Paste the Client ID first."; $("g-id").focus(); return; }
    if (!$("g-secret").value.trim() && !G.hasClient) { status.textContent = "Paste the Client secret too."; $("g-secret").focus(); return; }
    try {
      G = await api("/api/google/client", "PUT", { clientId: $("g-id").value, clientSecret: $("g-secret").value });
      renderSettings();
      const d = box.querySelector(".dash-more-options"); if (d) d.open = true;
      $("g-client-status").textContent = "Saved. Now click Connect Google Analytics.";
    } catch (err) { status.textContent = err.message; }
  };
  const disc = $("g-disconnect");
  if (disc) disc.onclick = async () => { G = await api("/api/google/disconnect", "POST", {}); props = null; renderAll(); };

  // Websites
  $("site-add").onclick = () => { readSitesForm(); st.sites.push({ id: uniqueId("site", st.sites), name: "", role: "", propertyId: "", hosts: [], notes: [], health: {} }); renderSettings(); };
  $("sites-form").onclick = (e) => { const b = e.target.closest("[data-remove-site]"); if (b) { readSitesForm(); st.sites.splice(+b.dataset.removeSite, 1); renderSettings(); } };
  $("sites-form").onsubmit = async (e) => {
    e.preventDefault();
    readSitesForm();
    await save("settings", st);
    $("sites-status").textContent = "Saved.";
    renderNav(); renderHealth();
  };
  $("pull-form").onsubmit = async (e) => {
    e.preventDefault();
    st.autoPullHours = +$("p-every").value;
    st.displayTimeZone = $("p-tz").value;
    await save("settings", st);
    $("pull-status").textContent = "Saved.";
    renderTop();
  };
  $("leads-form").onsubmit = async (e) => {
    e.preventDefault();
    const lines = (id) => $(id).value.split("\n").map((x) => x.trim()).filter(Boolean);
    const before = (st.leads && st.leads.extraBoards || []).join("\n");
    st.leads = { ...LR, titles: lines("l-titles"), seniority: lines("l-seniority"), skip: lines("l-skip"), locations: lines("l-locations"), payFloor: Number($("l-floor").value) || 0, postedWithinDays: Number($("l-days").value) || 0, minWarmth: Number($("l-warmth").value) || 2, connectNote: $("l-connect").value.trim() || CONNECT_NOTE, messageNote: $("l-message").value.trim() || MESSAGE_NOTE, extraBoards: lines("l-extra") };
    await save("settings", st);
    $("leads-form-status").textContent = "Saved.";
    renderNav(); renderLeads();
    if (st.leads.extraBoards.join("\n") !== before) { $("leads-form-status").textContent = "Saved. Reading the new job boards…"; try { await api("/api/leads/refresh", "POST", {}); S.leads = (await loadAll()).leads; renderNav(); renderLeads(); $("leads-form-status").textContent = "Saved and checked."; } catch (err) { $("leads-form-status").textContent = err.message; } }
  };
  $("filter-form").onsubmit = async (e) => {
    e.preventDefault();
    st.scoring = { ...(st.scoring || {}), windowDays: +$("p-window").value, strongHours: +$("p-strong").value };
    st.exclude = Object.fromEntries(lists.map(([k]) => [k, $(`x-${k}`).value.split("\n").map((x) => x.trim()).filter(Boolean)]));
    const kit = $("x-kit").value.trim().toLowerCase();
    if (kit && !/^[a-z0-9]{5,12}$/.test(kit)) { $("filter-status").textContent = "The Adobe Fonts kit ID is letters and numbers only, like abc1234."; return; }
    st.fontKit = kit;
    useFontKit(kit);
    st.pageNames = Object.fromEntries($("x-pages").value.split("\n").map((x) => x.split("|").map((y) => y.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toLowerCase().replace(/^\/+|\/+$/g, ""), v]));
    await save("settings", st);
    $("filter-status").textContent = "Saved. The next check uses these.";
  };
}

// #settings?go=websites scrolls to that card.
function goToSetting() {
  const go = hashParams().get("go");
  const el = go && $(`set-${go}`);
  if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
}

function readSitesForm() {
  const st = S.settings;
  document.querySelectorAll("#sites-form .dash-site").forEach((el) => {
    const i = +el.dataset.i, s = st.sites[i];
    s.name = $(`s-name-${i}`).value.trim();
    s.role = $(`s-role-${i}`).value.trim();
    const pid = $(`s-prop-${i}`).value.trim();
    if (pid !== s.propertyId) { s.propertyId = pid; s.propertyName = props ? ((props.find((x) => x.id === pid) || {}).name || "") : ""; s.health = {}; }
    s.hosts = splitList($(`s-hosts-${i}`).value);
    s.timeZoneOverride = $(`s-tz-${i}`).value.trim();
    if (!s.id || s.id.startsWith("site")) s.id = slugify(s.name) || s.id;
  });
}

/* ---------- Refresh ---------- */

function setStatus(html) { $("refresh-status").innerHTML = html; }
async function refresh() {
  const btn = $("refresh");
  if (btn.getAttribute("aria-busy") === "true") return;
  btn.setAttribute("aria-busy", "true");
  $("refresh-label").textContent = "Pulling…";
  setStatus("");
  try {
    const { pull } = await api("/api/pull", "POST", {});
    S = await loadAll();
    renderAll();
    const n = pull.newMatches.length, u = pull.updatedMatches.length;
    setStatus(`Pulled ${esc(dot(pulledDate(pull)))}. ${pull.realReaders} ${pull.realReaders === 1 ? "reader" : "readers"}, ${n} new, ${u} came back.`);
  } catch (err) {
    setStatus(err.needsConnect ? `${esc(err.message)} <a href="#settings">Open Settings</a>` : esc(err.message));
  } finally {
    btn.removeAttribute("aria-busy");
    $("refresh-label").textContent = "Refresh";
  }
}

/* ---------- First run ---------- */
// Shown once, on a fresh install: who you are, the jobs you want, your websites, then Google.

const MACHINE_CITIES = ["Ashburn", "Boardman", "Des Moines", "Moses Lake", "North Charleston", "Reston", "Manassas", "Flint Hill", "Council Bluffs", "Frankfurt am Main"];
const MACHINE_SCREENS = ["800x600", "1024x1024", "2000x2000", "1920x10000"];
const SPAM = ["considerin.net", "sunblog.asia", "osdzc.com", "sgyba.com", "giapeto.com", "alhea.com", "scirus.com", "exactseek.com", "youdao.com", "nxztkj.com"];
const TZ_CHOICES = () => [...new Set([LOCAL_TZ, "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Europe/London", "UTC"])].map((z) => [z, z.replace(/_/g, " ")]);

function freshSettings(w) {
  const city = (w.city || "").trim();
  const cityName = city.split(",")[0].trim();
  const host = (x) => x.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const sites = w.sites.map(host).filter(Boolean).map((h) => {
    const bare = h.replace(/^www\./, "");
    return { id: slugify(bare), name: bare, role: "", propertyId: "", propertyName: "", timeZoneOverride: "", hosts: [bare, `www.${bare}`], notes: [], health: {} };
  });
  return {
    version: 1, onboarded: true,
    profile: { name: w.name.trim(), pitch: w.pitch.trim(), homeCity: city },
    displayTimeZone: w.tz || LOCAL_TZ,
    sites,
    exclude: { ownPlaces: city ? [city] : [], ownScreens: [], ownHosts: ["localhost", "127.0.0.1"], ownReferrers: [], machineCities: MACHINE_CITIES, machineScreens: MACHINE_SCREENS, machinePairs: [], spamReferrers: SPAM },
    scoring: { windowDays: 60, strongHours: 2, timingHours: 24 },
    autoPullHours: 6,
    leads: { ...LEAD_DEFAULTS, titles: w.titles, seniority: w.seniority, skip: ["manager", "director", "head of", "vice president", "intern", "junior", "associate"], locations: w.locations, payFloor: Number(w.floor) || 0 }
  };
}

const W = { step: 0, name: "", city: "", tz: LOCAL_TZ, pitch: "", titles: ["product designer", "design systems"], seniority: ["principal", "staff", "lead", "senior"], locations: ["remote"], floor: "", sites: [""] };
const linesOf = (id) => $(id).value.split(/\n|,/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function welcomeSteps() {
  return [
    { title: "Welcome to Designer Job Search", body: `
      <p>Designer Job Search watches who reads your portfolio and helps you act on it.</p>
      <ul class="dash-iconlist">
        <li>${tile("pull")}<div><h3>Which applications reached a person</h3><p>It matches your website's visits to the jobs you applied to, and estimates who looked and when.</p></div></li>
        <li>${tile("warm")}<div><h3>Jobs that fit, and who to contact</h3><p>It checks companies' own job boards every day and suggests someone to reach out to about each match.</p></div></li>
        <li>${tile("eyeoff")}<div><h3>It stays on this computer</h3><p>Your data lives here. The app only reads your Google Analytics and public job boards, and never sends anything for you.</p></div></li>
      </ul>
      <p class="dash-note">Setup takes about 15 minutes. Everything here can be changed later in Settings.</p>`, next: "Get started" },
    { title: "About you", body: `
      <div class="dash-form-grid">
        ${field("w-name", "Your first name", input("w-name", W.name, "text", 'autocomplete="given-name"'), { hint: "Signs your outreach notes." })}
        ${field("w-city", "Your city and state", input("w-city", W.city, "text", 'placeholder="Springfield, Illinois"'), { hint: "Spell the state out, the way Google Analytics does. Your own visits from here are left out." })}
        ${field("w-tz", "Your time zone", select("w-tz", W.tz, TZ_CHOICES()))}
        ${field("w-pitch", "One line about your work", textarea("w-pitch", W.pitch), { span: true, hint: "Goes into your outreach notes. Example: I am a product designer who builds design systems." })}
      </div>`, read: () => { W.name = $("w-name").value; W.city = $("w-city").value; W.tz = $("w-tz").value; W.pitch = $("w-pitch").value; if (!W.name.trim()) return { "w-name": "Add your first name." }; } },
    { title: "The jobs you want", body: `
      <p class="dash-note">Used to pick job matches. One per line.</p>
      <div class="dash-form-grid">
        ${field("w-titles", "Job titles", textarea("w-titles", W.titles.join("\n")), { hint: "A job shows if its title has any of these." })}
        ${field("w-seniority", "Seniority", textarea("w-seniority", W.seniority.join("\n")), { hint: "The title must have one of these words." })}
        ${field("w-locations", "Locations that work", textarea("w-locations", (W.locations.length > 1 ? W.locations : ["remote", (W.city.split(",")[0] || "").trim().toLowerCase()].filter(Boolean)).join("\n")), { hint: "Remote, and your city if you would go in." })}
        ${field("w-floor", "Lowest yearly pay you would take", input("w-floor", W.floor, "number", 'min="0" step="1000" placeholder="Optional"'), { hint: "Posted pay under this is flagged, never hidden. Pay is never guessed." })}
      </div>`, read: () => { W.titles = linesOf("w-titles"); W.seniority = linesOf("w-seniority"); W.locations = linesOf("w-locations"); W.floor = $("w-floor").value; if (!W.titles.length) return { "w-titles": "Add at least one job title." }; } },
    { title: "Your websites", body: `
      <p>The websites you send to employers: a portfolio, a clips page, a Substack. Each needs Google Analytics on it.</p>
      ${field("w-sites", "Website addresses", textarea("w-sites", W.sites.join("\n")), { span: true, hint: "One per line. Example: yourname.com" })}`, read: () => { W.sites = $("w-sites").value.split("\n").map((x) => x.trim()).filter(Boolean); if (!W.sites.length) return { "w-sites": "Add at least one website." }; } },
    { title: "Connect Google Analytics", body: `
      <p>Last step: let the app read your Google Analytics. It takes about 10 minutes, once, and a page walks you through every click.</p>
      <ul class="dash-list">
        <li>You make a read-only "robot" login in Google Cloud and give its key to this app.</li>
        <li>After that, new visits come in on their own every few hours.</li>
        <li>Then add the jobs you applied to under <b>Applications</b>. Paste a job link and the details fill in.</li>
      </ul>`, next: "Set up Google Analytics", alt: "Explore first" }
  ];
}

function renderWelcome() {
  const steps = welcomeSteps();
  const s = steps[W.step];
  $("view-title").textContent = s.title;
  $("view-sub").textContent = `Setup, step ${W.step + 1} of ${steps.length}`;
  document.title = "Welcome · Designer Job Search";
  $("c-welcome").innerHTML = `<sdc-card><div class="dash-panel dash-welcome">
    <form id="w-form" novalidate>
      ${s.body}
      <p class="dash-status" id="w-status" role="status" aria-live="polite"></p>
      <div class="dash-dialog__actions">
        ${W.step > 0 ? '<button type="button" class="sdc-btn" id="w-back">Back</button><span class="dash-toolbar__grow"></span>' : ""}
        ${s.alt ? `<button type="button" class="sdc-btn" id="w-alt">${s.alt}</button>` : ""}
        <button type="submit" class="sdc-btn sdc-btn--primary">${s.next || "Next"}</button>
      </div>
    </form></div></sdc-card>`;
  const form = $("w-form");
  const go = async (dest) => {
    S.settings = freshSettings(W);
    await save("settings", S.settings);
    document.body.classList.remove("is-welcome");
    location.hash = dest;
    start();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    form.querySelectorAll(".sdc-field__error").forEach((p) => { p.hidden = true; });
    const errors = s.read ? s.read() : null;
    if (errors) { for (const [id, msg] of Object.entries(errors)) { const p = $(`${id}-err`); if (p) { p.textContent = msg; p.hidden = false; } $(id).focus(); } return; }
    if (W.step < steps.length - 1) { W.step++; renderWelcome(); $("view-title").focus(); }
    else await go("#settings?go=google");
  };
  if ($("w-back")) $("w-back").onclick = () => { if (s.read) s.read(); W.step--; renderWelcome(); $("view-title").focus(); };
  if ($("w-alt")) $("w-alt").onclick = () => go("#overview");
  const first = form.querySelector("input, textarea");
  if (first && W.step > 0) first.focus();
}

/* ---------- Boot ---------- */

function renderAll() {
  renderNav(); renderTop(); renderOverview(); renderPull(); renderLatest(); renderConclusions();
  renderReading(); renderHealth(); renderLeads(); renderApps(); renderTouches(); renderSettings();
  show(false);
}

async function boot() {
  try { const t = localStorage.getItem("dash-theme"); if (t) setTheme(t); } catch (e) { /* private mode */ }
  try {
    S = await loadAll();
    G = await api("/api/google/status");
  } catch (err) {
    $("boot").textContent = "The app server is not running. In Terminal: cd to this folder and run node server.mjs, then reload.";
    return;
  }
  $("boot").remove();
  useFontKit(S.settings && S.settings.fontKit);
  $("theme-toggle").onclick = () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  if (!S.settings || !S.settings.onboarded) {
    document.body.classList.add("is-welcome");
    document.querySelectorAll(".dash-view").forEach((v) => { v.hidden = v.getAttribute("data-view") !== "welcome"; });
    renderWelcome();
    return;
  }
  start();
}

let started = false;
async function start() {
  await loadProps();
  let saved = null; try { saved = localStorage.getItem("dash-collapsed"); } catch (e) { /* private mode */ }
  setCollapsed(narrow.matches || saved === "1", false);
  if (currentView() === "pull") applyPullParams();
  renderAll();
  if (currentView() === "settings") goToSetting();

  if (started) return;
  started = true;
  $("collapse").onclick = () => setCollapsed($("shell").getAttribute("data-collapsed") !== "true", true);
  narrow.addEventListener("change", (e) => { if (e.matches) setCollapsed(true, false); });
  $("refresh").onclick = refresh;
  window.addEventListener("hashchange", () => {
    if (currentView() === "settings") { show(true); renderSettings(); goToSetting(); return; }
    if (currentView() === "pull") { applyPullParams(); show(!focusRead); renderPull(); return; }
    show(true);
  });
  $("filters").onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filterOdds = b.dataset.f; focusRead = ""; paging.pull = 0; renderPull(); $("filters").querySelector(`[data-f="${filterOdds}"]`).focus(); };
  $("leads-check").onclick = checkLeadsNow;
  document.body.addEventListener("click", async (e) => {
    const la = e.target.closest("[data-lead-apply]");
    if (la) { const j = leadById(la.dataset.leadApply); if (j) editApp(null, { jobUrl: j.url, company: j.company, role: j.title, req: j.req || "", places: String(j.location || "").split(/;\s*/).filter(Boolean), ats: j.boardType || "" }); return; }
    const lr = e.target.closest("[data-lead-reach]");
    if (lr) { reachOut(lr.dataset.leadReach); return; }
    const lh = e.target.closest("[data-lead-hide]");
    if (lh) {
      const h = new Set(S.leads.hidden || []);
      if (h.has(lh.dataset.leadHide)) h.delete(lh.dataset.leadHide); else h.add(lh.dataset.leadHide);
      S.leads.hidden = [...h];
      await save("leads", S.leads);
      renderNav(); renderLeads();
      return;
    }
    const m = e.target.closest("[data-edit-match]"); if (m) return editMatch(m.dataset.editMatch);
    const a = e.target.closest("[data-edit-app]"); if (a) return editApp(a.dataset.editApp);
    const t = e.target.closest("[data-edit-touch]"); if (t) return editTouch(t.dataset.editTouch);
  });
  $("app-add").onclick = () => editApp(null);
  $("app-import").onclick = importApps;
  $("touch-add").onclick = () => editTouch(null);
  $("app-search").oninput = () => { paging.apps = 0; renderApps(); };
  $("touch-search").oninput = () => { paging.touches = 0; renderTouches(); };

  // Pick up automatic pulls while the page is open.
  setInterval(async () => {
    const before = (lastPull() || {}).id;
    const pulls = await fetch("/api/store/pulls", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (pulls && pulls.length && pulls[pulls.length - 1].id !== before) { S = await loadAll(); renderAll(); }
  }, 5 * 60 * 1000);
}

boot();
