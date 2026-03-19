# kolu

> கோலு — the Navaratri tradition of arranging figures on tiered steps.

Web-based terminal multiplexer organized around repos and branches. Full-stack Rust (Leptos CSR + Axum).

## Development

Requires [Nix](https://nixos.org/) with flakes enabled.

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

## Architecture

Three-crate Cargo workspace:

- `common/` — shared types, no platform-specific deps
- `server/` — Axum HTTP server, serves static WASM client
- `client/` — Leptos CSR app, compiled to WASM via Trunk (dev) or crane (prod)

Styling: [Tailwind CSS](https://tailwindcss.com/) — standalone CLI, no Node dependency for builds.
