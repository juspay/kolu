# from-a-mac

- Kind: how-to. Reader: someone with a Mac and a Linux box who wants kolu as a Mac app.
- Rewritten from: `f50641c6a`
- Words: 470 → 454
- Frontmatter: unchanged (description 107 characters).

## Headings

No heading renamed. No inbound anchors point at this page. The links out
(`/deployment#enable-the-service`,
`/deployment#first-run-compiling-enable-the-binary-cache`,
`/remote-access`, `/install-pwa`) are unchanged.

## Shape changes

- The requirements sentence had two em-dashes. The aside became parentheses:
  "a headless Linux machine with Nix (NixOS, Ubuntu, or any other Linux with
  Nix), a Mac, and a Tailscale account on both".
- Step 1 was one 152-word list item holding both platforms. The NixOS path and
  the Ubuntu path are now two sub-items under it, with their code blocks
  unchanged. The step's own text is the one-line title, the shared sentence
  about the module, and the closing check at `http://127.0.0.1:7681`.
- Two sentences lost a dash they did not need ("Install Nix with flakes if you
  do not have it: the NixOS Asia guide"; "Then a standalone home-manager flake.
  Replace `you`, and use `aarch64-linux` on ARM").

The inline SVG diagram, its `id`s and its `ax-d-*` classes are untouched.

## Moved

Nothing.

## Cut

| Fact | Tag |
| --- | --- |
| "Then linger, so the user systemd starts at boot on a box nobody is logged into" in the step's opening | duplicate — the NixOS sub-step states the `linger` setting and the Ubuntu sub-step runs `loginctl enable-linger`, with the reason ("Linger keeps the service up after SSH disconnects") |

## Dropped code spans

None: the comparison script reports 0 missing.
