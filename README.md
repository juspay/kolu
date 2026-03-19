<p align="center">
  <img src="client/favicon.svg" width="64" alt="kolu icon" />
</p>

# kolu

> கோலு — the Navaratri tradition of arranging figures on tiered steps.

Seamless parallel development across repos and branches — switch context in one click. Optimized for AI-assisted workflows.

> [!IMPORTANT]
> Work in progress. See the [implementation plan](docs/plans/000-KOLU.md).

## Development

Requires [Nix](https://nixos.asia/en/install) with flakes enabled.

```sh
nix develop     # enter devshell
just dev        # run server + client with hot reload
just test       # e2e tests (Playwright)
```

## Production

```sh
nix build       # build server + WASM client
nix run         # serve on 0.0.0.0:7681
nix run -- --host 127.0.0.1 --port 8080  # custom bind
```

## CI

- **Nix build**: [Vira](https://vira.nixos.asia) on self-hosted NixOS runners (x86_64-linux, aarch64-darwin)
- **E2E tests**: local via `just ci` — runs Playwright and posts `signoff/e2e` commit status to GitHub

```sh
just ci         # run e2e + post signoff (requires clean worktree)
just test       # run e2e only, no signoff
```

Merging to `master` requires all three signoffs: `signoff/vira/x86_64-linux`, `signoff/vira/aarch64-darwin`, `signoff/e2e`.

## Architecture

Three-crate Cargo workspace:

- `common/` — shared types, no platform-specific deps
- `server/` — Axum HTTP server, serves static WASM client
- `client/` — Leptos CSR app, compiled to WASM via Trunk (dev) or crane (prod)

Styling: [Tailwind CSS](https://tailwindcss.com/) standalone CLI — no Node required for builds.
