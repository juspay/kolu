# Nix derivation for the fleet-top tutorial agent.
#
# The multi-host tutorials (Across the hosts / A fleet of surfaces) mirror a
# `top` surface from another box: `@kolu/surface-remote`'s `sshConnector` ships
# this agent's `.drv` to each host, realises it, and runs
# `<out>/bin/fleet-top-agent --stdio`. The tutorials read its drvPath from the
# Surface example flake and pass it as FLEET_TOP_AGENT_DRV.
#
# Same makeWrapper-over-tsx shape as the remote-process-monitor example agent;
# reuses the canonical workspace-wide `src` + `pnpmDeps` passed by the
# independent Surface-example flake. Agent-only — the tutorials run the parent
# server + Vite client from source via `pnpm run dev`.
{ pkgs, src, pnpmDeps }:
let
  # Shared "workspace tree + pnpm install, tsx-runnable" base
  # (../../../../nix/workspace-tree.nix), the same one remote-process-monitor,
  # mini-ci and vazhi build against.
  workspaceTree = import ../../../../nix/workspace-tree.nix { inherit pkgs src pnpmDeps; };

  fleetTopAgent = pkgs.runCommand "fleet-top-agent"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "fleet-top-agent";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/fleet-top-agent \
      --add-flags "${workspaceTree}/packages/surface/example/fleet-top/part-3/src/agent/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
  '';
in
{
  fleet-top-agent = fleetTopAgent;
}
