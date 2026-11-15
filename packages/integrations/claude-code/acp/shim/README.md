# kolu-acp-claude

The npm shim the Claude ACP adapter derivation builds from. It is a manifest and its lockfile, nothing else: one pinned dependency, `@agentclientprotocol/claude-agent-acp`, plus one `overrides` entry. There is no source and no export.

## Who reads it

`nix/packages/acp-adapter.nix` builds the adapter from this directory. It takes the adapter version out of `dependencies` here, so the pin in this file is the version kolu ships, and it applies the patches in `../patches/` to the installed bundle. `../README.md` explains the adapter as a whole, and `../patches/README.md` explains each patch. `nix/consumer-closure.json` lists this directory, so an outside consumer copies it too.

## What not to break

- **The name is load bearing.** `npmDepsHash` in `acp-adapter.nix` covers the lockfile, root entry included, so renaming the package or editing the lockfile by hand makes the build fail on a hash mismatch. Bump the dependency with npm, then update that hash.
- **A bump is a review of the patches.** They apply with `patch -p1 -F0` to a compiled bundle, so a moved hunk fails the build rather than landing in the wrong place. That red build is the point.
- **The `overrides` entry has a reason.** It forces `@modelcontextprotocol/sdk` past the version GHSA-6qxp-vccf-f47h affects, which a transitive peer would otherwise resolve below. The `//overrides` note beside it says so; keep them together.
