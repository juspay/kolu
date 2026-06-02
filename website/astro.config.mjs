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
  // Inline each page's CSS so the committed dist/garden/*.html is self-contained
  // and previews in kolu's Code tab without the hashed _astro bundle (which would
  // churn git on every build).
  build: { inlineStylesheets: "always" },
  server: { port: DEV_PORT, host: "127.0.0.1" },
  integrations: [mdx(), sitemap()],
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
