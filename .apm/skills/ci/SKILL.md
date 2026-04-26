---
name: ci
description: Run kolu CI — orchestrate steps, post commit statuses, verify completeness. Triggers on "run CI", "check CI", "CI failed", "retry CI", "build and test".
---

# Kolu CI

Orchestrate kolu's CI. Follow the protocol in `.claude/skills/ci-runtime/SKILL.md` (preflight → plan → execute in parallel via subagents → verify → summarize). Use the shims at `.claude/skills/ci-runtime/scripts/ci-{status,ssh,log,preflight,verify}`. Never call `gh api` directly.

## Steps

| Step              | Command                                                                                                                                        | depends_on   | system           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------- |
| `fmt`             | `just fmt-check`                                                                                                                               |              |                  |
| `typecheck`       | `just check`                                                                                                                                   |              |                  |
| `biome`           | `pnpm exec biome lint .`                                                                                                                       |              |                  |
| `unit`            | `just test-unit`                                                                                                                               |              |                  |
| `apm-sync`        | `just ai::apm-sync`                                                                                                                            |              |                  |
| `pnpm-hash-fresh` | `bash -c 'nix build .#pnpmDeps .#website-pnpm-deps --no-link && nix build --rebuild .#pnpmDeps .#website-pnpm-deps --no-link'`                  |              |                  |
| `nix`             | `nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .`                                                    |              |                  |
| `home-manager`    | `nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake ./nix/home/example --override-input flake/kolu .`     | `nix`        |                  |
| `e2e`             | `just test`                                                                                                                                    | `nix`        |                  |
| `nix-darwin`      | `nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .`                                                    |              | `aarch64-darwin` |
| `e2e-darwin`      | `just test`                                                                                                                                    | `nix-darwin` | `aarch64-darwin` |

Lints (`fmt`, `typecheck`, `biome`, `unit`, `apm-sync`) run only on local (headless linux). They're platform-independent — duplicating on darwin would burn compute for no signal.

## Project notes

- **`pnpm-hash-fresh` requires two builds.** The first realizes the path; `--rebuild` then forces re-execution to detect a stale cached artifact at the declared hash. See `default.nix` pnpmDeps comment.
- **`home-manager` and `e2e` both depend on `nix`.** Within a single CI run the nix output is cached, so they don't re-build.
- **Flaky e2e:** if a test fails once but passes on retry, comment on [#320](https://github.com/juspay/kolu/issues/320) with scenario, platform, error excerpt, PR link.
