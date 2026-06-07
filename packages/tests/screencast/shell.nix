# Nix deps for the screencast capture engine — layered ON TOP of the e2e shell
# (which provides Playwright) by the `just record` recipe, so the top-level
# flake devShells stay untouched. ffmpeg-full (NOT plain nixpkgs `ffmpeg`, which
# is built --disable-xlib --disable-libxcb and so lacks the x11grab input
# device) + Xvfb back the OS-level capture path. Isolated here with the rest of
# the engine, ready to graduate into a package alongside engine.ts.
{ pkgs ? import ../../../nix/nixpkgs.nix { } }:
let
  # Fonts for the headless capture Chrome (under bare Xvfb). Without a fontconfig
  # that includes these, emoji and powerline/Nerd glyphs (the shell prompt's git
  # segment, agent status icons, …) render as tofu boxes in the clip.
  # makeFontsConf builds a standalone fonts.conf; FONTCONFIG_FILE (below) points
  # Chrome at it. A broad set so UI, code, CJK, emoji, and symbol glyphs resolve.
  fontsConf = pkgs.makeFontsConf {
    fontDirectories = [
      pkgs.noto-fonts
      pkgs.noto-fonts-color-emoji
      pkgs.noto-fonts-cjk-sans
      pkgs.dejavu_fonts
      pkgs.liberation_ttf
      pkgs.nerd-fonts.symbols-only
    ];
  };
in
pkgs.mkShellNoCC {
  name = "kolu-screencast";
  packages = [
    pkgs.ffmpeg-full
    pkgs.xorg.xvfb
  ];
  # Exported into the capture process's env (the recipe runs cucumber/Chrome
  # inside this shell), so Chrome's fontconfig finds the emoji + glyph fonts.
  FONTCONFIG_FILE = fontsConf;
}
