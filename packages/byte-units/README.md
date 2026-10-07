# @kolu/byte-units

How kolu writes a byte count: one formatter, binary units (KiB · MiB · GiB) —
the units Nix reports closures in. `formatBytes` picks the unit by size;
`formatMiB` holds a readout in MiB. Zero dependencies.
