# Convenience devshell for projects without their own Playwright devshell.
# Sets PLAYWRIGHT_BROWSERS_PATH so the sibling `bin/serve` can resolve Chrome.
# Override `pkgs` to pin nixpkgs alongside the rest of your project.
{ pkgs ? import
    (builtins.fetchTarball {
      url = "https://github.com/NixOS/nixpkgs/archive/nixpkgs-unstable.tar.gz";
    })
    { }
,
}:
pkgs.mkShell {
  packages = [ pkgs.nodejs ];
  PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
}
