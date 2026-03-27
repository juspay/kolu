# Pinned nixpkgs import — managed by npins.
# To update: npins update nixpkgs
let sources = import ../npins;
in import sources.nixpkgs
