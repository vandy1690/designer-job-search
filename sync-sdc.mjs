// Copies the SDC production stylesheet into this folder so the dashboard
// renders with the real system: tokens, type, cards, stats, toggle.
// Source: ~/portfolio-astro/storybook/src/sdc.css (generated from the live site).
// The Inter @font-face blocks point at /node_modules paths that do not exist
// here, so they are dropped; the page loads the same Inter from Google Fonts.
// Run: node sync-sdc.mjs   (add --check to fail if the copy is stale)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(homedir(), "portfolio-astro/storybook/src/sdc.css");
const out = join(here, "sdc.css");

if (!existsSync(src)) {
  console.error("SDC source not found: " + src);
  process.exit(1);
}

const css = readFileSync(src, "utf8");
let result = "";
let i = 0;
let dropped = 0;
while (i < css.length) {
  const at = css.indexOf("@font-face", i);
  if (at === -1) { result += css.slice(i); break; }
  result += css.slice(i, at);
  const open = css.indexOf("{", at);
  let depth = 0, j = open;
  for (; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}" && --depth === 0) break;
  }
  if (depth !== 0) throw new Error("Unbalanced braces in an @font-face block");
  i = j + 1;
  dropped++;
}

const header = "/* COPIED by sync-sdc.mjs from ~/portfolio-astro/storybook/src/sdc.css. Do not edit here. */\n";
const next = header + result.replace(/\/\* [a-z0-9-]+-normal \*\/\n/g, "");

if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== next) { console.error("sdc.css is stale. Run: node sync-sdc.mjs"); process.exit(1); }
  console.log("sdc.css is current.");
} else {
  writeFileSync(out, next);
  console.log("Wrote sdc.css (" + dropped + " @font-face blocks dropped).");
}
