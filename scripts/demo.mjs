// Runs Site Analytics on made-up data, so you can look around before connecting anything.
//   node scripts/demo.mjs           demo data at http://localhost:4341/
//   node scripts/demo.mjs --empty   a fresh install, to see the first-run setup
//   node scripts/demo.mjs --write   only write the demo data to demo/store, then stop
// Every person, company and website here is invented. Websites use the reserved .example
// domain. The demo never reads Google Analytics or job boards, and your own data in store/ is
// never touched. Dates are counted back from today, so the demo always looks current.
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { companyKey } from "../js/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EMPTY = process.argv.includes("--empty");
const STORE = join(ROOT, "demo", EMPTY ? "empty-store" : "store");
const CONFIG = join(ROOT, "demo", "config");
const PORT = process.env.PORT || "4341";

/* ---------- Dates, counted back from today ---------- */
const NOW = Date.now();
const DAY = 24 * 3600 * 1000;
const day = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const at = (n, hhmm) => `${day(n)}T${hhmm}`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------- Who the demo is for ---------- */
const CONNECT_NOTE = "Hi {first}, I saw the {role} role at {company}. {pitch} I would be glad to connect. Thanks, {me}";
const MESSAGE_NOTE = "Hi {first},\n\nI saw the {role} role at {company} and wanted to reach out directly. {pitch}\n\nWould you be open to a short conversation, or could you point me to the person hiring for this role?\n\nThanks,\n{me}";

const settings = {
  version: 1, onboarded: true,
  profile: { name: "Alex", pitch: "I design payments products and the design systems behind them.", homeCity: "Portland, Oregon" },
  displayTimeZone: "America/Los_Angeles",
  sites: [
    { id: "alexrivera-example", name: "alexrivera.example", role: "Portfolio, for hiring managers", propertyId: "100000001", propertyName: "alexrivera.example", timeZoneOverride: "", hosts: ["alexrivera.example", "www.alexrivera.example"], notes: [], health: { timeZone: "America/Los_Angeles", retention: "TWO_MONTHS", name: "alexrivera.example", checkedAt: new Date(NOW - 3600 * 1000).toISOString() } },
    { id: "riverastudio-example", name: "riverastudio.example", role: "Freelance studio site", propertyId: "", propertyName: "", timeZoneOverride: "", hosts: ["riverastudio.example", "www.riverastudio.example"], notes: [], health: {} }
  ],
  exclude: {
    ownPlaces: ["Portland, Oregon"], ownScreens: [], ownHosts: ["localhost", "127.0.0.1"], ownReferrers: [],
    machineCities: ["Ashburn", "Boardman", "Des Moines", "Moses Lake", "North Charleston", "Reston", "Manassas", "Flint Hill", "Council Bluffs", "Frankfurt am Main"],
    machineScreens: ["800x600", "1024x1024", "2000x2000", "1920x10000"], machinePairs: [],
    spamReferrers: ["considerin.net", "sunblog.asia", "osdzc.com"]
  },
  scoring: { windowDays: 60, strongHours: 2, timingHours: 24 },
  autoPullHours: 6,
  leads: {
    titles: ["product designer", "design systems"], seniority: ["principal", "staff", "lead", "senior"],
    skip: ["manager", "director", "head of", "vice president", "intern", "junior", "associate"],
    locations: ["remote", "portland"], payFloor: 160000, postedWithinDays: 0, minWarmth: 2, extraBoards: [],
    connectNote: CONNECT_NOTE, messageNote: MESSAGE_NOTE
  }
};

/* ---------- Applications ---------- */
// [company, role, ats, places, days ago, status, req]
const BOARD = { greenhouse: "job-boards.greenhouse.example", lever: "jobs.lever.example", ashby: "jobs.ashby.example", workday: "careers.workday.example", smartrecruiters: "jobs.smartrecruiters.example", other: "careers.example" };
const A = [
  ["Northwind Payments", "Staff Product Designer, Checkout", "greenhouse", ["Seattle, Washington", "Remote"], 4, "interviewing", "4471002"],
  ["Woodgrove Bank", "Lead Product Designer, Digital Banking", "workday", ["New York, New York"], 6, "submitted", "R-20418"],
  ["Fabrikam Cloud", "Principal Product Designer, Billing", "ashby", ["Remote"], 9, "submitted", ""],
  ["Contoso Health", "Senior Product Designer, Patient Payments", "lever", ["Boston, Massachusetts", "Remote"], 11, "submitted", ""],
  ["Tailspin Travel", "Senior Product Designer, Booking", "greenhouse", ["Denver, Colorado"], 13, "rejected", "88120"],
  ["Litware Labs", "Design Systems Lead", "smartrecruiters", ["Austin, Texas", "Remote"], 15, "submitted", ""],
  ["Relecloud", "Staff Product Designer, Design Systems", "ashby", ["Remote"], 18, "interviewing", ""],
  ["Proseware", "Senior Product Designer, Merchant Tools", "lever", ["San Francisco, California"], 20, "rejected", ""],
  ["Lucerne Publishing", "Lead Product Designer", "workday", ["Chicago, Illinois", "Remote"], 23, "closed", "JR1192"],
  ["Adatum", "Senior Product Designer, Payments", "greenhouse", ["Remote"], 26, "submitted", "5520031"],
  ["Coho Logistics", "Product Designer, Shipping", "other", ["Atlanta, Georgia"], 28, "rejected", ""],
  ["Trey Research", "Principal Designer, Data Products", "lever", ["Minneapolis, Minnesota", "Remote"], 31, "submitted", ""],
  ["Wingtip Toys", "Senior UX Designer, Checkout", "smartrecruiters", ["Los Angeles, California"], 34, "rejected", ""],
  ["Fourth Coffee", "Lead Product Designer, Loyalty", "greenhouse", ["Portland, Oregon"], 37, "submitted", "3301877"],
  ["Lamna Healthcare", "Staff Product Designer", "workday", ["Detroit, Michigan"], 40, "closed", "R-7710"],
  ["Margie's Travel", "Senior Product Designer", "ashby", ["Remote"], 44, "rejected", ""],
  ["Alpine Outfitters", "Product Design Lead, Ecommerce", "other", ["Portland, Oregon"], 47, "submitted", ""],
  ["Humongous Insurance", "Senior Product Designer, Claims", "workday", ["Indianapolis, Indiana"], 52, "rejected", "R-30551"]
];
const applications = A.map(([company, role, ats, places, ago, status, req]) => ({
  id: slug(`${company}-${role}`).slice(0, 60), company, role, req, submitted: day(ago), submittedTime: ago % 3 ? `${8 + (ago % 9)}:${ago % 2 ? "15" : "40"}` : "",
  jobUrl: `https://${BOARD[ats]}/${slug(company)}/jobs/${1000 + ago}`, ats, places, status,
  statusDate: status === "submitted" ? "" : day(Math.max(0, ago - 3)), notes: ""
}));
const app = (company) => applications.find((a) => a.company === company);

/* ---------- Contacts ---------- */
// [days ago, time, company, person, kind, application company, notes]
const T = [
  [0, "09:20", "Northwind Payments", "Jordan Ellis", "call", "Northwind Payments", "Recruiter screen, 30 minutes. Next is the hiring manager."],
  [4, "15:05", "Northwind Payments", "Jordan Ellis", "message-in", "Northwind Payments", "Asked for a time to talk"],
  [2, "11:30", "Relecloud", "Priya Raman", "interview", "Relecloud", "Portfolio review with the head of design"],
  [9, "13:10", "Relecloud", "Priya Raman", "profile-view", "", ""],
  [5, "10:45", "Fabrikam Cloud", "Maya Chen", "message-in", "Fabrikam Cloud", "Design manager. Said the billing team is hiring two."],
  [6, "16:20", "Woodgrove Bank", "", "email-in", "Woodgrove Bank", "Application received, automated"],
  [10, "08:55", "Contoso Health", "Dana Whitfield", "email-out", "Contoso Health", "Sent a note to the recruiter"],
  [12, "14:00", "Litware Labs", "Chris Novak", "connection", "", "Connection request with a note"],
  [11, "09:40", "Tailspin Travel", "", "rejection", "Tailspin Travel", "Form letter"],
  [17, "12:15", "Proseware", "", "rejection", "Proseware", "Form letter"],
  [19, "10:05", "Bridgeline Staffing", "Taylor Brooks", "call", "", "Agency recruiter. Contract roles in payments."],
  [22, "15:35", "Lucerne Publishing", "Riley Park", "referral", "Lucerne Publishing", "Former coworker referred me"],
  [24, "09:10", "Adatum", "Sam Okafor", "message-out", "Adatum", "Asked about the team"],
  [27, "11:50", "Fourth Coffee", "Morgan Hale", "profile-view", "", ""],
  [30, "13:25", "Trey Research", "Avery Quinn", "email-in", "Trey Research", "Recruiter asked for salary range"],
  [33, "10:30", "Wingtip Toys", "", "rejection", "Wingtip Toys", "Form letter"],
  [38, "16:45", "Lamna Healthcare", "Jamie Ross", "call", "Lamna Healthcare", "Phone screen"],
  [43, "09:00", "Margie's Travel", "", "rejection", "Margie's Travel", "Form letter"],
  [50, "14:20", "Humongous Insurance", "", "rejection", "Humongous Insurance", "Form letter"]
];
const touches = T.map(([ago, time, company, person, kind, appCo, notes]) => ({
  id: slug(`${day(ago)}-${company}-${person || kind}`), at: at(ago, time), company, person, kind,
  applicationId: appCo ? app(appCo).id : "", places: [], notes
}));

/* ---------- Readers the app matched ---------- */
const jd = (company) => { const a = app(company); return a ? [{ m: `${a.company}, ${a.role}`, u: a.jobUrl }] : []; };
const appText = (company, extra = "") => { const a = app(company); return a ? `${a.company}, ${a.role}${extra}` : company; };
// [days ago, hours, place, screen, referrer, channel, pages, resume, odds, who, application company, lag, note, status]
const M = [
  [0, "10 AM", "Seattle, Washington", "1512x982", "direct", "recruiter", ["home", "checkout-redesign", "design-system"], true, "high", "Northwind's recruiter, likely Jordan Ellis", "Northwind Payments", "About 40 minutes after the recruiter call", "Read the checkout case study first, then downloaded the resume.", "estimated"],
  [1, "2 PM", "San Francisco, California", "1728x1117", "chatgpt.com", "ai", ["home", "design-system"], false, "low", "Someone who asked an AI assistant", "", "n/a", "Arrived from ChatGPT. No application in the Bay Area is open.", "estimated"],
  [2, "11 AM, 12 PM", "Austin, Texas", "1440x900", "greenhouse.example", "ats", ["home", "design-system", "about"], false, "medium", "A Litware Labs reviewer, or a recruiter", "Litware Labs", "Two weeks after applying", "Came from inside an applicant system. Litware is the only open application in Austin.", "estimated"],
  [3, "9 AM", "Not shown", "1920x1080", "ashby.example", "ats", ["home", "design-system", "merchant-dashboard"], true, "high", "Relecloud's design team", "Relecloud", "The morning after the portfolio review", "Ashby passed the referrer. Relecloud is the only Ashby application in review.", "reviewed"],
  [5, "11 AM", "New York, New York", "1366x768", "workday.example", "ats", ["home", "checkout-redesign"], false, "high", "A Woodgrove Bank reviewer", "Woodgrove Bank", "Same hour as the automated reply", "Workday passed the referrer, from New York.", "reviewed"],
  [6, "4 PM", "Boston, Massachusetts", "1280x800", "linkedin.com", "linkedin", ["home", "about"], false, "medium", "Possibly Dana Whitfield at Contoso Health", "Contoso Health", "Four days after the note", "Came from LinkedIn in Boston. Contoso is the only Boston application.", "reviewed"],
  [8, "1 PM", "Beaverton, Oregon", "390x844", "google", "search", ["home"], false, "low", "Unknown Portland-area reader", "", "n/a", "Searched by name on a phone.", "reviewed"],
  [9, "10 AM", "Denver, Colorado", "1920x1080", "direct", "direct", ["home", "checkout-redesign"], true, "medium", "A Tailspin Travel reviewer", "Tailspin Travel", "Two days before the rejection", "Denver, and the resume was downloaded. Tailspin said no two days later.", "reviewed"],
  [12, "3 PM", "Minneapolis, Minnesota", "1536x864", "direct", "direct", ["home", "design-system"], false, "low", "Unknown Minneapolis reader", "Maybe Trey Research", "n/a", "Trey Research is in Minneapolis, but nothing on file lines up in time.", "reviewed"],
  [14, "9 AM, 11 AM", "Chicago, Illinois", "1440x900", "direct", "recruiter", ["home", "merchant-dashboard", "checkout-redesign"], false, "high", "Lucerne Publishing, after Riley's referral", "Lucerne Publishing", "Within the hour of the referral", "Two visits the morning after the referral.", "reviewed"],
  [16, "7 PM", "Atlanta, Georgia", "414x896", "linkedin.com", "linkedin", ["home"], false, "low", "Unknown Atlanta reader", "", "n/a", "LinkedIn on a phone, home page only.", "reviewed"],
  [19, "2 PM", "Los Angeles, California", "1680x1050", "smartrecruiters.example", "ats", ["home", "checkout-redesign"], false, "medium", "A Wingtip Toys reviewer", "Wingtip Toys", "Two weeks after applying", "SmartRecruiters passed the referrer.", "reviewed"],
  [21, "10 AM", "Lake Oswego, Oregon", "1920x1080", "riverastudio.example", "referral", ["home", "about"], false, "low", "Someone from the studio site", "", "n/a", "Clicked through from the freelance site.", "reviewed"],
  [23, "11 AM", "Detroit, Michigan", "1280x720", "direct", "recruiter", ["home", "design-system"], true, "high", "Lamna Healthcare, after the phone screen", "Lamna Healthcare", "The day after the phone screen", "Downloaded the resume. Lamna is the only Detroit application.", "reviewed"],
  [26, "4 PM", "Indianapolis, Indiana", "1366x768", "direct", "direct", ["home"], false, "low", "Unknown Indianapolis reader", "Maybe Humongous Insurance", "n/a", "Home page only, two weeks before the rejection.", "reviewed"],
  [29, "9 AM", "Seattle, Washington", "1920x1200", "linkedin.com", "linkedin", ["home", "about"], false, "low", "Unknown Seattle reader", "", "n/a", "Before the Northwind application, so not counted toward it.", "reviewed"],
  [33, "1 PM", "Brooklyn, New York", "1440x900", "google", "search", ["home", "checkout-redesign"], false, "low", "Unknown New York reader", "", "n/a", "Searched for a case study topic.", "reviewed"],
  [36, "10 AM", "Hillsboro, Oregon", "1920x1080", "direct", "recruiter", ["home"], true, "person", "Taylor Brooks at Bridgeline Staffing", "No application, an agency contact", "Two weeks after the call", "A contact, not an application.", "reviewed"],
  [41, "3 PM", "Cambridge, Massachusetts", "1512x982", "perplexity.ai", "ai", ["home", "design-system"], false, "low", "Someone who asked an AI assistant", "", "n/a", "Arrived from Perplexity.", "reviewed"],
  [47, "11 AM", "Minneapolis, Minnesota", "1440x900", "direct", "direct", ["home", "merchant-dashboard"], false, "medium", "A Trey Research reviewer", "Trey Research", "Hours after the recruiter email", "Minneapolis, the same afternoon as the email.", "reviewed"]
];
const AGO = new Map();
const matches = M.map(([ago, hours, place, screen, referrer, channel, pages, resume, odds, who, co, lag, note, status]) => {
  const city = place === "Not shown" ? "" : place.split(",")[0];
  const d = day(ago);
  AGO.set(`${d}-${slug(city || "unplaced")}-${screen}`, ago);
  return {
    id: `${d}-${slug(city || "unplaced")}-${screen}`, status, date: d, visits: [[d, hours]], place, city, screen,
    readerKey: `${city.toLowerCase()}|${screen}`, device: `${/^(390|414)x/.test(screen) ? "Mobile" : "Desktop"} ${screen}`,
    referrer, channel, pages, resume, clicks: [], confidence: odds, who,
    application: co && app(co) ? appText(co) : co || "Nothing on file", jd: co && app(co) ? jd(co) : [], lag, note
  };
});
const ids = (...agos) => matches.filter((m) => agos.includes(AGO.get(m.id))).map((m) => m.id);
const countOf = (list) => ({
  high: list.filter((m) => m.confidence === "high").length, medium: list.filter((m) => m.confidence === "medium").length,
  low: list.filter((m) => m.confidence === "low").length, resume: list.filter((m) => m.resume).length,
  ats: new Set(list.filter((m) => m.channel === "ats").map((m) => m.referrer)).size
});
const upTo = (ago) => matches.filter((m) => AGO.get(m.id) >= ago);

/* ---------- Pulls ---------- */
const pull = (agoHours, source, start, newIds, extra = {}) => {
  const when = new Date(NOW - agoHours * 3600 * 1000);
  const iso = when.toISOString();
  return {
    id: `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}`, at: iso, source,
    range: { start: day(start), end: iso.slice(0, 10) }, sites: ["alexrivera-example"],
    events: 60 + newIds.length * 22, pageViews: 18 + newIds.length * 7, firstVisits: 6 + newIds.length * 2,
    readers: newIds.length + 3, realReaders: newIds.length, thin: 2,
    filtered: { own: 9, machine: 14, spam: 1, "other-host": 0 },
    ai: 0, aiVisits: [], newMatches: newIds, updatedMatches: [], counts: countOf(upTo(Math.floor(agoHours / 24))), ...extra
  };
};
const pulls = [
  pull(24 * 30, "Automatic pull", 60, ids(33, 36, 41, 47)),
  pull(24 * 15, "Automatic pull", 33, ids(14, 16, 19, 21, 23, 26, 29)),
  pull(24 * 7 + 5, "Automatic pull", 18, ids(8, 9, 12)),
  pull(24 * 3 + 2, "Refresh button", 10, ids(3, 5, 6), {}),
  pull(1, "Automatic pull", 6, ids(0, 1, 2), { ai: 1, aiVisits: [{ referrer: "chatgpt.com", date: day(1) }] })
];
pulls[pulls.length - 1].updatedMatches = ids(3);

/* ---------- Notes ---------- */
const notes = {
  written: day(2),
  conclusions: [
    { icon: "signal", title: "A visit usually means someone has your file open", text: "Four of the five high odds reads came within a day of a call, a referral or an automated reply." },
    { icon: "users", title: "People bring readers. Cold applications rarely do.", text: "Reads after a recruiter call or a referral outnumber reads after a plain application, three to one." },
    { icon: "book", title: "The checkout case study does the work", text: "Most readers who go past the home page open the checkout redesign first." },
    { icon: "sparkle", title: "AI assistants have started sending readers", text: "Two visits arrived from AI assistants this month, both landing on the design system page." },
    { icon: "eyeoff", title: "No reads from the San Francisco application", text: "Proseware never sent a reader before the rejection." }
  ],
  steps: [],
  silences: ["No visit from San Francisco near the Proseware application.", "No referrer has come from a Lever applicant system yet.", "No reader from Atlanta near the Coho Logistics application."]
};

/* ---------- Job matches ---------- */
// [company, title, board type, location, posted days ago, pay or null]
const J = [
  ["Northwind Payments", "Principal Product Designer, Payments Platform", "greenhouse", "Remote, United States", 2, [185000, 225000]],
  ["Fabrikam Cloud", "Staff Product Designer, Billing Experience", "ashby", "Remote", 3, [175000, 210000]],
  ["Relecloud", "Senior Product Designer, Design Systems", "ashby", "Remote", 5, [165000, 190000]],
  ["Fourth Coffee", "Senior Product Designer, Mobile Ordering", "greenhouse", "Portland, Oregon", 6, [140000, 155000]],
  ["Litware Labs", "Staff Product Designer, Developer Tools", "smartrecruiters", "Austin, Texas; Remote", 8, null],
  ["Adatum", "Lead Product Designer, Risk", "greenhouse", "Remote", 9, [170000, 200000]],
  ["Trey Research", "Principal Product Designer, Analytics", "lever", "Minneapolis, Minnesota; Remote", 12, [190000, 230000]],
  ["Alpine Outfitters", "Senior Product Designer, Checkout", "other", "Portland, Oregon", 14, null],
  ["Woodgrove Bank", "Lead Product Designer, Design Systems", "workday", "Remote", 16, null],
  ["Contoso Health", "Senior Product Designer, Care Navigation", "lever", "Remote", 20, [150000, 175000]],
  ["Lucerne Publishing", "Staff Product Designer, Subscriptions", "workday", "Remote", 25, null],
  ["Coho Logistics", "Senior Product Designer, Carrier Tools", "greenhouse", "Atlanta, Georgia", 4, [150000, 170000]],
  ["Northwind Payments", "Design Manager, Merchant Experience", "greenhouse", "Remote", 3, [210000, 250000]],
  ["Tailspin Travel", "Junior Product Designer", "greenhouse", "Denver, Colorado", 2, [90000, 110000]]
];
const jobs = J.map(([company, title, type, location, ago, pay], i) => ({
  id: `${type}:${slug(company)}:${5000 + i}`, title, url: `https://${BOARD[type]}/${slug(company)}/jobs/${5000 + i}`,
  location, posted: day(ago), pay: pay ? { min: pay[0], max: pay[1] } : null,
  company, companyKey: companyKey(company), boardType: type,
  firstSeen: new Date(NOW - Math.min(ago, i < 3 ? 0.5 : ago) * DAY).toISOString()
}));
// One the demo already applied to, so the page shows that applied jobs are left out.
jobs.push({ id: "greenhouse:northwind-payments:4471002", title: "Staff Product Designer, Checkout", url: app("Northwind Payments").jobUrl, location: "Seattle, Washington; Remote", posted: day(10), pay: { min: 180000, max: 215000 }, company: "Northwind Payments", companyKey: companyKey("Northwind Payments"), boardType: "greenhouse", firstSeen: new Date(NOW - 10 * DAY).toISOString() });
const leads = { checkedAt: new Date(NOW - 2 * 3600 * 1000).toISOString(), companies: 14, withoutBoard: [companyKey("Bridgeline Staffing")], jobs, errors: [], hidden: [] };

/* ---------- Write and run ---------- */
async function writeStore() {
  await rm(STORE, { recursive: true, force: true });
  await mkdir(STORE, { recursive: true, mode: 0o700 });
  await mkdir(CONFIG, { recursive: true, mode: 0o700 });
  if (EMPTY) return;
  const files = { settings, matches, notes, pulls, applications, touches, leads };
  for (const [name, data] of Object.entries(files)) await writeFile(join(STORE, `${name}.json`), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

await writeStore();
if (process.argv.includes("--write")) {
  console.log(`Demo data written to ${STORE}`);
} else {
  console.log(EMPTY ? "Starting a fresh install (nothing saved yet)." : "Starting the demo. Everything in it is made up.");
  const child = spawn(process.execPath, [join(ROOT, "server.mjs")], { stdio: "inherit", env: { ...process.env, PORT, SA_STORE: STORE, SA_CONFIG: CONFIG, SA_DEMO: EMPTY ? "" : "1" } });
  child.on("exit", (code) => process.exit(code || 0));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
}
