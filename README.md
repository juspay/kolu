<p align="center">
  <img src="client/favicon.svg" width="64" alt="kolu icon" />
</p>

# kolu

Web-based [Agentic Development Environment](https://x.com/jdegoes/status/2036931874057314390) (ADE) built on terminals.

Named after [கோலு](<https://en.wikipedia.org/wiki/Golu_(festival)>), the tradition of arranging figures on tiered steps.

## Usage

```sh
nix run github:juspay/kolu       # serve on 0.0.0.0:7681
nix run github:juspay/kolu -- --host 127.0.0.1 --port 8080  # custom bind
```

## Features

### Terminals

- Create, switch, kill, and drag-to-reorder terminals from a collapsible sidebar
- Sub-terminals — `Ctrl+`` splits a bottom panel per terminal; `Ctrl+Shift+``adds tabs,`Ctrl+PageDown/Up` cycles
- Font zoom (`Cmd/Ctrl +/-`), persisted per terminal across sessions
- WebGL rendering with canvas fallback, clickable URLs, Unicode 11, inline images (sixel, iTerm2, kitty)
- Lazy attach — late-joining clients receive serialized screen state (~4KB) instead of replaying raw buffer

### Navigation

- Command palette (`Cmd/Ctrl+K`) — search terminals, switch themes, run actions
- Mission Control (`Cmd/Ctrl+.` or `Ctrl+Tab`) — bird's eye grid of all terminals with live previews. Navigate with arrow keys, Tab, or number keys (1-9). `Ctrl+Tab` enables quick-switch: hold Ctrl, Tab through terminals, release to select
- Keyboard-driven — `Cmd+T` new terminal, `Cmd+1-9` jump, `Cmd+Shift+[/]` cycle, `Cmd+/` shortcuts help

### Git & GitHub

- Auto-detected repo name, branch, and working directory (via OSC 7 + `.git/HEAD` watcher)
- GitHub PR detection — shows PR number, title, and CI check status (pass/pending/fail) in header and sidebar
- Per-repo color coding in sidebar via golden-angle hue spacing
- Activity sparklines per terminal (5-minute rolling window)

### Theming

- 200+ color schemes from [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes), switchable at runtime
- Live preview while browsing themes in the palette
- Random theme per new terminal (toggleable)
- Dark / light / system UI theme

### Clipboard

- `Ctrl+V` pastes images into Claude Code via server-side clipboard shims

## Architecture

pnpm monorepo, three packages:

| Package   | Stack                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common/` | [oRPC](https://orpc.unnoq.com/) contract + [Zod](https://zod.dev/) schemas                                                                       |
| `server/` | [Hono](https://hono.dev/) + [node-pty](https://github.com/microsoft/node-pty) + [@xterm/headless](https://www.npmjs.com/package/@xterm/headless) |
| `client/` | [SolidJS](https://www.solidjs.com/) + [xterm.js](https://xtermjs.org/) + [Tailwind CSS v4](https://tailwindcss.com/)                             |

All communication over a single WebSocket (`/rpc/ws`) via oRPC. Terminal I/O, lifecycle, CWD tracking, and activity detection are typed RPC procedures with async generator streaming.

## Development

Requires [Nix](https://nixos.asia/en/install) with flakes enabled.

```sh
nix develop     # enter devshell
just dev        # run server + client with hot reload
just test       # e2e tests (full nix build)
```

## CI

`just ci` builds all flake outputs on x86_64-linux and aarch64-darwin in parallel, runs e2e tests, and posts GitHub commit statuses. See [`ci/`](ci/) for details and reuse instructions.

```sh
just ci              # full CI run
just ci::protect     # set branch protection
just ci::_summary    # check current status
```

## Deployment (NixOS + home-manager)

A home-manager module runs kolu as a systemd user service:

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

See [`nix/home/example/`](nix/home/example/) for a full configuration with a VM test.
