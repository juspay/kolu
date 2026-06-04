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
  [`pty-daemon`](./remote-terminals.pty-daemon.html),
  [`chrome-bar`](./remote-terminals.pty-daemon.chrome-bar.html), and
  [`tui`](./remote-terminals.pty-daemon.tui.html). The 208 KB monolith family,
  deliberately deferred (kept as HTML for now; a faithful MDX port exists in git
  history but was reverted to keep the Atlas lean).
- [`web-delivery.html`](./web-delivery.html) — being renamed in a separate open PR.

When the last `.html` here is migrated to the Atlas, this directory retires.
