# Pinned nixpkgs import — managed by nixtamal.
# To update: nixtamal refresh && nixtamal lock (from nix/tamal/)
let inputs = import ./tamal { };
in import inputs.nixpkgs
