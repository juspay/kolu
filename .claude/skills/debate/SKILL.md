---
name: debate
description: >-
  Use when the user wants a structured debate between this agent and one other
  AI agent running on a Kolu terminal — set the stance and end-state, exchange
  turns via the kolu skill, and optionally converge on a ratified ledger of
  agreed facts. With --orchestrate, this agent steps out of the debate and only
  coordinates N≥2 external agents on N terminals. Triggers on "debate <topic>
  with the agent on terminal …", "have Codex/opencode debate me", "start a
  debate", "run an LLM debate", "argue this back and forth with another agent",
  "orchestrate a debate between terminals …".
---

# Debate

Run a structured debate between this agent and **one external agent** running on
another Kolu terminal. Each debate is a directory of numbered turn-files.

With **`--orchestrate`** this agent does **not** debate — it only coordinates
**N ≥ 2** external agents on N terminals, shuttling arguments between them. See
[Orchestrate mode](#orchestrate-mode) below; the rest of this section describes
the default two-party mode where this agent is itself a debater.

## Start

1. **Ask the user** (AskUserQuestion tool) two setup questions:
   - **End-state** — converge on a ratified ledger of agreed facts, or open-ended exploration?
   - **Stance** — assigned opposing standpoints + steelman, or neutral collaborative inquiry?
2. Get the **topic** and the external agent's **terminal ID**.
3. Create `debates/<label>/01.md` and state the topic at the top.

## Layout

```
debates/<label>/
  README.md      # plain-language, heavily-formatted front page (GitHub renders this on the folder)
  concepts.svg   # optional hand-authored SVG diagram, referenced by README.md (see Conduct)
  01.md          # opening turn (topic stated at the top)
  02.md          # other agent's turn
  03.md          # ...
  conclusion.md  # agreed ledger — faithful & precise (only when converging)
```

`<label>` names the debate; turns are numbered files in order.

## Turns

- Reach the external agent with the kolu skill's **`kaval-tui send <terminalID> …`**
  (the agent type running there is auto-detected by snapshotting the terminal).
  Any agent CLI qualifies — not just Codex.
- Each turn is the **next numbered file**; never rewrite another participant's file.
- **Hand off explicitly:** after taking a turn, ping the other terminal with
  `kaval-tui send` so it knows to proceed. Do **not** use `pulam-tui` or any
  done-signal polling — the agents prompt each other directly with `kaval-tui send`.
- Keep prompts to the other agent **short and unbiased** — don't leak your own
  argument when asking for theirs.
- Cite grounding sources inline when the topic has an authoritative reference.

## Conduct

- Steelman before rebutting; concede what's genuinely true; forge new insight.
- End per the chosen end-state. When converging, write **two** files:
  - `conclusion.md` — the faithful ledger: every agreed claim, every amendment, and every
    open question, in precise wording. This is the record.
  - `README.md` — a plain-language, scannable **front page** for the debate folder (GitHub
    renders it when someone opens the directory). It introduces the debate — a one-line
    orientation linking the turns and `conclusion.md` — and restates the result for a
    general reader. It changes *presentation only* — never alter, weaken, or drop a
    conclusion or open item from `conclusion.md`. Three standing conventions:
    - **Plain language.** Translate jargon and terms of art into everyday words (gloss or
      footnote any that must stay); short sentences, concrete examples, a practical voice.
      No arcane prose.
    - **Liberal Markdown for glanceability.** Use the full toolkit — a metadata table, an
      at-a-glance summary table, GitHub alerts (`> [!TIP]`/`[!NOTE]`/`[!WARNING]`/
      `[!IMPORTANT]`), bold lead-ins, ordered/unordered lists, blockquotes, horizontal
      rules, and footnotes for citations — so a reader can grasp it at a glance.
    - **Visual explanation with SVG (when it helps).** Where a flow or set of relationships
      is clearer shown than told, hand-author an **SVG diagram**, commit it as a file in the
      debate folder (e.g. `concepts.svg`), and reference it from the README as a markdown
      image (`![…](concepts.svg)`). GitHub strips inline `<svg>` from markdown, so link a
      committed `.svg` file rather than pasting raw SVG into the page. Give it an explicit
      background and high-contrast labels so it reads in both light and dark themes, keep it
      legible at normal width, and make it agree with `conclusion.md` — a diagram adds no new
      claims.
- Debates are not published externally.

## Orchestrate mode

Opt in with **`--orchestrate`**. In this mode **this agent never contributes an
argument** — it is purely a turn-coordinator for **N ≥ 2** external agents, each
on its own terminal. The terminals share this repo's working directory, so each
agent **reads the others' turn-files and writes its own** by path; this agent
only sequences the rounds with the kolu loop (`kaval-tui send` → settle →
`snapshot`) and verifies each turn-file landed. The two setup questions
(end-state, stance) and the whole **Conduct** section still apply.

### Setup

1. Ask the two setup questions (end-state, stance) as usual.
2. Collect the **N terminal IDs** and give each agent a short **identifier**
   (e.g. `foo`, `bar`, or the agent CLI's name). Identifiers must be unique and
   filename-safe.
3. Write `debates/<label>/topic.md` (the shared prompt, stance assignments, and
   any grounding sources) and `debates/<label>/participants.json` mapping each
   identifier to its terminal ID and a human label.

### Layout

```
debates/<label>/
  participants.json   # identifier → { terminal, label }
  topic.md            # shared prompt + stance assignments + grounding sources
  01.foo.md           # round 1, agent "foo"
  01.bar.md           # round 1, agent "bar"
  02.foo.md           # round 2, agent "foo"
  02.bar.md           # round 2, agent "bar"
  ...
  conclusion.md       # agreed ledger (only when converging)
  README.md           # front page (see Conduct)
```

Turn files are **`<NN>.<identifier>.md`** — two-digit round number, then the
agent's identifier. A **round** is complete once all N agents have written their
`<NN>.*` file.

### Round cycle

For each round `k` (`01`, `02`, …):

1. **Prompt each agent.** Round 1: point the agent at `topic.md` and its assigned
   stance, and tell it to write its opening turn to `debates/<label>/01.<id>.md`.
   Round `k>1`: tell the agent to **read the N−1 other agents' round `k−1`
   files** (`debates/<label>/<k−1>.*.md`, excluding its own) so it sees every
   opposing argument, then write its reply to `<k>.<id>.md`. Pass file paths, not
   pasted argument text — the agents read and write the shared directory directly.
2. **Drive and confirm.** `kaval-tui send` the prompt, send `--key Enter`, wait
   for the screen to settle, then `snapshot` to confirm the agent finished and
   **verify `<NN>.<identifier>.md` now exists** on disk (see the kolu skill's
   *Acceptance*). Each agent owns its own file; never write another's.
3. Advance to round `k+1` once all N round-`k` files exist.

- Keep every prompt **short and unbiased** — point agents at each other's files,
  but inject **none of your own** argument. As orchestrator you sequence turns,
  you don't take part.
- Drive the N terminals within a round **independently** (they don't need each
  other's *current*-round turn, only the previous round's), so a round can fan
  out concurrently and only barrier at the round boundary.
- End per the chosen end-state. When converging, you may synthesize
  `conclusion.md` and `README.md` from the recorded turns — that synthesis is
  scribe work (a faithful summary of what the agents agreed), not a new argument.

## Deferred

- A **converging-tree** topology (agents splitting into sub-debates that merge),
  modelled as dotted-path turn-files (`01.01-foo.md`). Orchestrate mode keeps a
  flat round structure; the tree is not yet implemented.
