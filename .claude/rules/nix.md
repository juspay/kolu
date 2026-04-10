---
paths:
  - "**/*.nix"
---

## Nix

- **DO NOT add flake inputs** to `flake.nix`. Each input adds ~1.5s to `nix develop` cold start. The flake intentionally has zero inputs — nixpkgs and other sources are managed by [npins](https://github.com/andir/npins) and imported via `fetchTarball`. Use `npins add`/`npins update` for new or updated sources.
- **Shared env vars** live in `koluEnv` (defined in `default.nix`). Both the build and the devShell consume it — don't duplicate env var definitions.
- **Measure `nix develop` time** after Nix changes: `time nix develop -c echo test`. Current target: ~2.6s cold, ~0.3s warm.
