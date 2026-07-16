// @ts-check

import { existsSync, readFileSync } from "node:fs";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { remarkChangelog } from "./src/remarkChangelog";

function readKoluVersion() {
  if (process.env.KOLU_VERSION) return process.env.KOLU_VERSION;

  const candidates = [
    new URL("../packages/server/package.json", import.meta.url),
    new URL("./kolu-server-package.json", import.meta.url),
  ];
  const file = candidates.find((url) => existsSync(url));
  if (!file) {
    throw new Error(
      "Kolu server package.json is required for the website build",
    );
  }
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("packages/server/package.json is missing a string version");
  }
  return pkg.version;
}

// https://astro.build/config
// Port pinned to 4321 (Astro default) — kept explicit to make clear it
// never collides with Kolu's default 7681.
const DEV_PORT = 4321;
const KOLU_VERSION = readKoluVersion();
process.env.PUBLIC_KOLU_VERSION = KOLU_VERSION;

export default defineConfig({
  site: "https://kolu.dev",
  trailingSlash: "ignore",
  server: { port: DEV_PORT, host: "127.0.0.1" },
  // /tui is the page's old name (from before the daemon `kaval` and its client
  // `kaval-tui` were named apart) — keep the URL working, send it to /kaval.
  redirects: { "/tui": "/kaval" },
  integrations: [
    mdx(),
    // /kaval graduated — it's now a listed, indexable page. Only /tui stays out
    // of the sitemap: it's a redirect to /kaval, so advertising it would double
    // up the canonical URL.
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/tui"),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.PUBLIC_KOLU_VERSION": JSON.stringify(KOLU_VERSION),
    },
  },
  markdown: {
    processor: unified({ remarkPlugins: [remarkChangelog] }),
    shikiConfig: {
      // Dual theme — astro emits both as CSS variables; global.css routes
      // them via `[data-theme]` so code blocks track the light/dark toggle.
      themes: {
        light: "vitesse-light",
        dark: "vitesse-black",
      },
      defaultColor: false,
      wrap: false,
    },
  },
});
