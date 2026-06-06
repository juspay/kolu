# Nix deps for the screencast capture engine — layered ON TOP of the e2e shell
# (which provides Playwright) by the `just record` recipe, so the top-level
# flake devShells stay untouched. ffmpeg-full (NOT plain nixpkgs `ffmpeg`, which
# is built --disable-xlib --disable-libxcb and so lacks the x11grab input
# device) + Xvfb back the OS-level capture path. Isolated here with the rest of
# the engine, ready to graduate into a package alongside engine.ts.
{ pkgs ? import ../../../nix/nixpkgs.nix { } }:
pkgs.mkShellNoCC {
  name = "kolu-screencast";
  packages = [
    pkgs.ffmpeg-full
    pkgs.xorg.xvfb
  ];
}
