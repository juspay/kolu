# @kolu/url-shape

Pure URL-shape predicates: DOM-free, zero dependencies. Shape is the structural
question (does this ref carry its own origin? is this host loopback?). Policy
(which schemes are allowed, which door a loopback URL opens) stays with each
consumer.

The single entry is `.`, which is `src/index.ts`.

| Export | What it answers |
| --- | --- |
| `hasOwnScheme(src)` | Does the ref carry an origin of its own? True for `#anchor`, `//host` and anything with a scheme. |
| `hostAuthority(host, port)` | `host:port` in the form a URL parser accepts. An IPv6 literal is re-bracketed here. |
| `isLoopbackHostname(host)` | `localhost`, all of `127.0.0.0/8`, `::1`, `0.0.0.0` and its IPv6 twin. Brackets are stripped first. |
| `parseLoopbackUrl(text)` | A printed URL taken apart into `LoopbackUrl` (host, port, protocol, pathname, search, hash), or `null`. |
| `WEB_URL_PATTERN` | What counts as a web URL inside terminal text. |
| `LoopbackUrl` | The parse result type. |

It is a leaf so unrelated owners share it with no dependency arrow between them:
the Markdown href policy in `@kolu/solid-markdown`, the relative-ref resolver in
`@kolu/solid-browser`, and the server and browser legs that print and dial
loopback addresses. Also depended on by `kolu-client`, `kolu-server`,
`@kolu/surface-app` and `@kolu/xterm-kit`.

## What not to break

- Nothing here may touch the DOM or take a dependency. Routing these predicates
  through `@kolu/solid-markdown` would drag solid-js and DOMPurify into the
  node-pure resolver.
- `WEB_URL_PATTERN` is the addon default `@xterm/addon-web-links` uses as
  `urlRegex`, restated because the addon does not export it. The click path and
  the printed-port index both read it, so a URL the terminal underlines is
  exactly a URL the index finds. It is non-global on purpose; a scanner that
  needs every match builds a global copy from `.source`.
- `hostAuthority` is the only place a bracket is added. An address printed in
  one spelling and dialled in another is an address where one of the two fails.
- `parseLoopbackUrl` accepts `http:` and `https:` only, and defaults a missing
  port to 80 or 443, the way a browser would.

`src/index.test.ts` holds the behavioural contract.
