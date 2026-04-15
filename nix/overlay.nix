# Adds kolu's leaf packages to nixpkgs so callPackage can auto-inject them.
# kolu itself and the wrapper stay outside the overlay because they need
# per-invocation args (commitHash) that don't belong in pkgs.
final: _prev:
let
  # Import npins once and pass iTerm2-Color-Schemes to ghostty-themes,
  # so it doesn't re-import the npins framework separately.
  sources = import ../npins;
in
{
  kolu-ghostty-themes  = final.callPackage ./packages/ghostty-themes {
    iTerm2-Color-Schemes = sources.iTerm2-Color-Schemes;
  };
  kolu-fonts           = final.callPackage ./packages/fonts { };
  kolu-worktree-words  = final.callPackage ./packages/worktree-words { };
  kolu-clipboard-shims = final.callPackage ./packages/clipboard-shims.nix { };
}
