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

## Serving the fresh shell

- Words: 305 → 368. The growth is the index table and the entry headings. Before: one bold run-in paragraph, a 100-word table cell and three `<Aside>`s. After: an index table, four entries, three entry sections, no asides.
- Headings renamed: none. `Serving the fresh shell` is kept; the new `###`/`####` headings are additions. No inbound links point into this section.
- The three asides became entry sections: "Own the `http.Server`; don't let `HttpServer.serve` own it" → `Own the `http.Server``; "No `304`s, by design" → `No `304`s`; "The commit rides the shell, never a bundle define" → `The build commit`.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "which is the bug the whole freshness contract exists to prevent" | rationale (the entry already states the freshness contract) |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Building the client dist

- Words: 991 → 1,107. The growth is the index table, 13 entry headings and the four asides unpacked into lists. Before: one `##` holding 628 words of running text, four `<Aside>`s (the longest 227 words) and two table cells over 50 words. After: an index table, 13 entries, four entry sections, no asides.
- Headings renamed: none. `Building the client dist` is kept. No inbound links point into this section.
- The four asides became entry sections: "Neither half is an option" → `Siblings and splitting`; "The shell preloads the entry's STATIC chunks, and only those" → `Preloading the entry's static chunks`; "Moving the bundle out of the app's URL space" → `assetPrefix` (under `SurfaceClientBuildOptions`); "The hashed dir belongs to the build" → `The hashed dir`.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "since the socket was completed … the code splitting every consumer used to bolt on afterwards" | history |
| "`splitting: false` used to inline it" (kept, in present tense, as what `splitting: false` does) | history |
| "Deleting a sibling directory on the strength of its name is the alternative, and it would eat a `publicDir` output the day someone moved the prefix onto one" | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Accepting a browser socket

- Words: 232 → 316. The growth is the index table and six entry headings, which replace two dense paragraphs and a table whose `gateStaleSocket` and `SurfaceSocketServing` cells were essays.
- Headings renamed: none. `Accepting a browser socket` is kept verbatim, because `ref-surface` links to `#accepting-a-browser-socket`.
- No asides in this section before or after.

### Moved

None.

### Cut

Nothing.

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## Connecting from the client

- Words: 3,546 → 3,266. Before: four `##`/`###` sections holding 428, 972 and more words of running text, a 9-row members table whose `link` cell ran 110 words, and one `<Aside>`. After: an index table, 11 entries, 10 entry sections, no asides, every block under 80 words.
- Headings renamed:
  - `A roster change follows in place — `conn.redial(surfaces)`` → `` `conn.redial(surfaces)` `` (`#a-roster-change-follows-in-place--connredialsurfaces` → `#connredialsurfaces`). The two same-page links are updated. Six inbound links elsewhere still point at the old anchor: `website/src/content/surface/ref-surface-mcp.mdx:113` and `website/src/content/surface/ref-surface.mdx:443,510,757,765,1059` — both pages are assigned to other rewriters in this wave.
  - `What a roster move does not hide — `conn.connectionEpoch`` → `` `conn.connectionEpoch` `` (`#what-a-roster-move-does-not-hide--connconnectionepoch` → `#connconnectionepoch`). Its one inbound link is on this page and is updated.
  - `The readout, not a status` → `The readout` (`#the-readout-not-a-status` → `#the-readout`). Its one inbound link is on this page and is updated.
  - `The stale-tab handshake, and the one option you must spell` → `The stale-tab handshake`. No inbound links.
  - Kept: `The rooted bundle`, because `ref-surface` links to `#the-rooted-bundle` and the heading is already a plain name.
- New entries for exports that were only named in prose: `connectSurface(opts)`, `connectSurfaces(opts)`, `createProcessIdEcho()`, `createServerLifecycle({ wire, probe })`, `onClientError`, `createLiveSignal`.
- The aside "A websocket client requires a watchdog" became the `createLiveSignal` entry.
- `/surface/ref-surface#a-wire-that-follows-its-generations--followingwire` updated to `/surface/ref-surface#followingwire`, and `…#a-rooted-bundle-whose-siblings-move--implementrootedsurfaces` to `…#implementrootedsurfacescore-base-deps` (anchors supplied by the integrator). The other four links into `ref-surface` are unchanged, confirmed with the integrator.

### Moved

None.

### Cut

| Fact | Tag |
| --- | --- |
| "`connectSurfaces` required it until [#2222]…", with its PR link | history |
| "It used to: `redial` handed back a replacement, and `clients`, `core`, `transport`, `readout` and `health` were all dead the moment it resolved…" (the loss of local state a rebuild cost) | history |
| "saying it was is the second thing every consumer had to work around" | history |
| "the seam behaves exactly as it did before the slot existed" | history |
| "Replaces the transport-only `status` this used to hand back" (the `status` span survives in the readout entry) | history |
| "The two values a connection used to hand back … shipped a tab that sat on a dead server looking healthy forever"; "The third droppable value was `client.health()`" | history |
| "it used to ship an `identity.info` beside `buildInfo`" (restated in the present tense: what such a member would cost) | history |
| "a collection whose keys stream had died rendered as a collection with nothing in it, under a green light" | history |
| "(was `ws: PartySocket`)" (restated as what `link.wire` is) | history |
| the olai PR link on `connectionEpoch`, and "the subscriptions are fine and the light is green" | history |
| "which is the point", "that is the price of one path rather than two", "the honest half of an in-place move" | rationale |

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).

## The client model

- Words: 144 → 182, the growth being the index table and two entry headings. Before: one 45-word sentence carrying three parenthetical facts. After: two entries, the provider's props as a list, the accessor table unchanged in content.
- Headings renamed: none. `The client model` is kept. No inbound links point into this section.

### Moved

None.

### Cut

Nothing. "the LOOK of an uncaught render throw" is now "the look of an uncaught render throw".

### Dropped code spans

None (`.waterfall/compare.mjs`: 0 missing).
