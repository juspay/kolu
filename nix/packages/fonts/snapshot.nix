{ lib, runCommand, nerd-fonts, dejavu_fonts, noto-fonts }:
let
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
