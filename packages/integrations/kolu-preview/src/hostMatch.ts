/** Shared Host-header matcher for the preview subdomain convention.
 *
 *  A preview subdomain has the shape `<port>.preview.<anything>` — where
 *  `<anything>` is whatever DNS form the user's deployment uses (sslip.io
 *  with an IP-encoded hostname, `*.localhost`, a corporate wildcard
 *  A-record, etc.). The proxy doesn't care which form; it only needs to
 *  extract the target port. */
const PREVIEW_HOST_RE = /^(\d+)\.preview\./;

/** Unprivileged TCP port range. Blocks 0, well-known services (<1024),
 *  and bogus values. Phase 2 will narrow this further via an
 *  announced-port allowlist from terminal stdout scraping (#633). */
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** Parse a preview target port from an HTTP `Host` header. Returns the
 *  port when the host matches the subdomain pattern AND the port is
 *  unprivileged; `null` otherwise. */
export function matchPreviewHost(host: string | undefined): number | null {
  if (!host) return null;
  const m = host.match(PREVIEW_HOST_RE);
  if (!m) return null;
  const port = Number(m[1]);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return null;
  }
  return port;
}
