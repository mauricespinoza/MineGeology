import { defineConfig } from "vite";

// The baked scenarios (public parts only) are served as static files next to the game.
export default defineConfig({
  base: "./",
  publicDir: "../baked",
  worker: { format: "es" },
  build: { outDir: "dist", target: "es2022" },
  server: { fs: { allow: [".."] } },
});
