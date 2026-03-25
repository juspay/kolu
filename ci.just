# CI steps for localci (https://github.com/srid/localci)
# Each recipe declares target systems and dependencies via metadata attributes.

[metadata("systems", "x86_64-linux", "aarch64-darwin")]
nix:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

[metadata("systems", "x86_64-linux")]
[metadata("depends_on", "nix")]
nix-home-example:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake ./nix/home/example --override-input flake/kolu .

[metadata("systems", "x86_64-linux", "aarch64-darwin")]
[metadata("depends_on", "nix")]
e2e:
    just test
