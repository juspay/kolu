# A version-pinned `codex` for the real-agent-against-ollama e2e lane only.
#
# WHY NOT `pkgs.codex`: the repo's pinned nixpkgs ships codex 0.114.0, whose
# `threads` SQLite table predates the `updated_at_ms` + `model` columns that
# kolu's OWN codex provider requires (packages/integrations/codex/src/core.ts).
# Against 0.114 the provider logs "threads table is missing required columns —
# Codex detection disabled" and no agent state ever surfaces — so a real 0.114
# codex can't drive the detection the e2e asserts. 0.130.0 is the version this
# lane was validated against: its schema carries both columns, and it speaks the
# OpenAI Responses API that ollama serves at /v1/responses.
#
# This pins ONLY the e2e agent binary; production/dev keep `pkgs.codex`. Each
# arm is a prebuilt release binary (linux is a verified STATIC musl build; the
# darwin arms are the stock signed release), installed with a plain unpack — no
# dynamic loader to patch. All four flake systems are mapped so `.#e2e`
# evaluates everywhere; the e2e lane runs on x86_64-linux and aarch64-darwin.
{ pkgs }:
let
  version = "0.130.0";
  base = "https://github.com/openai/codex/releases/download/rust-v${version}";
  # system → { asset basename (== the tarball's single inner file), sha256 }.
  bySystem = {
    "x86_64-linux" = {
      asset = "codex-x86_64-unknown-linux-musl";
      hash = "sha256-Fneee3hXUIp2ijbX1OCE7sM27COUbtcKmwlIm4+GEZA=";
    };
    "aarch64-linux" = {
      asset = "codex-aarch64-unknown-linux-musl";
      hash = "sha256-HX4A8sIsMBa1vLccYQEJR7AiqQ4pAbxrqv6CJWSSx2c=";
    };
    "aarch64-darwin" = {
      asset = "codex-aarch64-apple-darwin";
      hash = "sha256-vFCkt/mgyMqZF5GJ5GWbYBEHgwdw4hVH3Awka85zNXc=";
    };
    "x86_64-darwin" = {
      asset = "codex-x86_64-apple-darwin";
      hash = "sha256-/t2xFr2W19g/i7GbNPur5oQ8xkRhuvLknAF+EgatXmc=";
    };
  };
  inherit (pkgs) lib stdenv;
  system = stdenv.hostPlatform.system;
  sel = bySystem.${system}
    or (throw "codex-pinned: unsupported system ${system}");
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "codex-pinned";
  inherit version;

  src = pkgs.fetchurl {
    url = "${base}/${sel.asset}.tar.gz";
    hash = sel.hash;
  };

  # On arm64 macOS the kernel refuses (SIGKILLs) any binary without a valid code
  # signature, and dropping OpenAI's release signature into the nix store
  # invalidates it — codex was `zsh: killed` on launch, never painting its TUI.
  # `autoSignDarwinBinariesHook` ad-hoc re-signs the binary in fixup so macOS
  # accepts it; `dontStrip` keeps the shipped bytes intact (stripping would just
  # be one more needless mutation). Linux's musl arm is static + unsigned, so it
  # needs neither — the hook is darwin-only.
  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isDarwin [
    pkgs.darwin.autoSignDarwinBinariesHook
  ];

  # The tarball is a single bare binary (no top-level directory).
  sourceRoot = ".";
  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 ${sel.asset} "$out/bin/codex"
    runHook postInstall
  '';

  meta = {
    description = "Pinned OpenAI Codex CLI (${version}) for kolu's ollama e2e lane";
    platforms = builtins.attrNames bySystem;
    sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
  };
}
