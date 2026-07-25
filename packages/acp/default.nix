# The `@kolu/acp` bins as runnable binaries: `nix run .#acp-proxy` and
# `nix run .#acp-chat`.
#
# Two attrs rather than one, because `meta.mainProgram` is singular and these
# are two different programs — the harness you run in a tile, and the client you
# talk to it with.
#
# A tsx-loader wrapper over the shared workspace tree — no vite bundle, no
# node-gyp: the package imports the ACP library and node builtins, nothing that
# compiles.
#
# `node --import <tsx loader>`, NOT `tsx <entry>` — the same launcher shape
# kaval, padi and vazhi use, for the same reason: tsx's CLI forks a child and
# does not relay SIGTERM/SIGHUP to it. acp-proxy's whole job is owning a child
# process, so a stopped proxy that never runs its shutdown path would leave the
# adapter — and everything the adapter spawned — running.
#
# The adapters are pinned npm dependencies of the package, so the tree's own
# `node_modules/.bin` goes on PATH: `acp-proxy -- claude-agent-acp` resolves
# without a global install, while any other stdio ACP agent on the caller's PATH
# still works, which is the point of the adapter being argv.
#
# `--suffix`, NOT `--prefix`: that directory also holds the toolchain (tsc, tsx,
# vitest, biome), and putting it AHEAD of the caller's PATH would shadow those
# for every command the agent itself runs inside the tile — a proxy has no
# business rewriting the toolchain of the work happening under it. Suffixing
# keeps the caller authoritative while still resolving the two adapters, which
# nothing else provides.
#
# The directory is referenced in place rather than copied or symlinked into a
# smaller one: pnpm's `.bin` entries are RELATIVE symlinks into `.pnpm/`, so a
# link to one from anywhere else resolves to a path that does not exist
# (`Cannot find module '/node_modules/.pnpm/…'` — measured, not guessed).
#
# Inputs come from whichever composer is building and are the canonical ones
# from nix/workspace.nix, so the pnpm fetch is cached once across consumers:
#   pkgs     — the per-system nixpkgs.
#   src      — the workspace source fileset.
#   pnpmDeps — the workspace pnpm fetch.
{ pkgs, src, pnpmDeps }:
let
  tree = import ../../nix/workspace-tree.nix { inherit pkgs src pnpmDeps; };

  mkBin = { name, entry, description }:
    pkgs.runCommand name
      {
        nativeBuildInputs = [ pkgs.makeWrapper ];
        meta = { inherit description; mainProgram = name; };
      } ''
      mkdir -p $out/bin
      makeWrapper ${pkgs.nodejs}/bin/node $out/bin/${name} \
        --add-flags "--import ${pkgs.tsx}/lib/tsx/dist/loader.mjs" \
        --add-flags "${tree}/packages/acp/${entry}" \
        --suffix PATH : ${tree}/packages/acp/node_modules/.bin \
        --suffix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
    '';
in
{
  acp-proxy = mkBin {
    name = "acp-proxy";
    entry = "src/proxy.ts";
    description = "Run an ACP agent in a tile: spawns an adapter, serves ACP on a unix socket, renders the frames";
  };

  acp-chat = mkBin {
    name = "acp-chat";
    entry = "src/chat.ts";
    description = "A REPL client for an acp-proxy socket";
  };
}
