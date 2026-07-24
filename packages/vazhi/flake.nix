# vazhi's own flake, so it can be run — and later moved — on its own:
#
#     nix run ./packages/vazhi        # this flake
#     nix run .#vazhi                 # the same binary, from the root flake
#
# Like every in-repo subflake, this one has NO inputs: it reuses the
# repository's npins-backed nixpkgs and workspace source through
# nix/each-system.nix and nix/workspace.nix. vazhi differs from the example
# subflakes in that it ALSO stays in the runnable Kolu flake — it is one of the
# two apps `@kolu/port-forward` exists for, not a demo — and both paths import
# the one definition in ./default.nix, so they can never build two vazhis.
#
# Everything vazhi itself needs is in `@kolu/port-forward`, which has no
# runtime npm dependencies — its closure needs only nodejs and openssh, which
# ./default.nix supplies — so a later move to its own repo replaces the two
# relative imports above and nothing else changes shape, save
# `lifetime.test.ts`'s `@kolu/daemon-test-gate` devDependency.
{
  outputs = { ... }:
    let
      platform = import ../../nix/each-system.nix;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          workspace = import ../../nix/workspace.nix { inherit pkgs; };
          vazhi = import ./default.nix {
            inherit pkgs;
            inherit (workspace) src pnpmDeps;
          };
        in
        { inherit vazhi; default = vazhi; });
    };
}
