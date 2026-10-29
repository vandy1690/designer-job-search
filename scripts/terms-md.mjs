// Writes TERMS.md and LICENSE from js/terms.js, so the repo shows the same terms as the app.
//   node scripts/terms-md.mjs
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TERMS, TERMS_VERSION, LICENSE, OWNER, SITE } from "../js/terms.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = [
  "# Terms of use",
  "",
  `Designer Job Search, by [${OWNER}](${SITE}). Version ${TERMS_VERSION}.`,
  "",
  "The app shows these same terms on its first setup screen, where you agree to them, and in its footer.",
  "",
  ...TERMS.flatMap((t) => [`## ${t.h}`, "", ...t.p.flatMap((p) => [p, ""])]),
  "## License",
  "",
  "The code is free under the MIT License. See [LICENSE](LICENSE).",
  ""
].join("\n");
await writeFile(join(ROOT, "TERMS.md"), md);
await writeFile(join(ROOT, "LICENSE"), LICENSE);
console.log("Wrote TERMS.md and LICENSE.");
