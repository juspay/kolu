/** Hop-by-hop + Host: removed before forwarding a request upstream.
 *  fetch sets its own Host; the rest are connection-scoped per RFC 7230
 *  §6.1 and must not propagate through a proxy. */
const HOP_BY_HOP_HEADERS = [
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
] as const;

/** Copy + strip hop-by-hop headers from an incoming request ready for a
 *  proxied fetch. Adds X-Forwarded-Host / X-Forwarded-Proto so upstream
 *  dev servers generating absolute URLs see the client-facing origin. */
export function buildUpstreamHeaders(
  incoming: Headers,
  host: string,
  proto: "http" | "https",
): Headers {
  const out = new Headers(incoming);
  for (const h of HOP_BY_HOP_HEADERS) out.delete(h);
  out.set("x-forwarded-host", host);
  out.set("x-forwarded-proto", proto);
  return out;
}

/** Remove framing restrictions from an upstream response so the browser
 *  tile's iframe can embed it. Strips `X-Frame-Options` outright and
 *  drops the `frame-ancestors` directive from any `Content-Security-
 *  Policy` header, leaving the rest of the policy intact. If the CSP
 *  becomes empty after stripping, the header itself is removed. */
export function stripFramingHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete("x-frame-options");
  const csp = out.get("content-security-policy");
  if (!csp) return out;
  const cleaned = csp
    .split(";")
    .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
    .join(";")
    .trim();
  if (cleaned === "") out.delete("content-security-policy");
  else out.set("content-security-policy", cleaned);
  return out;
}
