# The DAEMON's font set: the six outline faces `@resvg/resvg-wasm` loads to
# rasterise a terminal screen to PNG (packages/terminal-snapshot/src/png.ts).
#
# ## Why a sibling derivation and not a second output of ./default.nix
#
# Same directory — the two sets are two consumers of "kolu's fonts" and belong
# next to each other under one README. Separate DERIVATION because they share
# nothing but the word "font":
#
#   - Different bytes for different rasterisers. The browser gets woff2 subsets
#     picked for transfer size; resvg gets whole TTF/OTF outlines picked for
#     glyph coverage. Neither set can serve the other's consumer.
#   - Different sources, so different volatility. ./default.nix pins CDN URLs by
#     hash and regenerates fonts.css when one moves; this set is whatever the
#     pinned nixpkgs ships. Folding them into one derivation would make a woff2
#     hash bump rebuild the daemon's font dir (and a nixpkgs bump invalidate the
#     browser's) for no reason.
#   - Different closures. `runCommand` with two outputs still builds both for
#     either consumer; two derivations let the client build depend on ~1MB of
#     woff2 and the daemon on ~15MB of outlines, each without the other.
#
# The output is a FLAT directory, and THIS list is the only place the face set
# is named: `png.ts` loads whatever `.ttf`/`.otf` files the directory holds
# (and throws if it holds none), so adding or renaming a face here needs no
# matching edit there — a second spelling in TypeScript could only fail at
# runtime, when the two had already parted.
{ lib, runCommand, nerd-fonts, dejavu_fonts, noto-fonts }:
let
  # Each entry: the store path of the face, flattened to its basename in $out.
  faces = [
    "${nerd-fonts.fira-code}/share/fonts/truetype/NerdFonts/FiraCode/FiraCodeNerdFontMono-Regular.ttf"
    "${nerd-fonts.fira-code}/share/fonts/truetype/NerdFonts/FiraCode/FiraCodeNerdFontMono-Bold.ttf"
    "${nerd-fonts.symbols-only}/share/fonts/truetype/NerdFonts/Symbols/SymbolsNerdFontMono-Regular.ttf"
    "${dejavu_fonts}/share/fonts/truetype/DejaVuSansMono.ttf"
    "${noto-fonts}/share/fonts/noto/NotoSansSymbols2-Regular.otf"
    "${noto-fonts}/share/fonts/noto/NotoSansSymbols.ttf"
  ];
in
runCommand "kolu-snapshot-fonts" { } ''
  mkdir -p $out
  ${lib.concatMapStringsSep "\n" (f: "cp ${f} $out/${baseNameOf f}") faces}
''
