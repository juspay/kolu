# The genuine xAI Grok Build CLI (`grok`) for the real-agent-against-ollama e2e
# lane (srid's ruling: grok goes real via the authentic Build CLI, not a mock).
#
# xAI ships Grok Build as a single self-contained native binary per platform
# (a Bun-compiled executable, statically linked — no PT_INTERP, so no
# autoPatchelf is needed on linux), distributed from a public GCS bucket and
# pinned here by version + per-platform hash. It is PROPRIETARY (unfree), so —
# like claude-code.nix — it is built under a scoped `allowUnfree` nixpkgs whose
# own eval carries the derivation; the free e2e shell can then depend on it.
#
# The binary is BYO-endpoint: `~/.grok/config.toml` can point a custom model at
# any OpenAI-compatible `base_url` with `api_backend = "chat_completions"` and a
# dummy `env_key`, exactly as codex/claude/opencode do — so it drives ollama in
# the lane without an xAI subscription. kolu's grok provider reads the session
# state it writes under `~/.grok` (active_sessions.json / events.jsonl).
{ pkgs }:
let
  pkgsUnfree = import ../nixpkgs.nix {
    inherit (pkgs.stdenv.hostPlatform) system;
    config.allowUnfree = true;
  };
  inherit (pkgsUnfree) stdenv fetchurl lib;

  version = "0.2.93";
  # xAI's platform suffix scheme is `${os}-${arch}` with os ∈ {linux, macos} and
  # arch ∈ {x86_64, aarch64} (from x.ai/cli/install.sh). The lane runs on
  # x86_64-linux + aarch64-darwin; the other two are carried for dev parity.
  byPlatform = {
    x86_64-linux = {
      suffix = "linux-x86_64";
      hash = "sha256-Tgc407VVDzyEK8CuafRogVxjKcAIoRDQwnppTcNAETU=";
    };
    aarch64-linux = {
      suffix = "linux-aarch64";
      hash = "sha256-7a4g6SoKM/7ewao0iPPjgI2MTKISj8jzE/vYGOPpX18=";
    };
    x86_64-darwin = {
      suffix = "macos-x86_64";
      hash = "sha256-8xDJT3lft4OY97M4cxF00Uq6IpqJWJXlyHlpr78/ypU=";
    };
    aarch64-darwin = {
      suffix = "macos-aarch64";
      hash = "sha256-Kpe6Z1vZkqqbmB4ug3dkYNlPRptRDAuO/ii1DSNtdnw=";
    };
  };
  target =
    byPlatform.${stdenv.hostPlatform.system}
      or (throw "grok-build: unsupported system ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation {
  pname = "grok-build";
  inherit version;

  src = fetchurl {
    url = "https://storage.googleapis.com/grok-build-public-artifacts/cli/grok-${version}-${target.suffix}";
    inherit (target) hash;
  };

  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;
  # The binary is a pre-built (and, on darwin, pre-signed) native executable:
  # don't strip it — stripping re-invalidates a macho signature, and there's
  # nothing to gain on a self-contained blob. nixpkgs' darwin fixup re-signs an
  # invalid macho, mirroring the codex-cli-nix approach.
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 $src $out/bin/grok
    # The installer also exposes the binary as `agent` (ACP entrypoint); mirror
    # it so anything invoking `agent` resolves too.
    ln -s grok $out/bin/agent
    runHook postInstall
  '';

  meta = {
    description = "xAI Grok Build agentic coding CLI (native binary, e2e lane)";
    homepage = "https://x.ai/cli";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = builtins.attrNames byPlatform;
    mainProgram = "grok";
  };
}
