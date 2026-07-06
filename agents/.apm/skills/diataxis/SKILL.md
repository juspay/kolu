---
name: diataxis
description: Classify, write, and audit documentation per Diátaxis (diataxis.fr) — the four-quadrant method (tutorials · how-to guides · reference · explanation). Encodes the compass as a decision procedure, each quadrant's contract as hard rules, and an executable mixed-mode audit. Project-agnostic; per-repo doc-location mapping lives in .agency/diataxis.md. Use when writing any user-facing doc, structuring a docs site, or auditing existing docs for mixed modes.
argument-hint: "[classify <doc>|audit <path>|write <quadrant> <topic>]"
---

# Diátaxis — classify, write, audit

Diátaxis's claim: documentation fails when one page serves two masters. Every
doc serves exactly ONE of four needs, derived from two axes — is the reader
**acquiring** skill (study) or **applying** it (work)? do they need **action**
(practical steps) or **cognition** (knowledge)? One doc, one quadrant, always;
other modes are LINKS, never inlined sections.

**Provenance:** the compass and the four contracts quote/paraphrase diataxis.fr
(Procida); the SMELLS lists, the entry template, the audit, and the writing
procedure are THIS SKILL's operationalization — useful, but do not cite them as
Diátaxis. (Diátaxis is the needs-grounded, iterative successor of the older
Divio four-types system.) Foundation the method stands on: documentation serves
USER NEEDS, not the machinery — the four types enumerate practitioner needs:
tutorials answer "can you teach me to…?", how-tos "how do I…?", reference "what
is…?", explanation "why…?".

## The compass (two questions, one quadrant — a doubt-resolver, applicable to a whole doc OR a single sentence)

| | serves ACTION (practical) | serves COGNITION (theoretical) |
| --- | --- | --- |
| **ACQUISITION** (study — the reader is learning) | **Tutorial** | **Explanation** |
| **APPLICATION** (work — the reader is doing their job) | **How-to guide** | **Reference** |

The source's own use: reach for it "when you think you are doing one thing but
are troubled by doubt" — at document, section, or sentence level. If a doc can't
answer both questions, it has no single reader (splitting it is this skill's
procedure, not a source rule). Mixed modes blur toward map-NEIGHBOURS (tutorial↔
how-to, how-to↔reference, reference↔explanation, explanation↔tutorial) — the
sharpest mixed-mode predictor.

## The four contracts (hard rules, per quadrant)

### Tutorial — a lesson: the reader learns by DOING, and YOU own their success
- The reader is a beginner at THIS thing; you are the teacher and their success
  is your responsibility. One concrete path, start to visible result.
- RULES: deliver visible results early and often; concrete and particular, not
  general and abstract; "ignore options and alternatives" (source's words) — one
  path, no branches; minimum necessary explanation, link to Explanation instead;
  must work every time for every reader (our test method: run it cold);
  first-person plural ("we are in this together"); keep a narrative of
  expectations ("You will notice that…"); encourage and PERMIT repetition —
  "sometimes it's the only teacher".
- SMELLS: paragraphs of why; configuration choices offered; "you may want to";
  steps that assume prior setup the tutorial didn't do.

### How-to guide — a recipe: a COMPETENT user has a GOAL, get them to it
- The reader already has the skill; they have a real-world task NOW.
- RULES: name it "How to <achieve the goal>" (the goal, not the tool); a
  SEQUENCE of actions addressing the task, including its real-world variance
  (unlike a tutorial, forks for real conditions are fine); assume competence —
  no teaching, no concept-building; omit everything not needed for THIS task;
  completeness is measured by the task, not the machinery.
- SMELLS: defining terms; explaining internals; covering every option "for
  completeness"; starting from installation when the goal is elsewhere.

### Reference — a map: austere, complete FACTS about the machinery
- The reader is working and needs to LOOK SOMETHING UP; certainty and
  consistency are the product.
- RULES: describe, never instruct and never explain; structure mirrors the
  structure of the PRODUCT (code-mirroring is the auto-generated special case);
  consistent, standard patterns per entry (a uniform template like signature ·
  description · constraints · examples is OUR operationalization); examples are
  encouraged as illustration; "wholly authoritative — truth and certainty, firm
  platforms on which to stand"; austere, neutral; auto-generation from source is
  a powerful way to keep it faithful.
- SMELLS: "you should"; step sequences; design rationale; entries that exist
  only for some exports; prose that varies format entry to entry.

### Explanation — understanding: the WHY, read away from the keyboard
- The reader wants the bigger picture: design decisions, context, alternatives,
  connections, history. The only quadrant where opinion and discussion belong.
- RULES: admit perspective ("the reason this is shaped so…"); make connections
  (to other parts, to prior art, to rejected designs); no instructions, no
  obligation to be complete; the source's test — the only docs it might make
  sense to read IN THE BATH, away from the product. (Our house addition, not
  Diátaxis: end at a real decision or trade-off — teaching without a point is a
  tour.)
- SMELLS: step-by-steps; API tables; pretending neutrality about a choice the
  project deliberately made.

## The audit (executable — run over an existing doc set)

For each doc under the target path, as parallel checks (a Workflow fan-out for
large sets; direct reads for small ones):
1. **Classify:** which quadrant does its title/frontmatter CLAIM? Which does
   the compass actually assign? Mismatch = finding.
2. **Mixed-mode detection, by marker:** instruction verbs + numbered steps in
   Reference; rationale/"because"/design-history paragraphs in Tutorials and
   How-tos; API signatures/exhaustive tables in Explanation; options and
   branches in Tutorials. Each hit: quote the passage, name the quadrant it
   belongs to, propose the split (extract + cross-link — never delete the
   content).
3. **Coverage:** for each major component in scope, which quadrants EXIST vs
   are MISSING — grounded in the map's "cycle of interaction": users mature
   from study to work and back, so reference-only fails newcomers and
   tutorial-only fails practitioners. Report the grid; per the process rule
   above, the grid PRIORITIZES, it does not mandate filling every cell.
4. Disposition per Diátaxis's OWN process rule — the method "is not a plan":
   improve organically, in small responsive iterations; never create empty
   quadrant structures to fill later; every step in the right direction is
   worth publishing immediately. So: fix the worst blur first, one doc at a
   time; "recorded, next iteration" IS a valid disposition here (unlike code
   review) — but silent acceptance still isn't. Docs are "always complete,
   never finished".

## Project overlay

Read **`.agency/diataxis.md`** if it exists: where each quadrant LIVES in this
project (paths, site sections, frontmatter conventions), plus any project rules.
Missing overlay → classify/audit generically and SAY so.

## Writing procedure (every new doc)

1. Run the compass; state the quadrant (frontmatter or the doc's one-liner).
2. Write to that quadrant's contract; when another mode wants in, LINK to it.
3. Self-audit against the quadrant's SMELLS list before declaring done.
