# Official libghostty-vt wasm pin

Asset: `ghostty-vt.wasm` from the Ghostty GitHub `tip` release
(https://github.com/ghostty-org/ghostty/releases/tag/tip), the pre-built
module cited in https://x.com/mitchellh/status/2088378990998524206.

- URL: https://github.com/ghostty-org/ghostty/releases/download/tip/ghostty-vt.wasm
- Fetched: 2026-08-18
- Tip commit: `12967b68f7d46bdbfb2cfffb6768332fb9db68c0`
- SHA-256: `65c89f79965cdddfffe9a246fee5019cbec5ea109e18809372f9266e9a6be0b6`
- Size: 902443 bytes

`trampoline.wasm` is a 87-byte helper we assemble (zero Ghostty code) so JS
can put function pointers into the official module's funcref table. The
official module has no imports.

Crash if the wasm file is absent. Do not substitute `coder/ghostty-web` or
any other xterm-compatible wrapper.
