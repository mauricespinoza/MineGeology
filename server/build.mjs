// Bundles the server: dist/local.mjs for Node, and the Supabase Edge Function, one file each.
import { build } from "esbuild";

const common = { bundle: true, format: "esm", target: "es2022", loader: { ".json": "json" }, logLevel: "warning" };
await build({ ...common, entryPoints: ["src/local.ts"], outfile: "dist/local.mjs", platform: "node" });
await build({ ...common, entryPoints: ["src/edge.ts"], outfile: "supabase/functions/geomapper/index.js", platform: "neutral", mainFields: ["module", "main"] });
console.log("built dist/local.mjs and supabase/functions/geomapper/index.js");
