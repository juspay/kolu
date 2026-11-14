# glossary

- Kind: reference (a look-up list). Reader: anyone who meets an unfamiliar framework word on another Surface page and follows its link here.
- Rewritten from: `f50641c6a`
- Words: 832 → 947. The page is one line per term before and after; each definition was rewritten to match the finished page it points at, which costs a few words per entry and removes every paired dash.
- Frontmatter: `description` cut from 165 to 100 characters and to one sentence ("Plain-language definitions of the surface vocabulary, each with a link to the page that teaches it."). Keys unchanged.

## Headings

| Old | New |
| --- | --- |
| The surface and its members | The surface and its members |
| Wiring it up | Reaching a surface from a client |
| Long-lived processes (daemons) | Long-lived processes (daemons) |
| Many machines (multi-host) | Many machines (multi-host) |
| The real consumers (used as examples throughout) | The apps these docs use as examples |

No inbound link targets an anchor on this page: a repo grep for `glossary#` finds none, and `.waterfall/anchors.md` lists none. Every page that links here links to `/surface/glossary`, so the two renamed headings needed no link updates.

## Terms

Every term the page carried is still defined, one definition each, all ≤ 40 words (longest: 32). Two term names were respelled, with the fact unchanged:

| Old term name | New term name | Why |
| --- | --- | --- |
| Watchdog / liveness | Watchdog | One word per thing (rule 17); the liveness fact is in the definition. |
| Health — a fact, not a verdict | Health | A term name, not a slogan; the definition still says the client reports the fact and the app decides. |
| Pid gate / single-instance | Pid gate (single-instance) | Both spellings kept, one term. |
| The daemon spine | Daemon spine | Reads as a term rather than a page title. |
| Recycle / converge | Recycle and converge | No slash reading as "or". |
| Pump / re-serve | Pump and re-serve | Same. |
| Contract version vs build id | Contract version and build id | Same. |
| entry / `useEntry` | entry and `useEntry` | Same. |
| Fold envelope / void-input | Fold envelope (void-input) | Same. |

No term was added. Six pages link a first use to this page (`surface`, `link`, `daemon`, `mirror`, `session`, `surface map`); all six are defined here.

Definitions re-sourced from the finished pages, where the old wording no longer matched:

| Term | Now follows |
| --- | --- |
| Cell, Collection, Stream, Event, Procedure | `ref-surface` "The five member kinds" and `why-surfaces` "Why four primitives, not one" |
| Group | `ref-surface` `Surface<S>` (one `Rpc` per member verb, tagged `<tagPrefix><member>/<verb>`) |
| Dispatch | `ref-surface` `SurfaceDispatch` |
| Watchdog | `ref-surface-app` (a wire link's liveness heartbeat) |
| Daemon, Daemon spine, Frozen control core | `the-daemon-spine` |
| Pid gate | `ref-surface-daemon` (the gate is claimed per daemon home) |
| Supervisor | `ref-surface-supervisor` ("the client half … runs in the client process, never the daemon") |
| Baked identity | `bake-an-identity` (`readBakedIdentity` returns `{ staleKey, navigableCommit }`) |
| Contract version and build id | `surface-daemon-invariants` "Contracts are ordered" and "Builds are match-only" |
| Mirror, Pump and re-serve | `the-server-half`, `mirror-over-ssh` |
| Session | `ref-surface-remote` "The session" (`makeSession` plus a connector) |
| Surface map, `entries`, entry and `useEntry` | `the-client-half`, `ref-surface-map` "The client" |
| EntryStatus, Fold envelope, Clock seam | `entry-contracts`, `ref-surface-map` |
| kolu, kaval, drishti, odu, padi | `why-surfaces` "The same shape, everywhere"; padi's drain policy from `recycle-and-upgrade` |

## Links

Each link was re-checked against the page it points at now. Page-level links are unchanged; these point at a heading that exists today:

| Term | Target |
| --- | --- |
| Cell, Collection, Stream, Event, Procedure | `/surface/ref-surface#the-five-member-kinds` |
| Dispatch | `/surface/ref-surface#surfacedispatch` |
| Session | `/surface/ref-surface-remote#the-session` |
| `entries` | `/surface/ref-surface-map#entries` |
| entry and `useEntry` | `/surface/ref-surface-map#useentrykeyaccessor` |
| KeyCodec | `/surface/ref-surface-map#keycodeck` |
| Clock seam | `/surface/entry-contracts#why-the-clock-is-per-entry` |

## Moved

Nothing moved off this page. The definitions stay here: the fact-homes table gives Surface term definitions to `glossary`, and every other page links its first use instead of redefining the word.

## Cut

| Fact | Tag |
| --- | --- |
| "On by construction" (watchdog) | house rhetoric |
| "which is why swapping transports never touches a call site" (dispatch) | duplicate (`choose-a-link` "Swap a link without touching call sites") |
| "Changing it is changing the wire" (group) | duplicate (`why-surfaces` "The cost, named honestly") |
| The second dashed aside on `procedures` ("— the imperative escape hatch"), kept as a plain sentence | house style (rule 14) |
| "absence from it means 'not a member'" quoted phrasing (`entries`) | duplicate phrasing (the plain sentence says the same) |
| "the daemon exemplar", "the multi-host exemplar" (kaval, drishti) | house rhetoric (replaced by what each one is) |
| "a drain-capable recycle" (padi) | implementation jargon (replaced by what the policy does) |
| Emphasis italics on *once*, *same*, *happened*, *do*, *true*, *show*, *never changes shape*, *before*, *ordered*, *match-only*, *local copy*, *not* | house style (rule 16) |

## Dropped code spans

`.waterfall/compare.mjs`: 0 missing.
