# @kolu/byte-units

How kolu writes a byte count: one formatter, binary units (KiB · MiB · GiB) —
the units Nix reports closures in. Zero dependencies.

- `formatBytes` picks the unit by size ("512 B", "22 KiB", "142 MiB",
  "1.1 GiB"), on the rounded figure, so it never prints "1024 KiB".
- `formatMiB` holds a readout in MiB, whole or to a tenth.
- `mibOf` is the rounding `formatMiB` writes, as a number — for a dedup on the
  figure a readout shows, or a machine-readable snapshot.
- `KIB`, `MIB`, `GIB` — the constants.
