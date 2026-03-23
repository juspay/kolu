<p align="center">
  <img src="client/favicon.svg" width="64" alt="kolu icon" />
</p>

# kolu

> [கோலு](<https://en.wikipedia.org/wiki/Golu_(festival)>) — the Navaratri tradition of arranging figures on tiered steps.

Seamless parallel development across repos and branches — switch context in one click. Optimized for AI-assisted workflows.

> [!IMPORTANT]
> Work in progress. See the [implementation plan](docs/plans/000-KOLU.md).

## Development

Requires [Nix](https://nixos.asia/en/install) with flakes enabled.

```sh
nix develop     # enter devshell
just dev        # run server + client with hot reload
just test       # e2e tests (full nix build)
just test-dev   # e2e tests against running dev server (faster)
```

## Production

```sh
nix build       # build server + client
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

## Deployment (NixOS + home-manager)

A home-manager module is provided to run kolu as a systemd user service:

```nix
{
  imports = [ kolu.homeManagerModules.default ];
  services.kolu = {
    enable = true;
    package = kolu.packages.${system}.default;
    host = "127.0.0.1"; # default
    port = 7681;         # default
  };
}
```

See [`nix/home/example/`](nix/home/example/) for a full NixOS configuration example with a VM test.

## Architecture

pnpm workspace with three packages:

- `common/` — [oRPC](https://orpc.unnoq.com/) contract + [Zod](https://zod.dev/) schemas (shared types between server and client)
- `server/` — [Hono](https://hono.dev/) + [node-pty](https://github.com/microsoft/node-pty) with oRPC over WebSocket
- `client/` — [SolidJS](https://www.solidjs.com/) + [xterm.js](https://xtermjs.org/) terminal

Stack: Hono → oRPC (WebSocket) → PTY → xterm.js. Styling via [Tailwind CSS v4](https://tailwindcss.com/).

## Terminal Features

Powered by [xterm.js](https://xtermjs.org/) with WebGL-accelerated rendering (canvas fallback):

- **Clickable URLs** — links in terminal output open in the browser
- **Find in buffer** — search through terminal scrollback
- **Clipboard integration** — system clipboard copy/paste, including Ctrl+V image paste for Claude Code (via server-side xclip/wl-paste shims)
- **Unicode 11** — correct rendering of wide characters, emoji, CJK
- **Inline images** — sixel, iTerm2, and kitty image protocols
- **Themes** — 200+ color schemes, switchable at runtime via command palette
- **Font zoom** — Cmd/Ctrl +/- to adjust font size (persisted across sessions)
