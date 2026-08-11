# Why /be's rules exist — read when editing this skill, not when running it

Incident ledger behind the SKILL.md rules. Each entry is why a clause survives
edits; the full stories live in git history and the sessions cited by
`/self-improve` PRs.

- **Interruptions resume unasked; an in-flight step restarts.** A §4 gauntlet
  interrupted to chase a field bug was never restarted, and the run described
  the diff as hickey-reviewed when hickey never ran. The same run needed
  "continue with /be" three times in seventy seconds plus a hand-installed
  Stop hook before §5 finished.
- **Subagent briefs say "execute now".** Delegated subagents don't inherit the
  interview's no-stopping contract — a plan-shaped brief gets a plan back with
  zero tool uses, and the human has to type "go".
- **A scripted edit must fail on a non-match.** A run applied a debate finding's
  doc fix with a `node` string-replace whose needle had drifted; `String.replace`
  no-oped, the file was rewritten unchanged, the script's own `ok` printed, and
  the `grep -c` beside it printed `0` and was read past. The run reported the
  finding fixed and the false claim survived a full debate round until the peer
  checked the tree instead of the claim. That run applied 52 scripted in-place
  edits and only 8 could have failed loudly.
- **Reproduce before theorize; inherited diagnoses are hypotheses.** A detailed
  frame-trace talked a run into ~400 lines of client-side fix against a
  mechanism the box repro then disproved — the trace came from a deleted
  session instrumenting a replica, not the real browser. Separately, a run
  answered a field bug by repainting from one sampled state value, pushed it,
  and the whole commit was reverted; the user demanded repro-before-fix three
  times in that session.
- **Heavy work on a pu box; never `pkill` by substring.** Local builds + e2e
  beside production kolu got it OOM-killed once; the cleanup `pkill -f
  <substring>` then killed it a second time — its nix-store process matched.
- **Master-sync before CI.** "Merge latest master before CI" was the single
  most repeated human interjection into otherwise-autonomous runs.
- **tsc green ≠ the artifact builds.** tsc resolves extensionless workspace
  imports that native ESM / the bundler reject, so a clean typecheck can sit on
  a `vite build` / `nix run` that doesn't build.
