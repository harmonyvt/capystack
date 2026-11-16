// postinstall: make deploy/node_modules point at ../node_modules.
// `cf deploy` must run from a directory that is not a Vite project (otherwise cf's autoconfig takes over and expects a
// Build Output Specification from @cloudflare/vite-plugin, which SvelteKit's adapter does not write). ./deploy is that
// directory; cf insists on finding `wrangler` in node_modules next to deploy/package.json, so it shares web's install.
import { existsSync, lstatSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const link = join(web, "deploy", "node_modules");
try {
	lstatSync(link);
} catch {
	if (existsSync(join(web, "node_modules"))) symlinkSync("../node_modules", link, "junction");
}
