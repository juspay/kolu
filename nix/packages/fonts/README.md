# nix/packages/fonts

Nix derivation that fetches and self-hosts all web font assets, replacing CDN dependencies on Google Fonts and jsDelivr.

## Fonts

| Font                   | Use                     | Source                                                                   | Weights            |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------ | ------------------ |
| **DM Sans**            | UI chrome (`font-sans`) | Google Fonts v17                                                         | 400–600 (variable) |
| **FiraCode Nerd Font** | Terminal (`xterm.js`)   | [nerdfont-webfonts](https://github.com/mshaugh/nerdfont-webfonts) v3.3.0 | 400, 700           |

DM Sans is split into 2 unicode-range subsets (latin, latin-ext) so browsers only download what they need.

## Outputs

The derivation produces a flat directory:

```
$out/
  fonts.css                        # @font-face declarations (auto-generated)
  dm-sans-latin.woff2              # DM Sans subset files
  dm-sans-latin-ext.woff2
  FiraCodeNerdFont-Regular.woff2   # FiraCode variants
  FiraCodeNerdFont-Bold.woff2
```

## Integration

- **Build** (`default.nix`): `KOLU_FONTS_DIR` points to the derivation output. The build phase copies fonts into `packages/client/public/fonts/` before `vite build`.
- **Dev** (`shell.nix`): The shell hook symlinks `packages/client/public/fonts` → `$KOLU_FONTS_DIR` so Vite serves them at `/fonts/`.
- **CSS** (`vite.config.ts`): `fonts.css` is imported via the `kolu-fonts` vite alias.

## Updating fonts

Edit `dmSansSubsets` or `firacode` in `nix/packages/fonts/default.nix`. To get a new hash:

```sh
nix hash convert --to sri --hash-algo sha256 $(nix-prefetch-url <url>)
```

The `@font-face` CSS is generated from the same data and passed through the
repository-pinned Nixpkgs Biome inside the derivation — no separate file or
hand-maintained formatter layout to keep in sync.
