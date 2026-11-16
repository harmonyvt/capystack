// Screenshots the mockup gallery with Chromium (Playwright). Run: node mockups/shoot.mjs
// Writes small PNGs into mockups/shots/ (gitignored): full page and each screen, light and dark.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(execSync("npm root -g").toString().trim(), "playwright")); }

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "shots");
mkdirSync(out, { recursive: true });

const browser = await playwright.chromium.launch();
const screens = ["phone-signin", "phone-notes", "phone-settings", "desk-signin", "desk-notes", "desk-settings"];
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(here, "index.html")).href);
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
  await page.screenshot({ path: join(out, `gallery-${theme}.png`), fullPage: true });
  for (const id of screens) {
    await page.locator(`#${id}`).screenshot({ path: join(out, `${id}-${theme}.png`) });
  }
  await page.close();
}
await browser.close();
console.log(`wrote ${screens.length * 2 + 2} screenshots to mockups/shots/`);
