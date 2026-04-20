/** HEAD-probe a URL to detect framing restrictions (#633).
 *
 *  Server-side so the client isn't exposed to the target's CORS policy
 *  (a browser-side fetch of an opaque response can't read headers).
 *  Callers (the terminal's `probeBrowserUrl` handler) treat the result
 *  as a hint — the UI always offers an "Open externally" fallback. */

import { log } from "./log.ts";

/** Pure header parser — extracted so unit tests can cover the directive-
 *  split logic and case-handling without spinning up fetch. Returns
 *  `blocked: true` with a short reason when `X-Frame-Options: DENY|
 *  SAMEORIGIN` or a restrictive `Content-Security-Policy: frame-ancestors
 *  'none'|'self'` is present. */
export function parseFramingHeaders(headers: {
  xFrameOptions?: string | null;
  contentSecurityPolicy?: string | null;
}): { blocked: boolean; reason?: string } {
  const xfo = headers.xFrameOptions?.toLowerCase().trim();
  if (xfo === "deny" || xfo === "sameorigin") {
    return { blocked: true, reason: `X-Frame-Options: ${xfo}` };
  }
  // CSP is a semicolon-separated list of directives; parse per directive
  // rather than with a single regex so `'none'` / `'self'` tokens match
  // cleanly (the single-quote boundaries break `\b` word-boundary anchors).
  for (const directive of (headers.contentSecurityPolicy ?? "").split(";")) {
    const trimmed = directive.trim();
    if (!/^frame-ancestors\b/i.test(trimmed)) continue;
    const sources = trimmed.slice("frame-ancestors".length).trim().split(/\s+/);
    for (const src of sources) {
      if (src === "'none'" || src === "'self'") {
        return { blocked: true, reason: `CSP frame-ancestors ${src}` };
      }
    }
  }
  return { blocked: false };
}

/** HEAD-probe a URL to detect framing restrictions. Network errors /
 *  timeouts return `blocked: false` — the iframe load itself will surface
 *  that failure, and the UI always offers an "Open externally" escape. */
export async function probeFraming(
  url: string,
): Promise<{ blocked: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { blocked: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { blocked: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    return parseFramingHeaders({
      xFrameOptions: res.headers.get("x-frame-options"),
      contentSecurityPolicy: res.headers.get("content-security-policy"),
    });
  } catch (err) {
    log.debug({ err, url }, "browser url probe failed");
    return { blocked: false };
  } finally {
    clearTimeout(timer);
  }
}
