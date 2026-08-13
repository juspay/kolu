# PR-REVIEW — kolu #2162 (fix-2057)

Adversarial review of [PR #2162](https://github.com/juspay/kolu/pull/2162) against issue [#2057](https://github.com/juspay/kolu/issues/2057). Scope of reading: `AGENTS.md`, `CONTRIBUTING.md`, `git diff master...HEAD`, `gh pr view 2162`, `gh issue view 2057`, and the production files the diff lands in. Source was not modified (a temporary sabotage of the sticky clause was applied, observed, and reverted; the worktree is clean).

## Verdict

**No MUST-FIX.** The human's ruling holds: the failing repro predates the fix and is red on master. The arbiter's three clauses each have their own test, and sabotaging the keeps-while-candidate clause turns that test red. The alert half has its own test. Pid-anchored adapters are unchanged on the match path (grep-grounded). The `/new` tradeoff is documented in all three claimed places and the chosen side is defensible. Scope stays on dock pinning + padi session resolution (plus the adapter-contract blast radius that change requires, and the docs the repo rules demand).

Merge-blocking bar: clear. Residual notes below are NICE-TO-HAVE.

## Hunt results

### (1) The human's ruling — failing test BEFORE the fix — PASS

Commit order on `master...HEAD`:

| SHA | When | Subject |
| --- | --- | --- |
| `27e1a2e00` | 2026-08-13 00:52 | `test: reproduce #2057 — two harnesses in one project share one session` |
| `365a2904d` | 2026-08-13 01:17 | `fix: one agent session belongs to one terminal (#2057)` |
| `b0d2ff9f6` | 2026-08-13 01:18 | `docs: point the changelog entry at its PR` |
| `03e4b2a81` | 2026-08-13 01:25 | `refactor: key the candidate list once instead of per lookup` |

`27e1a2e00` is a direct child of `master` (`73af05e5f`) and adds only the two repro files. The first-commit `agentSessionOwnership.test.ts` does **not** import `sessionOwnership.ts` (that import is added by the fix commit), so it is runnable against master's production code.

Checked out `27e1a2e00` and ran the tests. Red, matching the PR body verbatim:

```
FAIL  … > gives each terminal its OWN session — never one session mirrored onto both
AssertionError: expected '019db606-…' not to be '019db606-…'
 ❯ agentSessionOwnership.test.ts:236  expect(a?.sessionId).not.toBe(b?.sessionId)

FAIL  … > leaves the FIRST terminal's row alone when a second harness starts in the same repo
Expected: "019db605-0000-7abc-89ab-0123456789ab"
Received: "019db606-0000-7abc-89ab-0123456789ab"
 ❯ agentSessionOwnership.test.ts:268  expect(one.latest()?.sessionId).toBe(before?.sessionId)
```

The paired dock file is **green** on that same commit (2/2), as the PR claims: the Dock's per-row derivation was already terminal-keyed. The convergence is upstream.

On `HEAD` (`03e4b2a81`) both padi suites and the dock file are green (11 + 2).

### (2) The arbiter — three clauses, each its own test; sabotage the sticky clause — PASS

`claimSession` at `packages/padi/src/terminalWorkspace/sessionOwnership.ts`:

- **Keeps while still a candidate** — line 93: `if (held !== undefined && candidateKeys.includes(held)) return held;`
- **Takes the best unheld otherwise** — lines 96–101: walk `candidateKeys` (adapter's best-first order), skip `ownerOf`, claim the first free
- **Reports no agent when all are held** — line 102: `return null`

Each clause has a dedicated test in `packages/padi/src/terminalWorkspace/sessionOwnership.test.ts`:

| Clause | Test | Line |
| --- | --- | --- |
| best unheld | `gives two terminals offered the SAME list two different sessions` | 22 |
| all held → null | `reports no session rather than lending out one already held` | 28 |
| keep while candidate | `keeps a held session when a newer one jumps to the front of the list` | 33 |

**Sabotage.** Deleted the early return at line 93 (left `held` unused) and re-ran both padi files.

- Isolated sticky test went red: `expected 'a-newcomer' to be 'mine'` at `sessionOwnership.test.ts:38`.
- The other eight isolated tests stayed green (exclusive and null-when-held still hold).
- The two orchestrator tests in `agentSessionOwnership.test.ts` stayed green. That is not a hunt failure — hunt (2) asked for a per-clause test and a red sabotage of *that* clause — but it is a coverage nuance: see NICE-TO-HAVE #1.

Source restored with `git checkout --`; worktree clean.

### (3) The alert half — own test, not a rider on the title one — PASS (with a caveat)

`packages/client/src/canvas/dock/dockRowIndependence.test.tsx`:

- Title / subtitle / status pip: `moves only the changed terminal's title, subtitle and status` at line 199. Does not touch unread.
- Alert: `lights the alert indicator on only the terminal that was marked` at line 217. Own `it`, own `setUnread(ALICE)`, asserts Alice unread and Bob not.

Caveat (not a hunt failure): this test is **green on master**. It stubs `unread` per terminal id and never drives `useAttention` / `awaitingIds`. It pins the Dock composition, which was never the leak. The causal alert fan-out (shared session → both terminals carry the same `agent.state` → both land in `recomputeUrgency`'s `awaitingIds` at `packages/padi/src/activity/urgency.ts:74` → `useAttention` `markUnread(id)` at `packages/client/src/attention/useAttention.ts:165`) is implied by session exclusivity, not reproduced as its own red. See NICE-TO-HAVE #2.

Production unread is terminal-keyed on every dock surface that shares the contract: `Dock.tsx:675` and `DockList.tsx:190` both read `store.isUnread(props.id)`. `useStatePip` (`statePipBind.ts:112`) looks up `facts.attentionOf(encHost(), id())`.

### (4) Pid-anchored adapters (Claude Code, Grok) unaffected — PASS (grep-grounded)

No new Claude/Grok orchestrator test in this PR. The match path is unchanged by construction:

- **Claude Code** `packages/integrations/claude-code/src/agent-adapter.ts:47–50` — `resolveSessions` returns `[]` or `[readSessionFile(state.foregroundPid)]`. No `cwd`. Two terminals cannot share a foreground pid, so the arbiter has no tie to break.
- **Grok** `packages/integrations/grok/src/agent-adapter.ts:30–33` — still `resolveGrokSession(foregroundPid, cwd)` wrapped as zero-or-one. The pid path in `packages/integrations/grok/src/core.ts:216–231` is the same acquire-by-pid / keep-after-clobber / no-cwd-guess-for-a-known-pid rule, still pinned by `packages/integrations/grok/src/core.test.ts:262` (`matches by foreground pid`), `:296` (no cwd guess for a known-absent pid), `:322` (keep after map clobber), `:348` (do not lend one pid's session to another).
- Existing Grok tests still call `resolveGrokSession`, not a new directory-list helper. Claude has no adapter test file on either side of the diff; the production function body did not grow a cwd lookup.

Nuance: Grok's *no-pid* fallback (`findLatestSessionByCwd`, `core.ts:254`) still returns a single session. Two pid-less Grok terminals now go through the arbiter, so the second gets `null` instead of the same newest session. That is exclusive-by-arbiter, not a match-rule change, and is what the rewritten Grok paragraph on the docs page describes.

### (5) Documented `/new`-inside-Codex tradeoff — PASS; chosen side is defensible

Present in all three claimed places:

| Place | Where |
| --- | --- |
| Module header | `packages/padi/src/terminalWorkspace/sessionOwnership.ts:41–50` — names `/new`, states it is indistinguishable from someone else's new session, and that sticky leaves the row on the previous thread until the agent exits |
| Docs page | `website/src/content/docs/agent-detection.mdx:120–133` (Aside covering Codex and OpenCode) and `:205–209` (Codex “What it can't detect”, names `/new` and stay-until-exit) |
| Changelog | `website/src/content/changelog/unreleased.mdx:12` — `kind="fixed"` under Agent Detection, `pr={2162}`, italic consequence names `/new` |

**Is the chosen side defensible?** Yes. Nothing on disk ties a Codex/OpenCode thread to the process that created it, so “this terminal typed `/new`” and “another harness in this directory started a thread” are the same observation. Following every new thread *is* #2057, including the issue's external-`codex` form. Sticky toward the held session is the only honest two-line rule that closes that bug. The cost (`/new` stays on the previous thread until exit) is real, rare relative to the always-on two-harness case, and stated in user-facing prose rather than buried in a comment. No override knob, no silent guess — matches the fail-fast rule.

OpenCode's “What it can't detect” bullet (`agent-detection.mdx:263–266`) states the indistinguishability but does not name `/new` or “until you exit” the way the Codex bullet and the Aside do. Covered by the Aside; see NICE-TO-HAVE #5.

### (6) Scope — client dock + padi session resolution only — PASS

Production dock code is untouched. The client change is the new pin `dockRowIndependence.test.tsx`. Session resolution is `sessionOwnership.ts` plus `sensors.ts` calling `claimSession` / `releaseTerminal`, which required `AgentAdapter.resolveSession` → `resolveSessions` and the directory-keyed adapters dropping `LIMIT 1`. Claude/Grok adapters only wrap the existing 0-or-1 match as an array. Docs + changelog are the repo's required companion to a user-facing behaviour change (`website-docs` / `changelog` rules). Comment-only rename touch-ups in `remotePadiSsh.test.ts`, `spawn_detection_steps.ts`, and `hooks.ts` follow the contract rename.

No persistent-state migration, no surface public API, no dock-fold repatriation, no streaming-member change, no new proposal required (CONTRIBUTING: bug fix that restores obvious behaviour).

## MUST-FIX

None.

## NICE-TO-HAVE

### 1. The orchestrator “second harness” test does not actually require sticky

- File: `packages/padi/src/terminalWorkspace/agentSessionOwnership.test.ts:249`
- After sabotaging line 93 of `sessionOwnership.ts`, this test stayed green. Sequence is: terminal two pokes first and claims `THREAD_TWO`, then terminal one re-pokes. Exclusive alone re-gives one `THREAD_ONE` (the newcomer is already held). Sticky is load-bearing for the *unclaimed* newcomer — an external `codex` in that directory, or `/new` with no neighbour — which is only pinned at `sessionOwnership.test.ts:33`. An orchestrator case that adds `THREAD_TWO` and re-pokes *one* with no second sensor would make the PR body's “sticky stops the external-codex takeover” claim fail-able at the same altitude as the original repro.

### 2. The unread test cannot go red if session sharing comes back

- File: `packages/client/src/canvas/dock/dockRowIndependence.test.tsx:217`
- It assigns `unread[ALICE] = true` and reads attributes. A regression that again hands both terminals the same session would leave this test green. The causal alert leak lives in `urgency.ts:74` + `useAttention.ts:165`. Not required for merge: exclusivity implies isolation, and hunt (3) only asked for a non-rider test. A red-capable pin would drive two sensors, flip one session to `awaiting_user`, and assert the other terminal's id is absent from `awaitingIds` / unread.

### 3. OpenCode's “return every session” drop is unpinned at the SQL layer

- File: `packages/integrations/opencode/src/agent-adapter.test.ts:32` (describe); contrast Codex `packages/integrations/codex/src/agent-adapter.test.ts:63` (`hands back EVERY thread in the directory, not just the newest`)
- OpenCode `core.ts:89` did drop `LIMIT 1`, but the adapter tests mock `findSessionsByDirectory` and never assert a two-row list. A `LIMIT 1` regression would not mirror (the arbiter would give the second terminal `null`) but would leave the second OpenCode row blank. Codex is the reported agent and is pinned through a real DB; OpenCode is the same bug class with a thinner pin.

### 4. Stale `resolveSession` in the Grok package README

- File: `packages/integrations/grok/README.md:8`
- Still names `resolveSession`. The contract is `resolveSessions`. Outside the PR's file list; one-line drift.

### 5. OpenCode docs bullet is a weaker restatement of the tradeoff

- File: `website/src/content/docs/agent-detection.mdx:263`
- Says sessions started inside a running OpenCode are indistinguishable; does not say the tile stays on the previous one until exit. The Aside at line 120 already covers both agents. Matching the Codex bullet at line 205 would keep the two directory-keyed sections honest in isolation.

### 6. Issue acceptance asked for expanded cards *and* the rail/mobile Dock

- File: `packages/client/src/canvas/dock/dockRowIndependence.test.tsx:114` (`renderDock` reconstructs the `DockRow` leaf composition; it does not mount `Dock.tsx` or `DockList.tsx`)
- Both production rows already share `createDockRowData(id)`, `store.isUnread(props.id)`, and `dockRowAttrs`. The diagnosis that the Dock was never the leak is sound, and hunt (6) does not require mounting every chrome. A one-line comment pointing at `DockList.tsx:190` as the rail twin of `Dock.tsx:675` would close the acceptance-criteria reading without new tests.

## Notes that are not findings

- CONTRIBUTING does not require an Atlas proposal: this restores obvious behaviour.
- `kind="fixed"` on the changelog entry is release-relative and correct (the last release shipped the directory `LIMIT 1` match).
- Simultaneous start can *swap* which terminal gets which thread (first reconciler takes newest). The PR does not claim identity-of-origin pairing — only exclusivity — and without a pid it cannot. Not a defect.
- Padi `vitest.config.ts` sets `fileParallelism: false`, so the process-wide ownership books cannot race across test files.
- `anyagent` is not a `@kolu/surface*` package; the drishti pair-PR gate does not apply.

REVIEW-DONE
