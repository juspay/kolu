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

- **Multi-terminal** — create, switch, and kill terminals from a collapsible sidebar
- **Git-aware** — header shows repo name, branch, and working directory (auto-detected via OSC 7)
- **Command palette** — `Cmd/Ctrl+K` to search terminals, switch themes, and run actions
- **200+ themes** — color schemes from [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes), switchable at runtime
- **Sub-terminals** — `Ctrl+`` toggles a bottom split panel per terminal for dev servers, lazygit, etc. `Ctrl+Shift+``adds more tabs,`Ctrl+PageDown/Up` cycles
- **Keyboard-driven** — `Cmd+T` new terminal, `Cmd+1-9` jump, `Cmd+Shift+[/]` cycle, `Cmd+/` shortcuts help
- **Clipboard & image paste** — `Ctrl+V` pastes images into Claude Code via server-side clipboard shims
- **WebGL rendering** — xterm.js with GPU acceleration, canvas fallback
- **Clickable URLs**, **find in buffer**, **Unicode 11**, **inline images** (sixel, iTerm2, kitty)
- **Font zoom** — `Cmd/Ctrl +/-`, persisted across sessions
- **Lazy attach** — late-joining clients receive serialized screen state (~4KB) instead of replaying raw buffer

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
