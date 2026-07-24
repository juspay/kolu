/**
 * Single receptacle for the site's positioning copy. Imported by
 * BaseLayout (description, OG/Twitter meta) and the OG image generator
 * (the home/fallback card). When the positioning sentence changes, this
 * file is the one edit — no character-divergent copies in two places.
 *
 * The short tagline is intentionally a separate string: it's a
 * different grain (alt-text / page-title constraint), not the same
 * sentence at a different size.
 */

export const SITE_DESCRIPTION =
  "kolu is a browser terminal workspace that spans machines: point it at a box over ssh and the whole canvas runs there — terminals, code, git, agents — backed by padi and kaval on every host.";

export const SITE_TAGLINE = "the best way to run terminals";

export const KOLU_PALETTE = {
  primaryRgb: [225, 69, 132] as [number, number, number],
};

export const KOLU_VERSION = import.meta.env.PUBLIC_KOLU_VERSION;
if (!KOLU_VERSION) {
  throw new Error("PUBLIC_KOLU_VERSION is required for the website build");
}
