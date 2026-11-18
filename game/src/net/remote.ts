// The game's side of the server (stage B): sign-in, the student's attempt, and what only the server
// knows: what each outcrop shows and the lab's answers. Without a server.json next to the game, there
// is no server and the game runs as before, in practice mode.

import type { Observation } from "../format/types";
import type { FileReader } from "../format/loader";

export interface ServerConfig {
  /** "local": the development server; "supabase": Supabase Auth and the Edge Function "geomapper". */
  kind: "local" | "supabase";
  /** Base of the API: "/api", or https://<project>.supabase.co/functions/v1/geomapper. */
  api: string;
  /** Supabase only: the project URL and its public (anon) key, for the email link. */
  url?: string;
  anonKey?: string;
}

export interface AttemptView {
  id: string;
  folder: string;
  seed: number;
  status: "open" | "submitted";
  version: number;
  state: unknown;
  observations: Record<string, Observation>;
  lab: Record<string, string>;
}

export interface Me {
  email: string;
  role: "student" | "teacher";
}

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

const TOKEN = "minegeology:token";

/** server.json next to the game, or null in a static (practice) deployment. */
export async function loadServerConfig(): Promise<ServerConfig | null> {
  try {
    const r = await fetch("./server.json", { cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    const c = (await r.json()) as ServerConfig;
    return c && (c.kind === "local" || c.kind === "supabase") && typeof c.api === "string" ? c : null;
  } catch {
    return null;
  }
}

export class Remote {
  token: string | null = null;

  constructor(readonly config: ServerConfig) {
    try {
      this.token = localStorage.getItem(TOKEN);
    } catch {
      this.token = null;
    }
  }

  private keep(token: string | null): void {
    this.token = token;
    try {
      if (token) localStorage.setItem(TOKEN, token);
      else localStorage.removeItem(TOKEN);
    } catch {
      // A private window: the session lasts until the tab closes.
    }
  }

  /** After the email link: Supabase puts the token in the address (#access_token=...). Takes it and cleans the address. */
  takeTokenFromUrl(): void {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("access_token");
    if (!token) return;
    this.keep(token);
    history.replaceState(null, "", location.pathname + location.search);
  }

  signOut(): void {
    this.keep(null);
  }

  /** Local server: signs in at once. Supabase: sends the email with the link and returns false (the student follows it). */
  async signIn(email: string): Promise<boolean> {
    if (this.config.kind === "local") {
      const r = await this.call<{ token: string }>("POST", "/auth/dev-login", { email }, false);
      this.keep(r.token);
      return true;
    }
    const back = location.origin + location.pathname + location.search;
    const r = await fetch(`${this.config.url}/auth/v1/otp?redirect_to=${encodeURIComponent(back)}`, {
      method: "POST",
      headers: { apikey: this.config.anonKey ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!r.ok) throw new RemoteError(r.status === 422 || r.status === 400 ? "Ese correo no puede entrar: usa tu correo institucional." : "No se pudo enviar el enlace.", r.status, {});
    return false;
  }

  async call<T>(method: "GET" | "POST", route: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.config.anonKey) headers.apikey = this.config.anonKey;
    const r = await fetch(`${this.config.api}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      if (r.status === 401) this.keep(null);
      throw new RemoteError(String(data.error ?? `Error ${r.status}`), r.status, data);
    }
    return data as T;
  }

  me = () => this.call<Me>("GET", "/me");
  scenarios = () => this.call<{ scenarios: { folder: string; scenario_id: string; variant: string; title: string; level: number; summary?: string }[] }>("GET", "/scenarios", undefined, false);
  open = (folder: string) => this.call<AttemptView>("POST", "/attempt/open", { folder });
  save = (id: string, version: number, state: unknown, events: unknown[]) => this.call<{ version: number }>("POST", "/attempt/save", { id, version, state, events });
  observe = (id: string, outcrop: string, x: number, y: number) => this.call<{ observation: Observation }>("POST", "/observe", { id, outcrop, x, y });
  sample = (id: string, body: { outcrop: string; unit: string; analysis: string; number: number; day: number }) => this.call<{ number: string; day: number }>("POST", "/sample", { id, ...body });
  lab = (id: string) => this.call<{ lab: Record<string, string> }>("POST", "/lab", { id });
  submit = (id: string, state: unknown) => this.call<{ status: string }>("POST", "/attempt/submit", { id, state });
  grade = (id: string) => this.call<{ released: boolean; total?: number; parts?: { key: string; score: number | null; weight: number; notes: string[] }[]; note?: string | null }>("GET", `/attempt/grade?id=${encodeURIComponent(id)}`);

  /** Reads the graded bundle of a scenario: the public files, without observations. */
  bundle(folder: string): FileReader {
    return async (path: string) => {
      const r = await fetch(`${this.config.api}/bundle/${folder}/${path}`);
      if (!r.ok) throw new RemoteError(`No se pudo descargar ${folder}/${path} (${r.status})`, r.status, {});
      return new Uint8Array(await r.arrayBuffer());
    };
  }
}
