// Reads and writes the app's data through the local server (server.mjs keeps it in ./store).

const DEFAULTS = {
  settings: null, matches: [], notes: { conclusions: [], steps: [], silences: [] },
  pulls: [], applications: [], touches: [], leads: null
};

export async function loadAll() {
  const out = {};
  await Promise.all(Object.keys(DEFAULTS).map(async (name) => {
    const res = await fetch(`/api/store/${name}`, { cache: "no-store" });
    out[name] = res.ok ? await res.json() : structuredClone(DEFAULTS[name]);
  }));
  return out;
}

export async function save(name, data) {
  const res = await fetch(`/api/store/${name}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Site-Analytics": "1" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`Could not save ${name}: ${(await res.json().catch(() => ({}))).error || res.statusText}`);
}

// JSON helpers for the server's other endpoints.
export async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method, cache: "no-store",
    // The custom header marks the request as coming from this app's own page; the server refuses changes without it.
    headers: body !== undefined ? { "Content-Type": "application/json", "X-Site-Analytics": "1" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { needsConnect: !!json.needsConnect });
  return json;
}
