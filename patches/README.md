# Patches

Local patches applied to npm dependencies via pnpm's
[`patchedDependencies`](https://pnpm.io/settings#patcheddependencies)
mechanism. Each entry is registered in `package.json` and applied
automatically by `pnpm install`.

## `node-pty@1.1.0.patch`

Adds a `foregroundPid` accessor to `UnixTerminal` that wraps
`tcgetpgrp(masterFd)`, plus the matching `pty.foregroundPid(fd)`
binding in the native module. The patched `install` script forces
`node-gyp rebuild` so the modified C++ actually compiles instead of
falling back to a prebuilt.

Used by `server/src/meta/claude.ts` to identify which terminal a
Claude Code session is running in — see the comment block at the top
of that file for the detection flow.

**Upstream feature request:** [microsoft/node-pty#913](https://github.com/microsoft/node-pty/issues/913).
If/when accepted there, this patch can be deleted in favor of an
upstream version bump.
