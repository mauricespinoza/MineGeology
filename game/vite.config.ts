import { readFileSync, readdirSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

// The icon (game/icons/, written by tools/make-icons.mjs) and the web manifest
// go to fixed paths at the root of the site, so that "add to home screen"
// finds them. They cannot go through publicDir, which serves the baked
// scenarios, and Vite would hash the manifest and break its icon paths.
function appIcons(): Plugin {
  const dir = new URL("./icons/", import.meta.url);
  const files = () => readdirSync(dir).filter((f) => /\.(png|svg)$/.test(f));
  const manifest = JSON.stringify(
    {
      name: "MineGeology · GeoMapper Chile",
      short_name: "MineGeology",
      description: "Juego de mapeo geológico en un mundo de bloques.",
      lang: "es",
      start_url: "./",
      scope: "./",
      display: "fullscreen",
      orientation: "landscape",
      background_color: "#111827",
      theme_color: "#111827",
      icons: [
        { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    },
    null,
    2,
  );
  return {
    name: "app-icons",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (path.endsWith("/manifest.webmanifest")) {
          res.setHeader("Content-Type", "application/manifest+json");
          return res.end(manifest);
        }
        const m = path.match(/\/icons\/([\w.-]+)$/);
        if (m && files().includes(m[1])) {
          res.setHeader("Content-Type", m[1].endsWith(".svg") ? "image/svg+xml" : "image/png");
          return res.end(readFileSync(new URL(m[1], dir)));
        }
        next();
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: "asset", fileName: `icons/${f}`, source: readFileSync(new URL(f, dir)) });
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest });
    },
    transformIndexHtml() {
      const link = (attrs: Record<string, string>) => ({ tag: "link", attrs, injectTo: "head" as const });
      return [
        link({ rel: "icon", type: "image/svg+xml", href: "./icons/favicon.svg" }),
        link({ rel: "apple-touch-icon", href: "./icons/icon-180.png" }),
        link({ rel: "manifest", href: "./manifest.webmanifest" }),
        { tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" }, injectTo: "head" as const },
        { tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: "MineGeology" }, injectTo: "head" as const },
        { tag: "meta", attrs: { name: "theme-color", content: "#111827" }, injectTo: "head" as const },
      ];
    },
  };
}

// The baked scenarios (public parts only) are served as static files next to the game.
export default defineConfig({
  base: "./",
  publicDir: "../baked",
  plugins: [appIcons()],
  worker: { format: "es" },
  build: { outDir: "dist", target: "es2022" },
  server: { fs: { allow: [".."] } },
});
