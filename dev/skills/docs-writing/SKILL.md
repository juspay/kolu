---
name: docs-writing
description: The writing standard for every page on kolu.dev — the product docs (website/src/content/docs) and the Surface framework docs (website/src/content/surface). Shape limits the build enforces, the review rules beside them, the reference-entry template, and two worked before/after samples. Load before writing or editing any docs page.
---

# Writing kolu.dev docs

Every page in `website/src/content/docs/` and `website/src/content/surface/` is held to this standard. Rules marked **[lint]** are enforced by `website/test/docs-lint.test.mjs`, which runs in `just website::check` and in the website's Nix build. There is no exemption list and no per-page override. If a rule is wrong, change it here and in the lint, for every page.

## When you change a page

Edit the page so it stays true. Do not append a paragraph describing your change, and do not grow a table cell. History belongs in the changelog, not on the page. A new fact goes where a reader looks for it: a row in an existing table, an item in an existing list, or a sentence in the section that owns the topic.

## The reader

1. **One page, one reader, one job.** Every page is one Diátaxis kind: tutorial, how-to, reference or explanation (see the `/diataxis` skill). Content for a different reader moves to the page that owns it, and is linked.
2. **Write for someone using kolu, not someone who built it.** Keep what the reader can see, do, or must know to predict what happens — including limits and failure messages. Cut history ("used to", "is gone"), why a design was chosen (unless the reader has to choose something), how it is implemented, and descriptions of looks the screen already shows.
3. **Order by the reader's questions:** what is it → how do I start → how do I use it → what can go wrong → reference detail. The first screen answers the first two.

## Shape

4. **Opening paragraph ≤ 50 words:** what this is and what you do with it. No history.
5. **Paragraphs and list items ≤ 80 words. [lint]**
6. **Table cells ≤ 40 words. [lint]** A cell that needs more becomes an entry under its own heading.
7. **≤ 300 words of running text under one heading. [lint]** Tables, `<Steps>` and code do not count.
8. **A page ≤ 2,500 words of running text. [lint]** A page that cannot fit is split. Surface reference pages are exempt (see the variants below).
9. **Three or more parallel things with attributes go in a table or a list**, never inside one sentence. A sequence the reader performs goes in `<Steps>`.
10. **No paragraph opens with a bold run-in. [lint]** Use a heading, a list or a table. A list item may open with a bold term.
11. **Headings say what the reader finds or does** ("Open the Conductor", "What wakes it"), in words the reader would search for. The test: someone who reads only the table of contents can say where each answer is.
12. **At most two `<Aside>`s per page**, for cautions and limits only, ≤ 50 words each.

## Sentences and words

13. **No sentence over 40 words [lint]**; aim for an average under 20.
14. **At most one em-dash and one semicolon per sentence. [lint]** A pair of dashes around an aside counts as two: use parentheses or commas. The lint reads `--` as a dash too, since the site renders it as one.
15. **Second person, present tense, active voice.** "You press…", "kolu shows…".
16. **Bold is for words the reader sees on screen** (button and menu labels) and for a term at the point it is defined. Never for emphasis. No ALL-CAPS for emphasis either.
17. **Plain words first.** An internal name (a package, a daemon, a tool id, a protocol) appears only if the reader types it or sees it, and is explained once in a short clause. Pick one word per thing and keep it.
18. **No history words:** `used to`, `until now`, `previously`, `formerly`, `is gone`, `that is a fix`.
19. **Frontmatter `description` is one sentence, ≤ 160 characters. [lint]** It becomes the search snippet and the share card.

## Facts

20. **One fact, one home.** Another page that needs it gets at most two sentences and a link.
21. **Nothing is invented.** Every sentence traces to the code or to what the page said before. Where the old text is unclear, read the code. If code and page disagree, the code wins. The Conductor's in-app help (`packages/client/src/conductor/helpContent.ts`) must agree with the `conductor` page.

## House style

Small choices a reader notices when they change from page to page. Every page makes them the same way.

22. **Spelling is British, with -ize (Oxford):** colour, behaviour, centre, grey, dialled, cancelled, labelled; organize, recognize, normalize, summarize. Identifiers, code, commands, product names, quoted messages and on-screen labels stay exactly as written, and so does Nix's own term *realise* (`nix-store --realise`).
23. **One verb per pointer.** You press a key, click a control (a button, a tab, a row, a link) and tap only where the text is about a touch screen. A control you can click is "clickable", never "pressable".
24. **One way to write a shortcut**, the way `keyboard-shortcuts` does: one `<kbd>` per key, modifiers as words (Cmd, Ctrl, Super, Alt, Shift, Enter), joined by ` + `. Where the platforms differ, name both: `<kbd>Cmd</kbd>/<kbd>Super</kbd> + <kbd>K</kbd>`. No ⌘ ⇧ ⌥ ⏎ glyphs in a keycap and no bare "Ctrl+K" in text. A label the screen itself draws with a glyph (**Turn on ⏎**) is quoted as the screen draws it.
25. **kolu is lower case**, also at the start of a sentence or a heading. A name the screen shows with a capital (an on-screen label, a menu item) is quoted as it appears.

## Variants for the Surface docs

The lint thresholds apply to the Surface collection as they are, with one exception. The other differences are review rules.

| Rule | Product docs | Surface tutorials, how-tos, explanations, glossary, index | Surface reference (`section` ends in "Reference") |
| --- | --- | --- | --- |
| 5, 6, 7, 10, 13, 14, 19 [lint] | as written | as written | as written |
| 8 — page ≤ 2,500 words [lint] | applies | applies | Does not apply. A complete record is as long as the API. The lint reads the kind from `section`. |
| 2 — cut rationale and implementation | cut | Explanation pages keep the "why". Tutorials and how-tos link to it. | No API fact is cut. Argument for a design moves to the matching explanation page. |
| 3 — order | reader's questions | tutorial: one path to a visible result. How-to: the task's steps. Explanation: the decision and its cost. | mirrors the package: one entry per export |
| 17 — internal names | avoided | API names are the subject. Each framework term is defined once, in `glossary`, and linked on first use. | same |
| 18 — history words | none | Only in an explanation page, where an incident is the reason for a design: one short passage with its PR link. | none |

An API fact is an export, a signature, an option, a default, an error tag, an invariant or a constraint.

### The reference entry

Rule 7 gives a reference page its shape: every export gets its own `###` heading. Each `##` group opens with an index table — export · subpath · one line — whose first column links to the entries, because the on-page table of contents lists only `##` headings. Every entry uses the same order, omitting parts that do not apply:

1. Heading: the export, in code font.
2. One sentence: what it is.
3. Signature or `<Snippet>`.
4. Options or members: a table, one line each.
5. Behaviour and constraints: a list of facts.
6. Errors.
7. "Why" as a link to the explanation page.

One package has one reference page. Pages are not split.

## Sample: a guide passage

**Before** (`conductor`, one paragraph, 290 words):

> **What wakes it.** Seven things, and the wake says which. **ready** — a watched terminal's agent has come up and has not been told anything yet; this is what covers the seconds (or the minutes, behind a `nix develop`) between creating a terminal and the agent in it being there to talk to, so the Conductor creates, ends its turn, and says the brief when the terminal rings ready. It rings the moment kolu reads the agent as ready — up, its screen settled, never prompted — which kolu knows from the agent's process alone, before the agent has written anything to disk; and in the one case that is not a fresh launch, an agent the Conductor finds already idle in a terminal it has never spoken to (a resumed session), it rings on that. **stopped** — … A plain shell nobody watched never wakes it, and there is **no timer**: nothing wakes the conversation because time passed.

**After** (about 150 words):

> ## What wakes it
>
> The Conductor does not sit waiting on a terminal. It says what it is watching and ends its turn. kolu starts its next turn when one of these happens in a watched terminal:
>
> | Wake | What happened |
> | --- | --- |
> | `ready` | An agent has started and has not been prompted yet. Also sent for an idle agent the Conductor has never spoken to, such as a resumed session. |
> | `stopped` | An agent the Conductor has spoken to finished its turn. |
> | `asking` | The agent stopped to ask a question. |
> | `gone` | The terminal was closed, or its host left. |
> | `asleep` | The terminal was put to sleep. Sent once; the terminal stays on the watch list. |
> | `exited` | The agent quit or crashed, and the terminal is back at its shell prompt. |
> | `ended` | A `run` command finished and no agent ever appeared. |
>
> Nothing wakes the Conductor just because time passed, and a plain shell it is not watching never wakes it.

What changed: the list of seven moved out of a sentence into a table, the bold run-in became a heading, and one mechanism ("kolu knows from the agent's process alone") moved to the page that owns it, as a link.

A smaller case, showing rule 2. Before: "The model you choose **survives a restart**. That is a fix rather than a given: the agent re-asserts its own default over a resumed conversation, so kolu records the switch and re-applies it when the conversation comes back." After: "The model you choose survives a restart."

## Sample: a reference entry

**Before** (`ref-surface-remote`, one table cell, 120 words):

> | `unixSocketConnector(opts)` | `.` | the unix-socket `Connector`: dial a daemon already listening on a path **on this box** and wire the socket to a typed client. Opts are `{ socketPath, group, client, describe }` — `socketPath` is a THUNK because a daemon's path comes from its environment and a connector that captured it once would keep dialling a stale one. It OWNS the socket it dials (handed to `socketDuplexLink` as both halves), so the socket's own `close` resolves the connection's `closed` and the session notices its daemon die — which dialling through `unixSocketLink` would not give it. A dial answering `ENOENT`/`ECONNREFUSED` throws `EndpointAbsentError` — a `ConnectError` SUBCLASS, so every `instanceof ConnectError` path still classifies it, carrying the one extra fact that nothing is serving that path |

**After** — one row in the group's index table, and an entry:

> | [`unixSocketConnector(opts)`](#unixsocketconnectoropts) | `.` | Dials a daemon listening on a unix socket on this machine. |
>
> ### `unixSocketConnector(opts)`
>
> The unix-socket `Connector`. It dials a daemon that is already listening on a path on this machine, and wires the socket to a typed client.
>
> Options: `{ socketPath, group, client, describe }`.
>
> - `socketPath` is a thunk (a function that returns the path), not a string. A daemon's path comes from its environment, so a path captured once could go stale.
> - The connector owns the socket it dials: it hands it to `socketDuplexLink` as both halves. The socket's own `close` therefore resolves the connection's `closed`, and the session notices when its daemon dies. Dialling through `unixSocketLink` does not give you that.
> - A dial answered with `ENOENT` or `ECONNREFUSED` throws `EndpointAbsentError`. It is a subclass of `ConnectError`, so every `instanceof ConnectError` check still matches it. It adds one fact: nothing is serving that path.

Every fact and every code span of the old cell is still there. That is what "shape work, not cuts" means.

## Before you commit a page

- `cd website && node --test --test-name-pattern=<slug> test/docs-lint.test.mjs` — the lint for that page.
- `just website::build`, then `just website::linkcheck` — every internal link and `#anchor` in the built site resolves.
- Renamed a heading? Grep `website/src`, `README.md`, `packages/` and `docs/atlas/src` for the old anchor and update every link in the same change. These anchors are linked from outside the site and their headings stay verbatim: `/agents#how-profiles-stack`, `/agents#restarting-a-terminal-onto-the-current-agents`, `/surface/ref-surface#per-face-expose-kolusurfaceexpose`, `/surface/bake-an-identity#2-derive-the-fileset--dont-list-it`, `/surface/publish-content-addressed#how-the-cache-is-pushed`, `/surface/why-surfaces#why-four-primitives-not-one`. So does `/remote-hosts#port-forwarding`, which a changelog heading names.
