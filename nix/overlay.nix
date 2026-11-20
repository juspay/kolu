final: _prev:
{
  kolu-fonts = final.callPackage ./packages/fonts { };
  kolu-snapshot-fonts = final.callPackage ./packages/fonts/snapshot.nix { };
  pnpm-build = final.callPackage ./pnpm.nix { };
  agent-distro = final.callPackage ../packages/agent-distro/package.nix {
    src = (import ../npins).agent-distro;
  };
  kolu-acp-adapter = final.callPackage ./packages/acp-adapter.nix { };
}
