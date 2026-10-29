// Builds "Designer Job Search.app" for this Mac and puts it in Applications.
//   npm run app              build and install
//   npm run app -- --here    build into dist/ only, to try it first
// Needs the Mac's Swift compiler (Xcode or its Command Line Tools: xcode-select --install).
// The app runs the code in this folder, so pulling updates needs no rebuild. Rebuild only if
// this folder moves or Node.js moves.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, copyFile, rm, rename, access, realpath, mkdtemp } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "../js/terms.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "Designer Job Search";
const HERE = process.argv.includes("--here");

// A stable path to Node: Homebrew's link survives Node upgrades; the real file does not.
async function nodePath() {
  const real = await realpath(process.execPath);
  for (const c of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    try { if ((await realpath(c)) === real) return c; } catch { /* not there */ }
  }
  return process.execPath;
}
const writable = async (dir) => { try { await access(dir, constants.W_OK); return true; } catch { return false; } };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

try { execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" }); }
catch { console.error("The Swift compiler is missing. Run: xcode-select --install, then npm run app again."); process.exit(1); }

const work = await mkdtemp(join(tmpdir(), "djs-app-"));
const app = join(work, `${NAME}.app`);
await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
await mkdir(join(app, "Contents", "Resources"), { recursive: true });

console.log("Compiling…");
execFileSync("xcrun", ["swiftc", "-O", "-o", join(app, "Contents", "MacOS", "DesignerJobSearch"), join(ROOT, "mac", "DesignerJobSearch.swift"), "-framework", "Cocoa", "-framework", "WebKit"], { stdio: "inherit" });

await writeFile(join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${NAME}</string>
  <key>CFBundleDisplayName</key><string>${NAME}</string>
  <key>CFBundleIdentifier</key><string>com.stevendesignservices.designer-job-search</string>
  <key>CFBundleExecutable</key><string>DesignerJobSearch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${APP_VERSION}</string>
  <key>CFBundleVersion</key><string>${APP_VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>© 2026 Steven Design Services LLC. MIT License.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>DJSAppDir</key><string>${esc(ROOT)}</string>
  <key>DJSNode</key><string>${esc(await nodePath())}</string>
</dict>
</plist>
`);
await copyFile(join(ROOT, "assets", "AppIcon.icns"), join(app, "Contents", "Resources", "AppIcon.icns"));

// Signed for this Mac only (ad hoc). Clear file attributes first, or codesign refuses.
execFileSync("xattr", ["-cr", app]);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "ignore" });

let dest;
if (HERE) dest = join(ROOT, "dist");
else dest = (await writable("/Applications")) ? "/Applications" : join(homedir(), "Applications");
await mkdir(dest, { recursive: true });
const target = join(dest, `${NAME}.app`);
await rm(target, { recursive: true, force: true });
await rename(app, target).catch(async () => { execFileSync("ditto", [app, target]); });
await rm(work, { recursive: true, force: true });
console.log(`Built ${target}`);
console.log(HERE ? "Open it from there to try it." : "Open it from Applications, Launchpad or Spotlight. Drag it to the Dock to keep it there.");
