// @ts-check

import { existsSync, readFileSync } from "node:fs";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { remarkChangelog } from "./src/remarkChangelog";
import { shikiConfig } from "./src/shiki-config.mjs";

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

const DEV_PORT = 4321;
const KOLU_VERSION = readKoluVersion();
process.env.PUBLIC_KOLU_VERSION = KOLU_VERSION;

export default defineConfig({
  site: "https://kolu.dev",
  trailingSlash: "ignore",
  server: { port: DEV_PORT, host: "127.0.0.1" },
  redirects: { "/tui": "/kaval" },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/tui"),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // The dev server stays bound to loopback; this is the tailnet name a
    // `tailscale serve` proxy fronts it with, which Vite otherwise rejects on
    // the Host header.
    server: { allowedHosts: ["pureintent.rooster-blues.ts.net"] },
    define: {
      "import.meta.env.PUBLIC_KOLU_VERSION": JSON.stringify(KOLU_VERSION),
    },
  },
  markdown: {
    processor: unified({ remarkPlugins: [remarkChangelog] }),
    shikiConfig,
  },
});
