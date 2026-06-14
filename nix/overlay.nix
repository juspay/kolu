# Adds kolu's leaf packages to nixpkgs so callPackage can auto-inject them.
# kolu itself and the wrapper stay outside the overlay because they need
# per-invocation args (commitHash) that don't belong in pkgs.
final: prev:
{
  kolu-fonts = final.callPackage ./packages/fonts { };

  # Whole-repo Node toolchain: Node 26 built with experimental QUIC, so
  # `require("node:quic")` is available. This is the day-one runtime for kaval's
  # roaming remote transport — QUIC connection migration carries an attached
  # session across a network change with no reconnect (docs/atlas note
  # kaval-vs-zmosh). Every Node consumer flows through `pkgs.nodejs` (devShell,
  # the kaval/agent closures in default.nix, pnpm-typecheck, website), so this
  # one swap migrates the whole repo.
  #
  # Node's configure gates the builtin on --experimental-quic:
  #   node_use_quic = experimental_quic && !without_ssl  (configure.py:configure_quic)
  # The flag must land on the *compile* — `nodejs-slim` — because the full
  # `nodejs` is a thin join over slim's `out` + `npm` outputs (overriding it is a
  # no-op; nixpkgs even warns "use nodejs-slim.configureFlags"). The slim override
  # propagates up to the full `nodejs` through the package-set fixpoint.
  #
  # We must ALSO un-share openssl + ngtcp2 + nghttp3 and let Node build its
  # bundled copies. Node's QUIC stack is vendored-only and gated on a bundled
  # openssl: node.gypi adds the vendored deps/ngtcp2 (ngtcp2 + the nested nghttp3,
  # which carry the internal headers src/quic/*.cc needs, e.g.
  # nghttp3/lib/nghttp3_conn.h) ONLY under
  #   node_use_quic=="true" && node_shared_openssl=="false".
  # With nixpkgs' default --shared-openssl, HAVE_QUIC=1 still compiles the quic
  # sources but no ngtcp2/nghttp3 dependency or include is ever added, so the
  # build fails on that missing internal header. Dropping --shared-openssl flips
  # the gate: Node compiles its bundled openssl 3.5 + bundled ngtcp2 1.14 /
  # nghttp3 1.11 — the upstream-tested QUIC configuration. (nixpkgs ships nghttp3
  # 1.15 / ngtcp2 1.22 with public headers only — an API skew AND missing the
  # internal headers, so the shared path cannot work.) nghttp2 (HTTP/2) and the
  # other shared libs are untouched.
  #
  # Not in nixpkgs' binary cache, so this is a from-source Node (+ bundled
  # openssl) build. Drop --experimental-quic once `node:quic` graduates upstream
  # — no other change.
  nodejs-slim_26 = prev.nodejs-slim_26.overrideAttrs (old: {
    configureFlags =
      builtins.filter
        (f:
          !(prev.lib.hasPrefix "--shared-openssl" f)
          && !(prev.lib.hasPrefix "--shared-ngtcp2" f)
          && !(prev.lib.hasPrefix "--shared-nghttp3" f))
        (old.configureFlags or [ ])
      ++ [ "--experimental-quic" ];
  });

  # Whole-repo default Node -> the QUIC-enabled Node 26 (full, with npm).
  nodejs = final.nodejs_26;

  # Hold pnpm on the v10 line. Bumping nixpkgs (to source Node 26) also moved the
  # default `pnpm` 10 -> 11, and pnpm 11 no longer reads the `pnpm` field in
  # package.json (overrides / onlyBuiltDependencies) — it expects them in
  # pnpm-workspace.yaml — so a frozen install against our lockfileVersion 9 lock
  # fails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Migrating the workspace to
  # pnpm 11's config layout is its own change; pin v10 so this PR stays just the
  # Node 26 runtime.
  pnpm = prev.pnpm_10;
}
