/**
 * OG image generator — one PNG per page, generated at build time via
 * `astro-og-canvas` (canvaskit-wasm). Routes:
 *
 *   /open-graph/site.png                  — the home / fallback card.
 *   /open-graph/blog/<slug>.png           — per-blog-post card with the
 *                                            post's title + description.
 *
 * `BaseLayout.astro` resolves the route via its `ogImageRoute` prop;
 * blog pages pass `blog/<slug>`, the home passes `site`, and any
 * future page can pass its own key.
 *
 * Brand: void background with a middle-step pink inline-start border — same
 * primary palette as the site chrome.
 */

import { getCollection } from "astro:content";
import { OGImageRoute } from "astro-og-canvas";
import { KOLU_PALETTE, SITE_DESCRIPTION } from "../../site";

const blog = await getCollection("blog");

const pages: Record<string, { title: string; description: string }> = {
  site: {
    title: "kolu",
    description: SITE_DESCRIPTION,
  },
  ...Object.fromEntries(
    blog.map(({ id, data }) => [
      `blog/${id}`,
      { title: data.title, description: data.description },
    ]),
  ),
};

// Local Noto Sans TTF — astro-og-canvas's default loader fetches
// `https://api.fontsource.org/.../noto-sans/...ttf` at build time,
// which fails inside the Nix sandbox (no network). Bundling a TTF
// keeps the build hermetic. The TTF lives at `public/fonts/` so it's
// also addressable as a static asset; the path here is project-rooted.
const NOTO_SANS = "./public/fonts/NotoSans.ttf";

export const { getStaticPaths, GET } = await OGImageRoute({
  param: "route",
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [
      [7, 8, 13],
      [16, 19, 28],
    ],
    border: { color: KOLU_PALETTE.primaryRgb, width: 8, side: "inline-start" },
    padding: 80,
    fonts: [NOTO_SANS],
    font: {
      title: {
        color: [244, 247, 251],
        size: 64,
        weight: "Medium",
        lineHeight: 1.15,
        families: ["Noto Sans"],
      },
      description: {
        color: [193, 199, 208],
        size: 28,
        weight: "Normal",
        lineHeight: 1.5,
        families: ["Noto Sans"],
      },
    },
  }),
});
