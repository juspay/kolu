{ inputs, ... }:
{
  imports = [
    (inputs.git-hooks + /flake-module.nix)
  ];
  perSystem = { config, self', pkgs, lib, ... }: {
    pre-commit.settings = {
      hooks = {
        nixpkgs-fmt.enable = true;
        prettier = {
          enable = true;
          excludes = [ "pnpm-lock.yaml" ];
        };
      };
    };
  };
}
