import type { RequestHandler } from "./$types";
import { env } from "cloudflare:workers";
import { handleAuth } from "$lib/server/auth";
import type { Env } from "$lib/server/env";

export const prerender = false;
// POST /api/auth/web (this browser's session). Every other method answers 405 from the handler.
export const fallback: RequestHandler = ({ request }) => handleAuth(request, env as unknown as Env);
