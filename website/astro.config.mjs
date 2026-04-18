// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
// Port pinned to 4321 (Astro default) — kept explicit to make clear it
// never collides with Kolu's default 7681.
const DEV_PORT = 4321;

export default defineConfig({
  site: "https://juspay.github.io",
  base: "/kolu",
  trailingSlash: "ignore",
  server: { port: DEV_PORT, host: "127.0.0.1" },
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      theme: "vitesse-black",
      wrap: false,
    },
  },
});
