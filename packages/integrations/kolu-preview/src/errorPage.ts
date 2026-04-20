/** Shared error-page helpers for the preview proxy.
 *
 *  Both the HTTP middleware and the WS upgrade handler can fail the same
 *  way — the upstream dev-server port refuses the dial, or returns an
 *  errno the caller can't interpret. Keep the user-facing rendering in
 *  one place so "no dev server running on port 5173" looks identical
 *  whether the proxy is fetching an iframe asset or opening an HMR
 *  WebSocket. */

/** Node `fetch` / `ws` wraps underlying network errors in `err.cause`;
 *  the `.code` there is the usual POSIX errno string (`ECONNREFUSED`,
 *  `EHOSTUNREACH`, etc.). Also handles the shape where `err.code` is
 *  directly on the error (ws client). Returns `undefined` when the
 *  error isn't a system error. */
export function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    if ("code" in err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    if ("cause" in err) {
      const cause = (err as { cause?: unknown }).cause;
      if (cause && typeof cause === "object" && "code" in cause) {
        const code = (cause as { code?: unknown }).code;
        if (typeof code === "string") return code;
      }
    }
  }
  return undefined;
}

/** HTML shown to the user when the upstream port refuses both loopback
 *  families. Intentionally more than a one-liner: the user's mental
 *  model is "I opened a browser tile and nothing loaded," so the page
 *  explicitly names the port, the errno, and the real root causes (no
 *  dev server / different machine / non-loopback binding). */
export function renderUpstreamErrorPage(
  port: number,
  code: string | undefined,
): string {
  const codeLabel = code ?? "connection failed";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Preview unavailable — port ${port}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 560px;
      margin: 4rem auto;
      padding: 0 2rem;
      color: #1f2328;
      line-height: 1.5;
    }
    h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.75rem; }
    code { background: #f6f8fa; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
    .errno { color: #cf222e; }
    ul { padding-left: 1.25rem; color: #57606a; font-size: 0.9rem; }
    li { margin: 0.35rem 0; }
    .footer { color: #8c959f; font-size: 0.8rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Kolu preview: nothing listening on port <code>${port}</code></h1>
  <p>The proxy dialed both <code>127.0.0.1:${port}</code> and <code>[::1]:${port}</code> on this host and got <code class="errno">${codeLabel}</code>.</p>
  <p>Common causes:</p>
  <ul>
    <li>No dev server is running on port <code>${port}</code> yet — start it and this page should load on refresh.</li>
    <li>Dev server is running on a <em>different</em> machine than the Kolu process. The proxy can only reach services on the same host as Kolu.</li>
    <li>Dev server is bound to a non-loopback interface (e.g. your Tailscale IP directly) — bind it to <code>127.0.0.1</code> or <code>0.0.0.0</code> so the loopback dial reaches it.</li>
  </ul>
  <p class="footer">Kolu preview proxy (#633)</p>
</body>
</html>
`;
}

/** Write an HTTP 502 response with the error page directly onto a raw
 *  upgrade socket. Used by the WS proxy when it fails to dial upstream
 *  *before* completing the browser's WebSocket handshake — in that
 *  narrow window we still own the socket as plain HTTP and can surface
 *  a visible error page instead of a silent WS close. */
export function writeUpstreamErrorToSocket(
  socket: NodeJS.WritableStream,
  port: number,
  code: string | undefined,
): void {
  const html = renderUpstreamErrorPage(port, code);
  const body = Buffer.from(html, "utf8");
  const head =
    `HTTP/1.1 502 Bad Gateway\r\n` +
    `Content-Type: text/html; charset=utf-8\r\n` +
    `Content-Length: ${body.length}\r\n` +
    `Connection: close\r\n\r\n`;
  socket.write(head);
  socket.write(body);
  socket.end();
}
