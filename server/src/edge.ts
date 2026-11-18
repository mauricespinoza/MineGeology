// The Supabase Edge Function: the same server, with Supabase's database, storage and sign-in.
// Supabase sets SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY; set ALLOWED_DOMAINS
// (default udec.cl) and TEACHER_EMAILS (comma separated) with `supabase secrets set`.

import { createApp } from "./app";
import { SupabaseIdentity } from "./auth";
import { Scenarios } from "./scenarios";
import { SupabaseStore, storageReader } from "./supabase";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const env = (k: string) => Deno.env.get(k) ?? "";
const url = env("SUPABASE_URL"), service = env("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(
  createApp({
    store: new SupabaseStore(url, service),
    scenarios: new Scenarios(storageReader(url, service)),
    identity: new SupabaseIdentity(url, env("SUPABASE_ANON_KEY")),
    domains: (env("ALLOWED_DOMAINS") || "udec.cl").split(",").map((d) => d.trim()).filter(Boolean),
    teachers: env("TEACHER_EMAILS").split(",").map((d) => d.trim()).filter(Boolean),
  }),
);
