import { defineWranglerConfig } from "wrangler/experimental-config";

// Bundler settings for cf, which delegates the build to the local Wrangler devDependency. `assetsDirectory` is the
// adapter's output directory; its `.assetsignore` keeps _worker.js, _headers and _routes.json out of the public files.
export default defineWranglerConfig({
	types: {
		generate: false,
	},
	assetsDirectory: "../.svelte-kit/assets",
});
