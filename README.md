<p align="center">
  <img src="client/favicon.svg" width="64" alt="kolu icon" />
</p>

# kolu

A web-based terminal multiplexer for managing multiple repos and branches in parallel. Built for developers running AI coding agents across worktrees who need fast context switching without leaving the browser.

Named after [கோலு](<https://en.wikipedia.org/wiki/Golu_(festival)>), the tradition of arranging figures on tiered steps.

<img width="2446" height="2030" alt="image" src="https://github.com/user-attachments/assets/5d6bbb17-25c4-4c04-9389-66004dee3b9c" />

## Features

- **Multi-terminal** — create, switch, and kill terminals from a collapsible sidebar
- **Git-aware** — header shows repo name, branch, and working directory (auto-detected via OSC 7)
- **Command palette** — `Cmd/Ctrl+K` to search terminals, switch themes, and run actions
- **200+ themes** — color schemes from [Ghostty](https://ghostty.org/), switchable at runtime
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

## Production

```sh
nix build       # build server + client
nix run         # serve on 0.0.0.0:7681
nix run -- --host 127.0.0.1 --port 8080  # custom bind
```

## CI

Uses [localci](https://github.com/srid/localci) to build all flake outputs on each platform and run e2e tests, posting GitHub commit statuses.

```sh
just ci         # build + e2e, post statuses (requires clean worktree)
just test       # run e2e only, no status posting
```

Required statuses for merge: `localci/nix/x86_64-linux`, `localci/nix/aarch64-darwin`, `localci/nix/home-example/x86_64-linux`, `localci/e2e`.

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

## CI

- **Nix build**: [Vira](https://vira.nixos.asia) on self-hosted NixOS runners (x86_64-linux, aarch64-darwin)
- **E2E tests**: Cucumber + Playwright, run locally via `just ci` — posts `signoff/e2e` commit status to GitHub

Merging to `master` requires all three signoffs: `signoff/vira/x86_64-linux`, `signoff/vira/aarch64-darwin`, `signoff/e2e`.
