# Dev shell — shared by `nix develop` (via flake.nix) and `nix-shell`.
{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  packages = import ./default.nix { inherit pkgs; };

  # Chrome-for-Testing path for chrome-devtools-mcp (see .mcp.json). Pulled
  # from playwright-driver's browsers.json at eval time so the chromium-N
  # revision tracks whatever nixpkgs pins — fails loud here if layout changes
  # instead of silently at MCP startup. Idiom from https://wiki.nixos.org/wiki/Playwright.
  playwrightBrowsers = (builtins.fromJSON
    (builtins.readFile "${pkgs.playwright-driver}/browsers.json")).browsers;
  chromiumRev = (builtins.head
    (builtins.filter (b: b.name == "chromium") playwrightBrowsers)).revision;
  koluChromeExecutable =
    "${pkgs.playwright-driver.browsers}/chromium-${chromiumRev}/chrome-linux64/chrome";
in
pkgs.mkShell {
  name = "kolu-shell";

  # Env vars shared with the nix build (defined once in default.nix)
  env = packages.koluEnv // {
    KOLU_COMMIT_HASH = "dev";
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    KOLU_CHROME_EXECUTABLE = koluChromeExecutable;
  };

  shellHook = ''
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      ln -sfn "$KOLU_FONTS_DIR" "$root/packages/client/public/fonts"
    fi
  '';

  packages = with pkgs; [
    just
    nixd
    nodejs
    pnpm
    tsx
    nixpkgs-fmt
    prettier
    # node-gyp toolchain — required by `pnpm install` to recompile node-pty
    # after applying patches/node-pty@1.1.0.patch (the patched install
    # script forces node-gyp rebuild). The build derivation already lists
    # these in nativeBuildInputs; the dev shell needs them so `just install`
    # works outside the nix build.
    python3
    nodePackages.node-gyp
    pkg-config
  ];
}
