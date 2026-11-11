# THE ORCHESTRATOR'S AGENT, PINNED — Claude Code's ACP adapter as a store path.
#
# padi hosts one Claude conversation per host over the Agent Client Protocol,
# and it has to be able to START one on a machine it was merely `nix copy`-ed
# to: no npm, no `npx`, no network, no version that differs from the one this
# build was proven against. So the adapter is a derivation like any other, and
# `KOLU_ACP_AGENT` (baked through `nix/env.nix`) is the path padi spawns.
#
# The shared mechanism is `nix/npm-adapter.nix` — one derivation per adapter
# from its own npm shim, with `patch -p1 -F0` over `patches/`. THIS file owns
# the Claude row's facts: which npm package inside the shim tree, the
# wrapper's bin, the env it arms, and the Linux patchelf of the bun-compiled
# `claude` the Claude Agent SDK ships.
#
# The shim, the lockfile and the two patches live with the integration whose
# agent this is: `packages/integrations/claude-code/acp/`.
{ pkgs, lib, stdenv, patchelf, ripgrep, procps }:
let
  npmAdapter = import ../npm-adapter.nix { inherit pkgs; };

  acp = ../../packages/integrations/claude-code/acp;

  # npm's own platform naming: linux-x64, darwin-arm64, …
  nodeArch = "${stdenv.hostPlatform.node.platform}-${stdenv.hostPlatform.node.arch}";

  # `mods` is the shim's installed node_modules — the same literal the build's
  # postInstall spells against (`$out` being the shell's build output), so the
  # env arms the SDK binary at the path the build actually leaves.
  mods = "$out/lib/node_modules/kolu-acp-claude/node_modules";

  # The `claude` CLI the adapter drives. It is the SDK's OWN bun-compiled
  # binary, not one of agent-distro's launchers, and that is a decision rather
  # than an omission: agent-distro's floor is baked onto the wrapper a person
  # runs LOCALLY (`floor = true`) and deliberately never onto `padi-agent` —
  # kolu-server delivers a remote host's agents to it at run time, so there is
  # no agent-distro path inside the closure that is copied to a host. Pointing
  # at one would either be absent exactly where the orchestrator runs, or drag
  # the whole ~2 GB floor into every `nix copy`. The SDK's own binary is also
  # the one this adapter version was built and patched against.
  claude = "${mods}/@anthropic-ai/claude-agent-sdk-${nodeArch}/claude";
in
npmAdapter rec {
  name = "kolu-acp-claude";
  shim = acp + "/shim";
  shimName = "kolu-acp-claude";
  version = (lib.importJSON (shim + "/package.json")).dependencies.${package};
  package = "@agentclientprotocol/claude-agent-acp";
  entry = "dist/index.js";
  bin = "claude-agent-acp";
  # The hash covers the shim's own name too (the npm cache `prefetch-npm-deps`
  # builds is keyed off the lockfile it reads, root entry included), so this is
  # NOT olai's value for the same pin even though the dependency set is byte
  # for byte the same one.
  npmDepsHash = "sha256-ZAcK++CCn1IesEHoVhxB/BZ6T+ChyoM/uVBKS0nxMGg=";
  patches = acp + "/patches";
  # patchelf for the SDK's bun-compiled `claude`; only the interpreter may be
  # touched (see `nix/npm-adapter.nix`'s header).
  extraNativeBuildInputs = lib.optional stdenv.hostPlatform.isLinux patchelf;
  # Node is pinned and so is the CLI the SDK drives (the adapter reads
  # CLAUDE_CODE_EXECUTABLE before it goes looking); nothing here resolves off
  # PATH. `--set`, not `--set-default`: which `claude` this adapter drives is a
  # BUILD FACT — the one binary these patches were applied and proven against —
  # and an ambient value inherited from whoever spawned padi would silently
  # swap it, which is exactly the override knob the repo's fail-fast rule
  # forbids. The rest is what nixpkgs' claude-code sets: no self-update (this
  # closure is immutable), and the ripgrep buried in the bun archive cannot be
  # patched, so hand it the one from the store.
  env = [
    ''--set CLAUDE_CODE_EXECUTABLE "${claude}"''
    "--set DISABLE_AUTOUPDATER 1"
    "--set DISABLE_INSTALLATION_CHECKS 1"
    "--set USE_BUILTIN_RIPGREP 0"
    ''--prefix PATH : "${lib.makeBinPath [ ripgrep procps ]}"''
  ];
  postInstall = lib.optionalString stdenv.hostPlatform.isLinux ''
    claude="${claude}"
    test -x "$claude"
    patchelf --set-interpreter \
      "$(cat "${stdenv.cc}/nix-support/dynamic-linker")" "$claude"
  '';
}
