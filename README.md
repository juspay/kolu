# kolu

> கோலு — the Navaratri tradition of arranging figures on tiered steps.

Web-based terminal multiplexer organized around repos and branches. Full-stack Rust (Leptos CSR + Axum).

> [!IMPORTANT]
> Work in progress. Not yet usable.

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
- **E2E tests**: GitHub Actions on ubuntu-latest, gated on Vira signoff for PRs

## Architecture

Three-crate Cargo workspace:

- `common/` — shared types, no platform-specific deps
- `server/` — Axum HTTP server, serves static WASM client
- `client/` — Leptos CSR app, compiled to WASM via Trunk (dev) or crane (prod)

Styling: [Tailwind CSS](https://tailwindcss.com/) standalone CLI — no Node required for builds.
