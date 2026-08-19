# @kolu/ghostty-kit

VT engine over the official Ghostty `ghostty-vt.wasm` release asset. Bytes
in, cells / plain text / VT / snapshot out. No DOM, no PTY, no xterm.

The wasm is pinned in `vendor/` — see `vendor/PIN.md`. Load throws if the
file is missing.
