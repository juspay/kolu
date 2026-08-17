# Official libghostty-vt wasm pin

Asset: `ghostty-vt.wasm` from the Ghostty GitHub `tip` release
(https://github.com/ghostty-org/ghostty/releases/tag/tip), the pre-built
module cited in https://x.com/mitchellh/status/2088378990998524206.

- URL: https://github.com/ghostty-org/ghostty/releases/download/tip/ghostty-vt.wasm
- Fetched: 2026-08-17
- Tip commit: `b97b17f06b1ffd694f80edd3df5dd2134a0bcb9e`
- SHA-256: `7547dd9d72dca927d01073308f7f373f90a6284ab129eff4202b889fa9ebf984`
- Size: 900284 bytes

`trampoline.wasm` is a 87-byte helper we assemble (zero Ghostty code) so JS
can put function pointers into the official module's funcref table. The
official module has no imports.

Crash if the wasm file is absent. Do not substitute `coder/ghostty-web` or
any other xterm-compatible wrapper.
