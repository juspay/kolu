# ffmpeg-full, NOT plain nixpkgs `ffmpeg`: the latter is built
# --disable-xlib --disable-libxcb and so lacks the x11grab input device.
{ pkgs ? import ../../../nix/nixpkgs.nix { } }:
let
  # Without a fontconfig that includes these, emoji and powerline/Nerd glyphs
  # render as tofu boxes under bare Xvfb.
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
  FONTCONFIG_FILE = fontsConf;
}
