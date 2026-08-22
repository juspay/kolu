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
}
