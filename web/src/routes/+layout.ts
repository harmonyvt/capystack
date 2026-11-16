// Everything but /api/* is prerendered: the shell is static HTML on the CDN, the data comes from the cache and the API.
export const prerender = true;
export const ssr = true;
export const trailingSlash = "never";
