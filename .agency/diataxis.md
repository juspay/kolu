# Kolu Diátaxis overlay

Where each quadrant lives in this project (read by the base `diataxis` skill).

| quadrant | home today | notes |
| --- | --- | --- |
| Tutorial | Product: `website/src/content/docs/from-a-mac.mdx` (Mac window, Linux computer), `first-five-minutes.mdx`. Framework: `website/src/content/surface/your-first-surface.mdx` | one path, no branches; first-session pages do not name padi / kaval / surface |
| How-to | Product: `website/src/content/docs/` pages in Use Kolu / Operate / Command Line (`quickstart`, `remote-access`, `remote-hosts`, `deployment`, …). Framework: remaining `/surface` guides | |
| Reference | Surface `ref-*.mdx`; product `keyboard-shortcuts.mdx` | package READMEs stay the package-level map |
| Explanation | Product: `philosophy.mdx`, `architecture.mdx`, `concepts.mdx`. Atlas `pedagogy` kind + design notes | Architecture and Surface are builder docs, linked from the footer, not the top nav |

Project rules: Atlas frontmatter `parents: [pedagogy]` ⇒ Explanation; `parents: [reference]` ⇒ Reference — the audit's classify step reads these as the CLAIM. Product first-session pages (Start, Quickstart, From a Mac, First Five Minutes) stay in Tutorial / How-to voice: a job, then steps, then a link out. The `@kolu/surface` site at `kolu.dev/surface` is the four-quadrant home for the framework.
