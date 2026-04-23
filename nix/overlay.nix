# Adds kolu's leaf packages to nixpkgs so callPackage can auto-inject them.
# kolu itself and the wrapper stay outside the overlay because they need
# per-invocation args (commitHash) that don't belong in pkgs.
final: _prev:
{
  kolu-fonts = final.callPackage ./packages/fonts { };
}
