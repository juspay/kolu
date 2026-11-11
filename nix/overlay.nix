# Adds kolu's leaf packages to nixpkgs so callPackage can auto-inject them.
# kolu itself and the wrapper stay outside the overlay because they need
# per-invocation args (commitHash) that don't belong in pkgs.
final: _prev:
{
  kolu-fonts = final.callPackage ./packages/fonts { };
  # The daemon-side font set: the outline faces the terminal-snapshot PNG
  # rasteriser loads. A sibling of kolu-fonts in the SAME directory — see
  # ./packages/fonts/snapshot.nix for why it is not a second output of it.
  kolu-snapshot-fonts = final.callPackage ./packages/fonts/snapshot.nix { };
  # The pnpm every Nix builder must run (reporter wrapped). See ./pnpm.nix.
  pnpm-build = final.callPackage ./pnpm.nix { };
  # agent-distro's own package — THE FLOOR, the coding agents a kolu terminal
  # runs. Named here, from its one definition (../packages/agent-distro/
  # package.nix), because the adapter below drives its `claude`: an overlay
  # attribute is the only way to hand it over that does not import
  # ../packages/agent-distro/default.nix, whose `readListing` runs through
  # kolu's own build derivation and back to this very attribute set.
  agent-distro = final.callPackage ../packages/agent-distro/package.nix {
    src = (import ../npins).agent-distro;
  };
  # Claude Code's ACP adapter, pinned — the agent kolu-server's conductor
  # spawns. A leaf like the fonts: `nix/env.nix` reads it into `koluEnv` as
  # KOLU_ACP_AGENT, so the build, the devShell and `koluBin`'s wrapper name ONE
  # store path. `callPackage` injects the `agent-distro` above as the CLI it
  # drives. See ./packages/acp-adapter.nix.
  kolu-acp-adapter = final.callPackage ./packages/acp-adapter.nix { };
}
