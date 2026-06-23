---
description: Surface library API changes must be mirrored to the drishti consumer
applyTo: "packages/{surface,surface-app,surface-nix-host}/**"
---

## Surface libraries are shared — mirror API changes to drishti

`@kolu/surface` and its sibling libraries (`@kolu/surface-app`, `@kolu/surface-nix-host`) are not kolu-internal: they are consumed by [`drishti`](https://github.com/srid/drishti) as well as kolu.

**Any API-facing change** to `packages/surface/`, `packages/surface-app/`, or `packages/surface-nix-host/` — exported types, function signatures, the oRPC contract shape, package `exports`, runtime behaviour a consumer depends on, or anything else that changes how a downstream consumer wires these packages — **requires a corresponding PR to [`github.com/srid/drishti`](https://github.com/srid/drishti) that updates drishti for the change and passes full CI.**

- Open the drishti PR before (or alongside) merging the kolu change, and link the two PRs to each other.
- The drishti PR is not optional and "done" is not "done" until drishti's CI is green against the new surface API.
- **The gate is only satisfied against the *final* kolu HEAD — re-validate it after any post-gate edit that touches the surface API.** A drishti CI green pinned to a pre-gauntlet SHA is **stale**: the review gauntlet (lens/codex/police) and CI fix-commits routinely reshape the shared API *after* the gate first passed — e.g. a gauntlet fix dropping a parameter (`pumpRemoteSurface`'s `makeSink` client arg) silently breaks drishti's consumer (`(_client, {seq})` → `({seq})`), which a gate validated at the earlier SHA never caught. Whenever the surface API moves after the gate was last green, bump the drishti PR's pin to the final kolu HEAD and re-confirm its CI is green there before calling it done.
- Purely internal changes (private helpers, tests, comments, refactors with no observable API delta) do not need a drishti PR.
