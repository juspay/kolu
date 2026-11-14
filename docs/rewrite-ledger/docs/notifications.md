# notifications

- Kind: how-to. Reader: someone running several agents who wants to know which one is waiting, and where.
- Rewritten from: `f50641c6a`
- Words: 1,241 → 916 (`.waterfall/words.mjs`). The plan's target is 800; about 110 words of the page are the agent-state table it did not carry before (see Moved in), so the rewritten old material is near 805.
- Frontmatter: description 268 → 146 characters. `order`, `section`, `koluHero` unchanged.
- Second source: `website/src/content/docs/agent-detection.mdx` (state vocabulary and the pre-session states), for the facts this page now owns.

## Headings

| Old | New |
| --- | --- |
| (none) | What each agent state means |
| One vocabulary, everywhere | The three counts · What a host tab shows · What counts as active |
| Beyond the app | Chimes and OS notifications · Turn the alerts off |
| Across machines | Across machines |
| Next | Next |

No page, changelog entry or README links into this page's headings (`.waterfall/anchors.md` lists none), so no link needed updating.

## Moved in

- What each agent state means to the user (thinking, tool use, awaiting you, working, waiting; and that starting and ready raise nothing) → this page, "What each agent state means", per plan §4. `agent-detection` keeps how each state is detected.
- From `dock`: what each agent state means to you. Covered by the same table.
- From `troubleshooting`: what a state means for each first-class agent. The meanings are the five states in the table; which agent can report which state stays on `agent-detection`, which owns detection.
- From `conductor`: what a needs-you question does across the app. On this page in "Chimes and OS notifications" (the Conductor bullet).

## Cut

| Fact | Tag |
| --- | --- |
| A host-tab count that appeared and vanished made the tab grow and shrink, shoving later tabs sideways | rationale |
| "'Active' means what the marks mean": the rust count is the same question a moving mark answers, argued at length | rationale |
| "A count that held steady while the marks beneath it blinked would be the older, worse behaviour wearing a calmer face" | history |
| "If three marks are moving, the count above them says three" | duplicate |
| A terminal running a build has no agent to ask, so its output is the only evidence there is | rationale |
| The parenthetical exception "a host tab shows active as a running stripe", stated before the table | duplicate (its own heading says it) |
| The row wash drawn out: tinted background, lit leading stripe, bold title | visible on screen |
| A prompt settling right after a finished turn may still carry the *finished* wording | implementation |
| "There is no second mechanism and no separate switch" for the Conductor's chime | rationale |
| Attention alerts survive "however old your install is" | history |
| "The needs-you signal is a first-class part of the multi-host story" | rationale |
| Clicking a host tab's violet pill jumps to the waiting agent | duplicate (stated once, for pills) |
| Aside: switching hosts or opening and closing terminals never manufactures a phantom alert; a brief flicker between states will not ding twice; a parked review prompt will not ding again per visit; pure resize or reveal repaints never count as work | implementation |
| Aside: idle TUI redraws after finish do not re-chime | duplicate (said in the notification list) |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 3 missing, all first-column table entries whose wording changed, not facts.

| Entry | Where it went |
| --- | --- |
| `Needs you — an agent is blocked on your input` | row kept as "**Needs you**, an agent blocked on your input" |
| `Unread — an agent finished and you haven't looked` | row kept as "**Unread**, an agent finished and you have not looked" |
| `Active — something is happening in a terminal` | row kept as "**Active**, something is happening in a terminal" |
