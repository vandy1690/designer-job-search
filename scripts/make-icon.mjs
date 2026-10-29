// Renders assets/icon.svg into the app icon files, using headless Google Chrome and the Mac's
// own sips and iconutil:
//   assets/AppIcon.icns   the Mac app icon (every size macOS asks for)
//   assets/icon-180.png   for Safari's "Add to Dock" and home screens
//   node scripts/make-icon.mjs
// Only needed when the icon changes; the results are committed, so building the app needs no Chrome.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderPng(svg, size, out) {
  const profile = await mkdtemp(join(tmpdir(), "djs-icon-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
  try {
    let pages;
    for (let i = 0; i < 60 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); } catch { await sleep(250); } }
    const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`;
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
    await sleep(800);
    const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    await writeFile(out, Buffer.from(data, "base64"));
    ws.close();
  } finally {
    const gone = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await gone;
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const svg = await readFile(join(ROOT, "assets", "icon.svg"), "utf8");
const work = await mkdtemp(join(tmpdir(), "djs-iconset-"));
const big = join(work, "icon-1024.png");
await renderPng(svg, 1024, big);

// The sizes macOS reads from an .iconset folder.
const set = join(work, "AppIcon.iconset");
await mkdir(set);
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync("sips", ["-z", String(s), String(s), big, "--out", join(set, `icon_${s}x${s}.png`)], { stdio: "ignore" });
  execFileSync("sips", ["-z", String(s * 2), String(s * 2), big, "--out", join(set, `icon_${s}x${s}@2x.png`)], { stdio: "ignore" });
}
execFileSync("iconutil", ["-c", "icns", set, "-o", join(ROOT, "assets", "AppIcon.icns")]);
execFileSync("sips", ["-z", "180", "180", big, "--out", join(ROOT, "assets", "icon-180.png")], { stdio: "ignore" });
await copyFile(big, join(ROOT, "assets", "icon-1024.png"));
await rm(work, { recursive: true, force: true });
console.log("Wrote assets/AppIcon.icns, assets/icon-180.png and assets/icon-1024.png.");
