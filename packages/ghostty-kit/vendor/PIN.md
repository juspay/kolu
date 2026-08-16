# Official libghostty-vt wasm pin

Asset: `ghostty-vt.wasm` from the Ghostty GitHub `tip` release
(https://github.com/ghostty-org/ghostty/releases/tag/tip), the pre-built
module cited in https://x.com/mitchellh/status/2088378990998524206.

- URL: https://github.com/ghostty-org/ghostty/releases/download/tip/ghostty-vt.wasm
- Fetched: 2026-08-16
- SHA-256: `87258cdadb1e7101dd26fbc669fea5482ccba709aa6b261275851edd36d298e8`
- Size: 876132 bytes

`trampoline.wasm` is a 87-byte helper we assemble (zero Ghostty code) so JS
can put function pointers into the official module's funcref table. The
official module has no imports.

Crash if the wasm file is absent. Do not substitute `coder/ghostty-web` or
any other xterm-compatible wrapper.
