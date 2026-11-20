let
  sources = import ../npins;
  nixpkgs = import sources.nixpkgs;
in
args: nixpkgs (args // {
  overlays = (args.overlays or [ ]) ++ [ (import ./overlay.nix) ];
})
