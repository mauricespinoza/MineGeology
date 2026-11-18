// Who is asking. Two ways in, behind one interface:
// - Supabase: the client signs in with an email link and sends Supabase's access token; the server asks
//   Supabase whose token it is, which works whatever key Supabase signs its tokens with.
// - Local: for development and tests, the server signs its own short tokens (HS256) after a "sign-in"
//   that only checks the address. Never enabled in production.

export interface User {
  id: string;
  email: string;
  role: "student" | "teacher";
}

export interface Identity {
  /** The user behind a bearer token, or null when it is not valid. */
  identify(token: string): Promise<{ id: string; email: string } | null>;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

/** Only institutional addresses may sign in: the domains and their subdomains (alumnos.udec.cl counts for udec.cl). */
export function allowedEmail(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const host = email.slice(at + 1).toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Applies the rules after identification: the domain, and the teacher list. */
export function toUser(who: { id: string; email: string }, opts: { domains: string[]; teachers: string[] }): User {
  const email = who.email.toLowerCase();
  const teacher = opts.teachers.map((t) => t.toLowerCase()).includes(email);
  if (!teacher && !allowedEmail(email, opts.domains)) throw new AuthError(`Solo se aceptan correos institucionales (${opts.domains.join(", ")}).`, 403);
  return { id: who.id, email, role: teacher ? "teacher" : "student" };
}

// --- HS256 tokens, for the local server --------------------------------------------------

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signToken(secret: string, claims: { sub: string; email: string }, seconds = 12 * 3600): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + seconds })));
  return `${head}.${body}.${b64url(await hmac(secret, `${head}.${body}`))}`;
}

export async function verifyToken(secret: string, token: string): Promise<{ sub: string; email: string } | null> {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = await hmac(secret, `${head}.${body}`);
  const given = fromB64url(sig);
  if (given.length !== expected.length || !given.every((b, i) => b === expected[i])) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { sub?: string; email?: string; exp?: number };
    if (!claims.sub || !claims.email || !claims.exp || claims.exp < Date.now() / 1000) return null;
    return { sub: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}

export class LocalIdentity implements Identity {
  constructor(private readonly secret: string) {}
  async identify(token: string) {
    const c = await verifyToken(this.secret, token);
    return c && { id: c.sub, email: c.email };
  }
}

/** Supabase: asks the auth service whose token this is. */
export class SupabaseIdentity implements Identity {
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async identify(token: string) {
    const r = await this.fetcher(`${this.url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: this.anonKey } });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: string; email?: string };
    return u.id && u.email ? { id: u.id, email: u.email } : null;
  }
}
