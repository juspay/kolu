# THE ORCHESTRATOR'S AGENT, PINNED — Claude Code's ACP adapter as a store path.
#
# kolu-server hosts ONE Claude conversation over the Agent Client Protocol,
# whose hands are the whole fleet, and it has to be able to START one on a
# machine it was merely `nix copy`-ed to: no npm, no `npx`, no network, no
# version that differs from the one this build was proven against. So the
# adapter is a derivation like any other, and `KOLU_ACP_AGENT` (baked through
# `nix/env.nix` onto `koluBin`) is the path kolu-server spawns.
#
# The shared mechanism is `nix/npm-adapter.nix` — one derivation per adapter
# from its own npm shim, with `patch -p1 -F0` over `patches/`. THIS file owns
# the Claude row's facts: which npm package inside the shim tree, the
# wrapper's bin, and the env it arms — chief among them the `claude` the
# adapter drives.
#
# The shim, the lockfile and the two patches live with the integration whose
# agent this is: `packages/integrations/claude-code/acp/`.
{ pkgs, lib, ripgrep, procps, agent-distro }:
let
  npmAdapter = import ../npm-adapter.nix { inherit pkgs; };

  acp = ../../packages/integrations/claude-code/acp;

  # THE CLI THE ADAPTER DRIVES — agent-distro's own `claude`, which is to say
  # the floor: the very launcher this machine's terminals run.
  #
  # It used to be the Claude Agent SDK's bundled binary, and the reason was the
  # hosting: the orchestrator ran inside `padi`, agent-distro's floor is baked
  # onto the wrapper a person runs LOCALLY and deliberately never onto
  # `padi-agent`, so a remote host's closure held no agent-distro path to point
  # at. THAT REASON IS GONE — kolu-server hosts the one conversation now, on
  # the machine whose own wrapper already bakes the floor — and the bundled CLI
  # is a version behind it. Measured on the wire (initialize + `session/new`,
  # reading the session's `configOptions`): the bundled 2.1.280 offers five
  # models and no Fable 5.2; the floor's 2.1.319 offers fourteen with Fable 5.2
  # among them. A model picker that cannot offer the model the user's own
  # terminals are already using was this one line.
  #
  # The LAUNCHER (`bin/claude`), not the `claude-code-<version>/bin/claude` it
  # execs. Both were measured end to end — same fourteen rows, same
  # `session/prompt` round trip — so the pick is not between a working path and
  # a broken one: the launcher wins because it is the only one agent-distro
  # NAMES. Its manifest publishes the package's `bin/` and nothing under it,
  # `mkLaunchers` exposes no harness package and the launcher carries no
  # `passthru`, so the inner CLI could only be had by re-deriving `claude-code`
  # out of agent-distro's locked nixpkgs — which is 2.1.318 there, a DIFFERENT
  # build from the 2.1.319 the floor execs. An orchestrator one quiet version
  # off the terminals is exactly the drift this pin exists to prevent. The
  # launcher resolves the machine's profiles and plugins at spawn and prepends
  # its own argv to the CLI the SDK drives; measured, the SDK's own flags
  # survive that, and under an empty HOME it resolves nothing and still runs.
  claude = "${agent-distro}/bin/claude";
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
  # Node is pinned and so is the CLI the SDK drives (the adapter reads
  # CLAUDE_CODE_EXECUTABLE before it goes looking); nothing here resolves off
  # PATH. `--set`, not `--set-default`: which `claude` this adapter drives is a
  # BUILD FACT — the floor this build was proven against — and an ambient value
  # inherited from whoever spawned kolu-server would silently swap it, which is
  # exactly the override knob the repo's fail-fast rule forbids. The rest is
  # what nixpkgs' claude-code sets: no self-update (this closure is immutable),
  # and the ripgrep buried in the bun archive cannot be patched, so hand it the
  # one from the store.
  env = [
    ''--set CLAUDE_CODE_EXECUTABLE "${claude}"''
    "--set DISABLE_AUTOUPDATER 1"
    "--set DISABLE_INSTALLATION_CHECKS 1"
    "--set USE_BUILTIN_RIPGREP 0"
    ''--prefix PATH : "${lib.makeBinPath [ ripgrep procps ]}"''
  ];
  # No `postInstall`: the SDK's own bun-compiled `claude` is never executed
  # (CLAUDE_CODE_EXECUTABLE is `--set` above), so patchelf-ing its interpreter
  # would be maintenance on a binary nothing runs — and if something ever did
  # reach for it, an unpatched interpreter fails loudly, which is the answer
  # this repo wants over a second CLI quietly standing in for the floor.
}
