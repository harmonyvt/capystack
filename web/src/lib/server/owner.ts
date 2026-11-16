// Owner authentication shared by /api/auth/* and /api/keys*.
import { JwksCache, verifyAccessJwt, type AccessConfig, type JwtResult } from "./access";
import type { Env } from "./env";

export type Deps = { jwks: JwksCache; now?: () => number };

// Module-scope cache: survives across requests within an isolate.
let defaultJwks: { team: string; cache: JwksCache } | undefined;
export const jwksFor = (team: string): JwksCache => {
    if (!defaultJwks || defaultJwks.team !== team) defaultJwks = { team, cache: new JwksCache(team) };
    return defaultJwks.cache;
};

// Step 1 of every owner route: the Access JWT (aud, iss, exp, email == OWNER_EMAIL). Fails closed.
export function authenticate(request: Request, env: Env, deps?: Partial<Deps>): Promise<JwtResult> {
    const access: AccessConfig = { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL };
    return verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), access, deps?.jwks ?? jwksFor(env.ACCESS_TEAM_DOMAIN), (deps?.now ?? Date.now)());
}
