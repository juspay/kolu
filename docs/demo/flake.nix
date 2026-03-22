{
  description = "Record kolu demo as MP4";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    systems.url = "github:nix-systems/default";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = import inputs.systems;
      perSystem = { pkgs, ... }: {
        # `nix run ./docs/demo` — record demo and produce docs/demo.mp4
        packages.default = pkgs.writeShellApplication {
          name = "record-demo";
          runtimeInputs = with pkgs; [ git nodejs pnpm ffmpeg-headless ];
          # Playwright needs to know where Nix-managed browsers live
          runtimeEnv = {
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };
          text = ''
            root="$(git rev-parse --show-toplevel)"
            frames="$root/tests/demo-frames"
            rm -rf "$frames"

            # Run Cucumber @demo scenario (captures screenshots)
            cd "$root/tests"
            pnpm install --frozen-lockfile
            REUSE_SERVER=1 pnpm demo

            # Stitch frames into MP4
            ffmpeg -y \
              -framerate 10 -i "$frames/frame-%05d.png" \
              -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
              -vf "scale=1280:-2" -movflags +faststart \
              "$root/docs/demo.mp4"

            rm -rf "$frames"
            echo "✅ docs/demo.mp4"
          '';
        };
      };
    };
}
