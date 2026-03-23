import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { DEFAULT_PORT } from "kolu-common/config";

/** Require a Nix-provided env var, failing fast outside the devShell. */
function nixEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run inside the Nix devShell.`);
  return v;
}

const themesJsonPath = nixEnv("KOLU_THEMES_JSON");
const ghosttyWebPkgPath = nixEnv("GHOSTTY_WEB_PKG");

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "ghostty-themes": themesJsonPath,
      "ghostty-web": `${ghosttyWebPkgPath}/ghostty-web.js`,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ["..", ghosttyWebPkgPath],
    },
    proxy: {
      "/api": `http://localhost:${DEFAULT_PORT}`,
      "/rpc": {
        target: `http://localhost:${DEFAULT_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
