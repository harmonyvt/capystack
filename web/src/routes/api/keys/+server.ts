import type { RequestHandler } from "./$types";
import { env } from "cloudflare:workers";
import { handleKeys } from "$lib/server/keys";
import type { Env } from "$lib/server/env";

export const prerender = false;
// GET (list) and POST (create); other methods answer 405 from the handler.
export const fallback: RequestHandler = ({ request }) => handleKeys(request, env as unknown as Env);
