# nix/packages/fonts

Kolu's fonts, in two derivations for its two consumers — the **browser** and the
**daemon**. Both live here so the sets are discoverable together; they are
separate derivations because they share nothing but the word "font" (different
file formats, different sources, different volatility, different closures — see
the header comment in `snapshot.nix`).

| Derivation                        | File                | Consumer                                  | Format                |
| --------------------------------- | ------------------- | ----------------------------------------- | --------------------- |
| `kolu-fonts` (`KOLU_FONTS_DIR`)   | `default.nix`       | The browser client (Vite / `xterm.js`)    | `.woff2` + `fonts.css` |
| `kolu-snapshot-fonts` (`KOLU_SNAPSHOT_FONTS_DIR`) | `snapshot.nix` | The daemon's PNG rasteriser (`@resvg/resvg-wasm`) | `.ttf` / `.otf`       |

## `kolu-fonts` — the browser set

Fetches and self-hosts the web font assets, replacing CDN dependencies on Google
Fonts and jsDelivr.

| Font                   | Use                     | Source                                                                   | Weights            |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------ | ------------------ |
| **DM Sans**            | UI chrome (`font-sans`) | Google Fonts v17                                                         | 400–600 (variable) |
| **FiraCode Nerd Font** | Terminal (`xterm.js`)   | [nerdfont-webfonts](https://github.com/mshaugh/nerdfont-webfonts) v3.3.0 | 400, 700           |

DM Sans is split into 2 unicode-range subsets (latin, latin-ext) so browsers only download what they need.

The derivation produces a flat directory:

```
$out/
  fonts.css                        # @font-face declarations (auto-generated)
  dm-sans-latin.woff2              # DM Sans subset files
  dm-sans-latin-ext.woff2
  FiraCodeNerdFont-Regular.woff2   # FiraCode variants
  FiraCodeNerdFont-Bold.woff2
```

### Integration

- **Build** (`default.nix`): `KOLU_FONTS_DIR` points to the derivation output. The build phase copies fonts into `packages/client/public/fonts/` before `vite build`.
- **Dev** (`shell.nix`): The shell hook symlinks `packages/client/public/fonts` → `$KOLU_FONTS_DIR` so Vite serves them at `/fonts/`.
- **CSS** (`vite.config.ts`): `fonts.css` is imported via the `kolu-fonts` vite alias.

### Updating fonts

Edit `dmSansSubsets` or `firacode` in `nix/packages/fonts/default.nix`. To get a new hash:

```sh
nix hash convert --to sri --hash-algo sha256 $(nix-prefetch-url <url>)
```

The `@font-face` CSS is generated from the same data and passed through the
repository-pinned Nixpkgs Biome inside the derivation — no separate file or
hand-maintained formatter layout to keep in sync.

## `kolu-snapshot-fonts` — the daemon set

The outline faces `@resvg/resvg-wasm` loads to rasterise a terminal screen to
PNG (`packages/terminal-snapshot/src/png.ts`). resvg does no system font
discovery (`loadSystemFonts: false`), so this directory is the whole world the
rasteriser sees — the render cannot drift with a host's fontconfig.

Everything comes from the pinned nixpkgs (no fetched URLs, so no hashes to keep
here), flattened to basenames:

| Font                        | Covers                                       | nixpkgs attribute          |
| --------------------------- | -------------------------------------------- | -------------------------- |
| **FiraCode Nerd Font Mono** | The primary face — what the browser draws; powerline + private-use icons | `nerd-fonts.fira-code`     |
| **Symbols Nerd Font Mono**  | The remaining Nerd Font icon planes           | `nerd-fonts.symbols-only`  |
| **DejaVu Sans Mono**        | Box drawing, blocks, arrows FiraCode lacks    | `dejavu_fonts`             |
| **Noto Sans Symbols 2**     | Braille spinner frames, misc. technical (`⎿`) | `noto-fonts`               |
| **Noto Sans Symbols**       | Remaining symbol coverage                     | `noto-fonts`               |

```
$out/
  FiraCodeNerdFontMono-Regular.ttf
  FiraCodeNerdFontMono-Bold.ttf
  SymbolsNerdFontMono-Regular.ttf
  DejaVuSansMono.ttf
  NotoSansSymbols2-Regular.otf
  NotoSansSymbols.ttf
```

This list is the ONE place the face set is named: `png.ts` loads every
`.ttf`/`.otf` the directory holds (and throws if it holds none), so adding or
renaming a face here needs no matching edit in TypeScript. A rename of a SOURCE
still fails the Nix build (`cp` on a missing source) rather than rendering tofu
at runtime.

### Integration

- **Env** (`nix/env.nix`): `KOLU_SNAPSHOT_FONTS_DIR` points at the derivation, so the build, the dev shell, and the wrappers all name one store path.
- **Runtime** (`default.nix`): baked onto the `kolu` and `padi` wrappers with `makeWrapper --set`. A spawned daemon inherits nothing from the shell that built it, so the env-in-the-build is not enough on its own.
- **Dev** (`shell.nix`): carried automatically — the shell's `env` is `koluEnv`, so `just dev` and unit tests see it with no extra wiring. No symlink and no fallback: `fontDir()` throws when it is unset.
