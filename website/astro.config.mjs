// @ts-check

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
// Port pinned to 4321 (Astro default) — kept explicit to make clear it
// never collides with Kolu's default 7681.
const DEV_PORT = 4321;

export default defineConfig({
  site: "https://kolu.dev",
  trailingSlash: "ignore",
  server: { port: DEV_PORT, host: "127.0.0.1" },
  // /tui is the page's old name (from before the daemon `kaval` and its client
  // `kaval-tui` were named apart) — keep the URL working, send it to /kaval.
  redirects: { "/tui": "/kaval" },
  integrations: [
    mdx(),
    // /kaval is deliberately unlisted (shared by URL only): keep it — and the
    // /tui redirect that points at it — out of the sitemap so they stay
    // unadvertised; the page itself also carries noindex.
    sitemap({
      filter: (page) => {
        const { pathname } = new URL(page);
        return !pathname.startsWith("/kaval") && !pathname.startsWith("/tui");
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
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
