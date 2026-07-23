---
description: Surface library API changes must be mirrored to the drishti consumer
applyTo: "packages/{surface,surface-app,surface-remote}/**"
---

## Surface libraries are shared — mirror API changes to drishti

`@kolu/surface` and its sibling libraries (`@kolu/surface-app`, `@kolu/surface-remote`) are not kolu-internal: they are consumed by [`drishti`](https://github.com/srid/drishti) as well as kolu.

**Any API-facing change** to `packages/surface/`, `packages/surface-app/`, or `packages/surface-remote/` — exported types, function signatures, the oRPC contract shape, package `exports`, runtime behaviour a consumer depends on, or anything else that changes how a downstream consumer wires these packages — **requires a corresponding PR to [`github.com/srid/drishti`](https://github.com/srid/drishti) that updates drishti for the change and passes full CI.**

- Open the drishti PR before (or alongside) merging the kolu change, and link the two PRs to each other. **Cut and keep the pair branch on CURRENT drishti master**: `git fetch origin` and branch off `origin/master` at open — never a stale local `master` — and merge `origin/master` into the pair branch again at **every** repin, confirming GitHub reports it `MERGEABLE` before calling it ready. The recorded failure: a pair PR (drishti#107) cut off a stale base reached the human CONFLICTING — unmergeable at the exact moment it was needed.
- The drishti PR is not optional and "done" is not "done" until drishti's CI is green against the new surface API.
- **The gate is only satisfied against the *final* kolu HEAD — re-validate it after any post-gate edit that touches the surface API.** A drishti CI green pinned to a pre-gauntlet SHA is **stale**: the review gauntlet (lens/debate/police) and CI fix-commits routinely reshape the shared API *after* the gate first passed — e.g. a gauntlet fix dropping a parameter (`pumpRemoteSurface`'s `makeSink` client arg) silently breaks drishti's consumer (`(_client, {seq})` → `({seq})`), which a gate validated at the earlier SHA never caught. Whenever the surface API moves after the gate was last green, bump the drishti PR's pin to the final kolu HEAD and re-confirm its CI is green there before calling it done.
- Purely internal changes (private helpers, tests, comments, refactors with no observable API delta) do not need a drishti PR.

## The third consumer — odu rides a loose pin, and pays with a verdict

[`odu`](https://github.com/juspay/odu) also consumes `@kolu/surface*`, but **deliberately loosely**: it pins kolu by npins and absorbs changes at its own pin bumps — there is **no per-PR odu pair** (three-repo lockstep was considered and rejected; drishti is the tight twin because it tracks kolu master continuously). The recorded failure this section exists to prevent: a whole campaign of surface changes accumulated with **zero odu-impact accounting**, so nobody knew what the eventual bump would break until it was scheduled.

- **Every PR the drishti gate applies to also posts an ODU-IMPACT VERDICT in its body** — one of `breaks-at-bump` / `adoption-opportunity` / `none`, each grounded by an actual grep of odu's tree at its **pinned** kolu SHA for consumption of the changed exports (a verdict without the grep is hollow).
- **Any non-`none` verdict is appended as a line item to the standing ledger — [odu#43](https://github.com/juspay/odu/issues/43)** — naming the kolu PR, the affected odu site, and the verdict. The ledger, not memory, is what the next pin bump drains.
- **A `breaks-at-bump` item makes the next bump schedulable work, not someday-work** — the coordinator surfaces it; the bump PR's body checks off every drained line item.
