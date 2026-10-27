// One analytics pull: read GA4 for every connected site since the last pull, drop the owner's
// own visits and machines, group visits into readers, score each reader against applications
// and contacts, fold the result into the stored matches, and record the pull.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildVisits, dropReason, groupReaders, isRealReader, scoreReader, readerToMatch, mergeMatches, countsOf, partsIn } from "../js/engine.js";

const DAY = 24 * 3600 * 1000;

export function createPuller(storeDir, google) {
  const file = (n) => join(storeDir, `${n}.json`);
  const read = async (n, fallback) => { try { return JSON.parse(await readFile(file(n), "utf8")); } catch { return fallback; } };
  const write = async (n, data) => {
    await mkdir(storeDir, { recursive: true, mode: 0o700 });
    const tmp = `${file(n)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, file(n));
  };

  let running = null;

  async function pull(reason = "button") {
    if (running) return running; // one pull at a time; a second click joins the first
    running = doPull(reason).finally(() => { running = null; });
    return running;
  }

  async function doPull(reason) {
    const settings = await read("settings", null);
    if (!settings) throw new Error("Settings are missing.");
    const [matches, pulls, applications, touches] = await Promise.all([read("matches", []), read("pulls", []), read("applications", []), read("touches", [])]);
    const displayTz = settings.displayTimeZone || "UTC";
    const sites = (settings.sites || []).filter((s) => s.propertyId);
    if (!sites.length) throw new Error("No website has a Google Analytics property yet. Pick one in Settings.");

    const last = pulls[pulls.length - 1];
    const now = Date.now();
    const today = partsIn(displayTz, now).date;
    // GA4 can take a day or two to finish processing visits, so each pull re-reads the three days
    // before the last one ended; readers seen twice merge by device, so nothing is counted twice.
    // GA4 keeps about two months, so never ask for more than 60 days.
    const floor = partsIn(displayTz, now - 60 * DAY).date;
    const overlap = last && last.range ? partsIn(displayTz, Date.parse(`${last.range.end}T12:00:00Z`) - 3 * DAY).date : floor;
    const start = overlap > floor ? overlap : floor;
    const pullId = new Date(now).toISOString().slice(0, 16).replace(":", "");

    const kept = [];
    const filtered = { own: 0, machine: 0, spam: 0, "other-host": 0 };
    const totals = { events: 0, pageViews: 0, firstVisits: 0 };
    const raw = {};
    for (const site of sites) {
      const health = await google.propertyHealth(site.propertyId);
      site.health = health;
      if (!site.propertyName) site.propertyName = health.name;
      const tz = site.timeZoneOverride || health.timeZone || "UTC";
      const data = await google.pullProperty(site.propertyId, start, "today");
      raw[site.id] = data;
      for (const k of Object.keys(totals)) totals[k] += data.totals[k];
      for (const v of buildVisits(data, tz, displayTz, site.id)) {
        const why = dropReason(v, settings.exclude, site.hosts);
        if (why) filtered[why] = (filtered[why] || 0) + 1;
        else kept.push(v);
      }
    }

    const readers = groupReaders(kept);
    // Score every reader; keep the ones who read more than the home page, plus any thin visit
    // that still lines up with an application (a reviewer can open the home page and stop).
    const scored = readers.map((r) => ({ r, s: scoreReader(r, applications, touches, settings) }));
    const keep = scored.filter(({ r, s }) => isRealReader(r) || s.confidence !== "low");
    const real = keep.map(({ r }) => r);
    const incoming = keep.map(({ r, s }) => readerToMatch(r, s, pullId));
    const merged = mergeMatches(matches, incoming);

    // AI assistant visits, deduped across pulls by day, city and screen.
    const aiKeys = new Set(pulls.flatMap((p) => p.aiVisits || []));
    const aiNew = [];
    for (const v of kept) if (v.sources.some((s) => s.channel === "ai")) {
      const k = `${v.date}|${String(v.city).toLowerCase()}|${v.screen}`;
      if (!aiKeys.has(k)) { aiKeys.add(k); aiNew.push(k); }
    }

    const record = {
      id: pullId,
      at: new Date(now).toISOString(),
      source: reason === "schedule" ? "Automatic pull" : "Refresh button",
      range: { start, end: today },
      sites: sites.map((s) => s.id),
      ...totals,
      readers: readers.length,
      realReaders: real.length,
      thin: readers.length - real.length,
      filtered,
      ai: aiNew.length,
      aiVisits: aiNew,
      newMatches: merged.added,
      updatedMatches: merged.updated,
      counts: countsOf(merged.matches)
    };

    await mkdir(join(storeDir, "raw"), { recursive: true, mode: 0o700 });
    await writeFile(join(storeDir, "raw", `${pullId}.json`), JSON.stringify({ start, end: today, raw }) + "\n", { mode: 0o600 });
    await write("matches", merged.matches);
    await write("pulls", [...pulls, record]);
    await write("settings", settings);
    return record;
  }

  // True when the last pull is older than the setting, so the scheduler should run one.
  async function due() {
    const settings = await read("settings", null);
    const hours = (settings && settings.autoPullHours) || 6;
    const pulls = await read("pulls", []);
    const last = pulls[pulls.length - 1];
    return !last || Date.now() - Date.parse(last.at) >= hours * 3600 * 1000;
  }

  return { pull, due, isRunning: () => !!running };
}
