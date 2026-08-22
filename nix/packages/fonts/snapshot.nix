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
# The output is a FLAT directory, and THIS list is the only place the FILE set
# is named: `pngFonts.ts` loads whatever `.ttf`/`.otf` files the directory holds
# (and throws if it holds none), so adding or renaming a face here needs no
# matching edit there — a second spelling in TypeScript could only fail at
# runtime, when the two had already parted.
#
# The FAMILY names inside those files are a different matter, and they ARE
# spelled on both sides: `PNG_FONT_FAMILIES` in `pngFonts.ts` lists the families
# an SVG document may name, and resvg resolves fallbacks by those names. So a
# nixpkgs bump that renames a face's internal family ("Symbols Nerd Font Mono" →
# "Symbols Nerd Font") leaves this derivation building and the directory
# populated while every braille spinner and `⎿` connector renders as tofu. That
# is why `pngFonts.ts` reads each face's `name` table at load and refuses, by
# name, a set that cannot answer the document — the check Nix cannot make.
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
