# Refinement — Terminal Task Kanban

A simpler shape for the same user need, surfaced for discussion under the
parent proposal. Cuts the **Project** layer, the **markdown-on-disk**
substrate, and **user-defined lanes**; keeps the user motivation
("queued work + live work in one surface") and the core principle
("Kolu has agency over IO; Kolu has no agency over semantics").

## Summary

Replace the pill-tree-on-hover with a kanban that shows live terminals
plus a backlog of yet-to-be-spawned ones. Two lanes — **Backlog** (a
queued task with no terminal yet) and **Active** (a task bound to a
live terminal, sub-grouped by agent state). Closing a terminal removes
its task. One concept (Task), no project layer, no markdown files.

## What this changes vs. the parent proposal

- **No Project layer.** Per-repo grouping derives from the bound
  terminal's main repo. The repo sidebar's facets come from
  `Set(tasks.map(t => t.mainRepoRoot))` — no `Project` records to
  create, name, archive, or keep in sync with `recentRepos`.
- **No markdown substrate.** Tasks live in the same JSON state file
  as everything else Kolu persists. There is no obsidian-kanban file
  format, no per-project board, no filesystem watcher, no last-write-wins
  merge layer.
- **Two derived lanes, not user-defined.** `terminalId` absent →
  Backlog; present → Active. The kanban exists to replace the pill
  tree, and the pill tree only ever surfaced live terminals — two
  derived lanes match that scope without inventing vocabulary the
  user has to maintain.
- **No "Done" lane.** Closing the terminal removes the task. Tasks are
  ephemeral: queued intent, then a live terminal, then gone.
- **No new route.** The board *is* the pill tree, expanded on hover.
  Same widget at two density levels — no `/projects/<id>`, no
  `/tasks` page, no router prerequisite.

## User-facing behavior

**Resting state.** Pill tree as today (compact strip of live terminals).

**On hover.** Expands into a kanban with three regions:

- **Repo sidebar** — `All` plus per-repo facets with task counts. Click
  a repo to filter the lanes.
- **Backlog lane** — cards for queued tasks not yet spawned. `+ add`
  row at the bottom takes a title, scoped to the selected repo (prompts
  for one when `All`).
- **Active lane** — cards for tasks bound to a live terminal,
  sub-grouped top to bottom: **⏸ Awaiting** (agent waiting on the
  user) → **⏵ Working** (agent thinking or running tools, animated
  dot) → **⌨ No agent** (terminal alive, no AI agent observed). The
  user-eyes-needed group surfaces first.

**Card actions.**

- Backlog `+ worktree` → opens the existing new-worktree dialog
  pre-filled with this task's repo and name. On dialog success the
  spawned terminal binds to this task (no fresh task is auto-created).
  This is the only "promote" path; the rest of the card is read-only
  metadata.
- Backlog `+ add` → inline title input.
- Active click → focuses that terminal in the canvas.
- Title click → inline rename.
- ✕ → delete. Backlog only. An Active task cannot be deleted from
  the kanban — the only way to remove it is to close its bound
  terminal (the task disappears with the terminal).

## Prototype

```
┌─ pill tree (default) ────────────────────────────────────────────┐
│ ⚡ silver-video  ⏸ stout-proof  ⌨ vira                           │
└──────────────────────────────────────────────────────────────────┘
   ↓ hover
┌─ kanban (all repos) ─────────────────────────────────────────────┐
│ Repos      │ Backlog       Active                                │
│ ────────── │                                                     │
│ ● All   12 │ ┌──────────┐  ⏸ Awaiting (1)                        │
│   kolu   5 │ │ fix auth │  ┌──────────┐                          │
│   eman   4 │ │ kolu     │  │ stout-…  │                          │
│   vira   3 │ │+ worktree│  │ emanote  │                          │
│            │ └──────────┘  │ ⚡ codex  │                          │
│ ────────── │ ┌──────────┐  └──────────┘                          │
│ + new repo │ │ + add    │                                        │
│            │ └──────────┘  ⏵ Working (1)                         │
│            │               ┌──────────┐ ●● pulse                 │
│            │               │ silver-… │                          │
│            │               │ kolu     │                          │
│            │               │ ⚡ claude │                          │
│            │               └──────────┘                          │
│            │                                                     │
│            │               ⌨ No agent (1)                        │
│            │               ┌──────────┐                          │
│            │               │ vira     │                          │
│            │               │ $ shell  │                          │
│            │               └──────────┘                          │
└──────────────────────────────────────────────────────────────────┘
```

## What this gives up vs. the parent proposal

Naming these explicitly so the trade is visible:

- **Topic-only intent without a repo.** Parent supports *"Learn CRDTs"*
  with no `repoPath`. This refinement does not — every task binds to a
  real `mainRepoRoot` (a git repo on disk). A user who wants a topic-
  only task must first create a git repo for it (`git init` somewhere)
  and bind the task to that. `$HOME` is not a repo and is not a
  workaround.
- **"Done" as a visible record.** Parent shows completed tasks in a
  `complete`-role lane with timestamps. This refinement removes the
  task on terminal close; there is no per-task history.
- **Per-project lane vocabulary.** Parent lets the user define
  `🔥 fires`, `Reading`, `In review`, etc. This refinement has Backlog
  + Active only; the user does not name lanes.
- **Cross-project view.** Parent's `/tasks` table aggregates across
  projects. This refinement has the repo-sidebar facet on the same
  surface but no separate route or table.
- **Markdown interop.** Parent's files are obsidian-kanban-readable.
  This refinement keeps tasks inside the JSON state file.

## Decisions

- **Backlog tasks stay queued across restarts.** They are persisted
  state; the server brings them back as Backlog cards on next launch.
  No auto-promote.
- **An Active task cannot be deleted.** Removing it requires closing
  the bound terminal; the task disappears with the terminal. Delete
  (✕) is a Backlog-only affordance.
- **The kanban defaults to All repos.** The repo sidebar starts on
  `All`; per-repo facets are an opt-in filter.
