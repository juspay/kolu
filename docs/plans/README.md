# docs/plans — deprecated

This directory is **deprecated**. kolu's in-repo knowledge base has moved to the
**Atlas**:

- **Authored** as markdown/MDX in `docs/atlas/src/content/atlas/`
- **Rendered** to self-contained HTML in `docs/atlas/dist/` (previewable directly
  in kolu's Code tab)
- **Rationale + taxonomy:** the Atlas design note,
  `docs/atlas/src/content/atlas/second-brain.mdx`

> **Do not add new docs here.** New plans, designs, reviews, research, and retros
> go in the Atlas. This directory only holds not-yet-migrated legacy HTML, and
> this README is its only map — there is no longer an `index.html` Map of Content
> or a `docs-moc` CI gate.

## What's left here (legacy HTML, pending migration)

- [`remote-terminals.html`](./remote-terminals.html) — the implementation plan,
  plus its sub-plans
  [`pty-daemon`](./remote-terminals.pty-daemon.html) and
  [`chrome-bar`](./remote-terminals.pty-daemon.chrome-bar.html). The 208 KB
  monolith family, deliberately deferred (kept as HTML for now; a faithful MDX
  port exists in git history but was reverted to keep the Atlas lean).

Migrated to the Atlas: `web-delivery.html` →
[`surface-app`](../atlas/src/content/atlas/surface-app.mdx) (rendered:
`docs/atlas/dist/surface-app.html`); and the `tui` sub-plan
`remote-terminals.pty-daemon.tui.html` (kolu-tui) →
[`pty-daemon-tui`](../atlas/src/content/atlas/pty-daemon-tui.mdx) (rendered:
`docs/atlas/dist/pty-daemon-tui.html`).

When the last `.html` here is migrated to the Atlas, this directory retires.
