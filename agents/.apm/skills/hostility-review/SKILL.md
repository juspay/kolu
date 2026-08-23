---
name: hostility-review
description: >-
  Audit an implementation against its plan with a hostile peer agent, debate
  findings to consensus, and drive fix waves until the auditor runs dry. Use
  when a done-claim needs verification the implementer cannot game ("hostile
  review", "adversarial audit", "is this PR faithful", "find the escape
  hatches") — the loop that beats the laziness bias with its own game theory.
---

# Hostility review — done is the auditor's empty round

Reviews fail when author and auditor share an incentive: both want "done".
This loop splits them. Five moves; the mechanics live in `/kolu`.

1. **Fresh hostile eyes, zero stake.** The auditor is a different model that
   never saw the brief and doesn't answer for the outcome. It audits the diff
   against the PLAN — not the code against itself — seeded with the ledger of
   previously named cheats. Evidence discipline: every finding cites the code
   and quotes the plan sentence it violates. No vibes.

2. **Verify, then debate.** Trust no finding and no rebuttal: check each
   against the code yourself, concede what's real, refute with evidence,
   loop to consensus per finding. Judgment forks go to the human; evidence
   disputes never do.

3. **Fix waves with predicates.** Each consensus becomes a wave brief whose
   done-whens cannot be satisfied by their letter: greps that return nothing,
   mutations actually performed and observed red, type-level pins. A test
   seam never widens a public API. A claim without its executed check is
   a finding.

4. **Loop until dry.** The implementer's "done" triggers a re-audit of the
   pushed delta — including fresh residue the fixes introduced, and whether
   a fix merely relocated the defect. The campaign ends only on the
   auditor's clean round.

5. **Ratchet and scope.** Every named cheat joins the ledger (the next run
   starts smarter) and graduates, where possible, into a permanent check —
   yesterday's judgment is tomorrow's red build. The graduated check is the
   weakest predicate that still catches the named cheat — a broader one makes
   tomorrow's red build a false one (arXiv:2301.12987). Effort follows worth:
   framework surface, then production semantics, then app tests — a guard
   of a guard is rarely worth a wave.
