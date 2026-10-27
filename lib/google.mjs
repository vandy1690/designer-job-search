// Google Analytics connection, run by the local server so pulls can happen on their own.
// Main way: a service account ("robot account") whose key file is uploaded in Settings and whose
// email is added as a Viewer on each GA4 property. It never expires and needs nothing published.
// Fallback: a Google sign-in with an OAuth "Desktop app" client, kept as a refresh token.
// Keys and tokens live in ./config, which the server never serves and git ignores.
import { readFile, writeFile, mkdir, chmod, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, createHash, createSign } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

export function createGoogle(configDir, redirectUri) {
  const clientFile = join(configDir, "google-client.json");
  const tokenFile = join(configDir, "google-token.json");
  // A service account ("robot" account) is the simplest way for one person to connect their own
  // Analytics: no sign-in screen, nothing to publish, and it never expires.
  const serviceFile = join(configDir, "google-service-account.json");
  const pendingStates = new Map(); // state -> { verifier, at }
  let access = null; // { value, expires }

  const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
  const writeSecret = async (f, data) => {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await chmod(configDir, 0o700);
    await writeFile(f, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await chmod(f, 0o600);
  };
  const client = async () => { try { return await readJson(clientFile); } catch { return null; } };
  const stored = async () => { try { return await readJson(tokenFile); } catch { return null; } };
  const service = async () => { try { return await readJson(serviceFile); } catch { return null; } };

  async function status() {
    const c = await client();
    const t = await stored();
    const sa = await service();
    if (sa) return { mode: "service", connected: true, serviceEmail: sa.client_email, connectedAt: sa.savedAt || "", hasClient: !!(c && c.clientId), clientId: c ? c.clientId : "" };
    return { mode: t && t.refreshToken ? "oauth" : "", hasClient: !!(c && c.clientId && c.clientSecret), clientId: c ? c.clientId : "", connected: !!(t && t.refreshToken), connectedAt: t ? t.connectedAt : "", serviceEmail: "" };
  }

  // Saves the key file Google downloads for a service account. Only the parts needed to sign in are kept.
  async function setServiceAccount(key) {
    if (!key || key.type !== "service_account" || typeof key.client_email !== "string" || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(key.client_email) || typeof key.private_key !== "string" || !key.private_key.includes("PRIVATE KEY")) throw new Error("That file is not a Google service account key. It should be the .json file Google downloaded when you clicked Create new key.");
    await writeSecret(serviceFile, { type: key.type, client_email: key.client_email, private_key: key.private_key, private_key_id: key.private_key_id || "", project_id: key.project_id || "", savedAt: new Date().toISOString() });
    access = null;
    return status();
  }

  async function serviceToken(sa) {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT", kid: sa.private_key_id || undefined })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: TOKEN, iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
    const res = await fetch(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error_description || j.error || "Google did not accept the service account key.");
    access = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
    return access.value;
  }

  // Set by the person who registered the OAuth client. The secret is write-only from the page.
  async function setClient({ clientId, clientSecret }) {
    const prev = (await client()) || {};
    const next = { clientId: String(clientId || prev.clientId || "").trim(), clientSecret: String(clientSecret || prev.clientSecret || "").trim() };
    if (!next.clientId.endsWith(".apps.googleusercontent.com")) throw new Error("That does not look like a Google OAuth client ID. It ends in .apps.googleusercontent.com.");
    if (!next.clientSecret) throw new Error("The client secret is missing.");
    await writeSecret(clientFile, next);
    return status();
  }

  async function authUrl() {
    const c = await client();
    if (!c) throw new Error("The Google OAuth client is not set up yet.");
    const state = randomBytes(16).toString("hex");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    pendingStates.set(state, { verifier, at: Date.now() });
    for (const [k, v] of pendingStates) if (Date.now() - v.at > 15 * 60 * 1000) pendingStates.delete(k);
    const q = new URLSearchParams({
      client_id: c.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "true",
      state, code_challenge: challenge, code_challenge_method: "S256"
    });
    return `${AUTH}?${q}`;
  }

  async function finish(params) {
    if (params.get("error")) throw new Error(`Google said: ${params.get("error")}`);
    const state = params.get("state");
    const pending = pendingStates.get(state);
    if (!pending) throw new Error("This sign-in link expired. Start again from Settings.");
    pendingStates.delete(state);
    const c = await client();
    const res = await fetch(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: params.get("code"), client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: pending.verifier })
    });
    const j = await res.json();
    if (!res.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "Google did not return a refresh token.");
    await writeSecret(tokenFile, { refreshToken: j.refresh_token, scope: j.scope, connectedAt: new Date().toISOString() });
    access = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  }

  async function token() {
    if (access && access.expires > Date.now()) return access.value;
    const sa = await service();
    if (sa) return serviceToken(sa);
    const c = await client();
    const t = await stored();
    if (!c || !t || !t.refreshToken) throw Object.assign(new Error("Google Analytics is not connected yet. Finish the setup in Settings."), { needsConnect: true });
    const res = await fetch(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: t.refreshToken, grant_type: "refresh_token" })
    });
    const j = await res.json();
    if (!res.ok) {
      if (j.error === "invalid_grant") { await unlink(tokenFile).catch(() => {}); throw Object.assign(new Error("Google ended the connection (it expired or was revoked). Connect again in Settings."), { needsConnect: true }); }
      throw new Error(j.error_description || j.error || "Could not refresh the Google token.");
    }
    access = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
    return access.value;
  }

  async function disconnect() {
    await unlink(serviceFile).catch(() => {});
    const t = await stored();
    if (t && t.refreshToken) await fetch(`${REVOKE}?token=${encodeURIComponent(t.refreshToken)}`, { method: "POST" }).catch(() => {});
    await unlink(tokenFile).catch(() => {});
    access = null;
  }

  async function call(url, body) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) access = null;
      const sa = await service();
      const hint = res.status === 403 && sa ? ` Give ${sa.client_email} Viewer access in Google Analytics: Admin, Property access management.` : "";
      const off = /has not been used|is disabled/i.test((j.error && j.error.message) || "") ? " Turn on the Google Analytics Data API and Admin API in Google Cloud (setup step 2)." : "";
      throw new Error(`Google Analytics: ${(j.error && j.error.message) || res.statusText}${hint}${off}`);
    }
    return j;
  }

  async function properties() {
    const out = [];
    let page = "";
    do {
      const j = await call(`${ADMIN}/accountSummaries?pageSize=200${page ? `&pageToken=${page}` : ""}`);
      for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) out.push({ id: p.property.split("/")[1], name: p.displayName, account: a.displayName });
      page = j.nextPageToken || "";
    } while (page);
    return out;
  }

  async function propertyHealth(id) {
    const p = await call(`${ADMIN}/properties/${id}`);
    let retention = "";
    try { retention = (await call(`${ADMIN}/properties/${id}/dataRetentionSettings`)).eventDataRetention || ""; } catch { /* some roles cannot read it */ }
    return { timeZone: p.timeZone || "", retention, name: p.displayName || "", checkedAt: new Date().toISOString() };
  }

  async function report(id, body) {
    const rows = [];
    for (let offset = 0; ; offset += 10000) {
      const j = await call(`${DATA}/properties/${id}:runReport`, { ...body, limit: 10000, offset });
      rows.push(...(j.rows || []));
      if (!j.rowCount || offset + 10000 >= j.rowCount) return rows;
    }
  }

  // The three tables the visitor match playbook reads, plus totals.
  async function pullProperty(id, startDate, endDate) {
    const dateRanges = [{ startDate, endDate }];
    const dims = (names) => names.map((name) => ({ name }));
    const [sessions, pages, events, totals] = await Promise.all([
      report(id, { dateRanges, dimensions: dims(["dateHour", "city", "region", "country", "sessionSourceMedium", "hostName", "deviceCategory", "screenResolution", "newVsReturning"]), metrics: [{ name: "sessions" }] }),
      report(id, { dateRanges, dimensions: dims(["dateHour", "city", "screenResolution", "hostName", "pagePath"]), metrics: [{ name: "screenPageViews" }] }),
      report(id, {
        dateRanges, dimensions: dims(["dateHour", "city", "screenResolution", "eventName", "linkUrl"]), metrics: [{ name: "eventCount" }],
        dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["file_download", "click"] } } }
      }),
      call(`${DATA}/properties/${id}:runReport`, { dateRanges, metrics: [{ name: "eventCount" }, { name: "screenPageViews" }, { name: "newUsers" }] })
    ]);
    const t = (totals.rows && totals.rows[0] && totals.rows[0].metricValues) || [];
    const num = (i) => Number(t[i] ? t[i].value : 0);
    return { sessions, pages, events, totals: { events: num(0), pageViews: num(1), firstVisits: num(2) } };
  }

  return { status, setClient, setServiceAccount, authUrl, finish, disconnect, properties, propertyHealth, pullProperty };
}
