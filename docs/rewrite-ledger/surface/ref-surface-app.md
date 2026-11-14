# ref-surface-app

- Kind: reference. Reader: someone wiring `@kolu/surface-app` who needs to look up an export.
- Rewritten from: `f50641c6a`
- Committed one `##` section at a time.
- Frontmatter: unchanged.

## The whole listener, in one call

- Words (counted by `docs-lint`'s rules, including the page opening): 2,763 → 2,746. Before: one `##` heading holding 501 words of running text, six `<Aside>`s, four tables with essay cells. After: an index table, 18 entries, no asides, every block, cell and heading section inside the lint's limits.
- Headings renamed:
  - `The whole listener, in one call` → `The listener` (`#the-whole-listener-in-one-call` → `#the-listener`). Its one inbound link was on this page and now points at `#the-generation-it-serves`, the entry section that owns the fact it cited.
  - `Ending a connection from the app — `connection.close`` → `` `connection.close(code?, reason?)` ``. No inbound links.
  - Kept verbatim (inbound links): `The upgrade's headers — `upgradeHeaders`` (linked from the changelog), `A live allowlist, read at each accept` (linked from this page's event table).
- New entries for exports that had only a table row: `SurfaceAppListenFailed`, `SurfaceAppConnection`, `SurfaceAppEvent`, `SurfaceAppHttpMiddleware`, `reportSurfaceAppEvent(event)`, `checkUpgradeHeaders(names)`, `UpgradeHeadersSource<H>`, `pickUpgradeHeaders(request, names)`, `SURFACE_WS_PATH`, `surfaceWsUrl(httpBaseUrl)`, `thrownText(error)`.
- The six asides became entry sections: "The listening socket closes last, deliberately" → `Closing the scope`; "The inbound frame cap is not a knob" → `The inbound frame cap`; "An allowlist, because the alternative leaks" → `What the allowlist refuses`; "Naming a header says who may WRITE it" → `Who may write a named header`; "A bad LIVE list refuses itself, never the socket" → `A live list that refuses itself`; "`expose` gates THIS face, not the surface" → `expose`.
- `/surface/ref-surface#a-rooted-bundle-whose-siblings-move--implementrootedsurfaces` updated to `/surface/ref-surface#implementrootedsurfacescore-base-deps` (anchor supplied by the integrator).

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "The connection used to carry the raw `IncomingMessage`, which is the whole header bag" | history |
| "an app that hand-rolled 8 MiB killed a 10 MiB frame the framework said it would carry" | history |
| "a serve that came up without that part used to answer its own procedures the moment it was switched on while every socket stayed anonymous until a restart" | history |
| "Existing callers that pass values do not change"; "as it always did" | history |
| "a header's absence is a load-bearing answer here" (kept as the short clause about an open index) | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
