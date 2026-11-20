import { hasOwnScheme } from "@kolu/url-shape";

export { hasOwnScheme };

/** Allowlist a URL for use as an `href`. Returns the original string when
 *  safe, else `undefined` (the caller then renders inert text). DOM-free:
 *  resolves relative refs against a fixed base so we can read the *effective*
 *  scheme without a `window`. Blocks `javascript:`, `data:`, `vbscript:` and
 *  any other script-capable scheme; allows http(s), mailto, and in-page
 *  anchors. */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed === "") return undefined;
  if (trimmed.startsWith("#")) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed, "https://markdown.local/");
  } catch {
    return undefined;
  }
  const ok =
    url.protocol === "http:" ||
    url.protocol === "https:" ||
    url.protocol === "mailto:";
  return ok ? trimmed : undefined;
}

/** An image that loads directly as written — an absolute http(s) URL or an
 *  inline data:image URI. A repo-relative README src (`./docs/logo.png`) is
 *  NOT loadable as-is; it goes through the host's `resolveImageSrc` first. */
export function isLoadableImage(src: string): boolean {
  return /^(?:https?:\/\/|data:image\/)/i.test(src.trim());
}
