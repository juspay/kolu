# power-features

- Kind: how-to. Reader: someone already running several agents who wants transcripts, recording, and links into a view.
- Rewritten from: `f50641c6a`
- Words: 854 → 716
- Frontmatter: description 139 → 134 characters. Other keys unchanged.

## Headings

| Old | New |
| --- | --- |
| Export a transcript | Export a transcript |
| Record the workspace | Record the workspace |
| Link to any view | Link to any view |
| (the link rules, previously loose bullets) | ### What a link can and cannot do (new sub-heading, to keep the section under 300 words) |
| (the two asides) | "Focus the installed app, don't spawn a second window" → "One window, not two" |

No page links into this page's anchors, so no inbound link needed updating.

One outbound link changed: the dock card linked `/troubleshooting#i-am-not-getting-desktop-notifications`; it now links `/notifications`, the page that owns what a needs-you state means.

## Moved

Nothing was moved to another page.

## Cut

| Fact | Tag |
| --- | --- |
| "kolu is built for the moment you are running five agents at once" as a two-sentence opening | rationale |
| The needs-you row appearing "without its row moving" | visible on screen (the `dock` page owns the strip) |
| Each agent's storage normalizing to one shape (Claude's JSONL, Codex's rollout, OpenCode's SQLite, Grok's `chat_history.jsonl`), so one document design renders all four | implementation |
| Xyne's "pi-format transcript needs a kolu-side loader before the exporter can normalize it" | implementation (the page keeps that the command does not appear for Xyne) |
| "View-only by law", "Loud on the edges", "Durable, not one-shot" as headings-in-bold | rationale wording; the facts are kept in plain words |
| The PWA aside's mechanism (the manifest's `launch_handler` and the Launch Queue API) and "a link from your chat or board jumps you straight to the terminal" | implementation |
| The shell aside naming `padi` and `kaval` and "each still shipping its own preview CLI" | duplicate (the Related cards link both pages) |
| The recorder popover's live level meter and circular preview; "no matter how long you record"; "multi-surface" in the tab picker | visible on screen |

Every URL form is unchanged: `#/h/<host>`, `#/t/<host>/<id>`, `#/t/<host>/<id>/code?path=<p>` with `&line=<n>`, `#/t/<host>/<id>/inspector`, `#/settings`, and the `local` / `remote:<target>` host key.

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 4 missing.

| Span | Where it went |
| --- | --- |
| `chat_history.jsonl` | cut, implementation (per-vendor storage) |
| `launch_handler` | cut, implementation (PWA aside) |
| `padi`, `kaval` | cut, duplicate; both pages are still linked from the Related cards |
