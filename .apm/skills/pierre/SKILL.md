---
name: pierre
description: >-
  Use Pierre Computer Company's `@pierre/trees` (path-first file tree) and
  `@pierre/diffs` (shiki-based code/diff renderer) in Kolu. Pierre ships
  Preact/vanilla cores with optional React wrappers — Kolu consumes the vanilla
  classes and wraps them in thin SolidJS components. Trigger when: wiring up a
  file tree, rendering unified diffs or syntax-highlighted files, replacing
  `@git-diff-view`, or any mention of `@pierre/trees` / `@pierre/diffs` /
  "pierre library".
---

# @pierre/trees + @pierre/diffs integration

Kolu uses two Pierre packages for code-review surfaces (CodeTab):

- `@pierre/trees` — virtualized, path-first file-tree UI with search, git status,
  drag-and-drop, context menus, icons, themes.
- `@pierre/diffs` — shiki-backed unified/split diff renderer with annotations,
  line selection, virtualization, custom hunk separators. Since 1.2.x, the
  top-level `CodeView` class hosts one or more file/diff items in a single
  virtualized scroll viewport (advanced mode) and supersedes the per-file
  `File` / `FileDiff` / `Virtualizer` trio for kolu's consumer code.

Both publish a **vanilla class API** (Preact-rendered internally) plus optional
React wrappers. Kolu consumes the vanilla core from SolidJS — no React.

- Source for study: `git clone https://github.com/pierrecomputer/pierre /tmp/pierre`
- npm: `@pierre/trees@1.0.0-beta.4`, `@pierre/diffs@1.2.1`

## Why Pierre over hand-rolled

Pierre's libraries encapsulate three things Kolu used to own:

1. **Tree layout and virtualization** (`buildFileTree.ts`, `FileTree.tsx` —
   removed). Pierre handles sort, collapse, sticky folders, keyboard nav,
   virtualization, search, and git status in one pass.
2. **Diff parsing and rendering** (`@git-diff-view/solid` — removed). Pierre
   parses raw unified-diff strings with `parsePatchFiles()` and renders with
   syntax highlighting via Shiki.
3. **Theming**. Pierre reads Shiki themes directly and exposes CSS variables for
   host-page overrides (`--trees-*`, `--diffs-*`).

## SolidJS wrapping pattern

The vanilla classes own their DOM. SolidJS wrappers are thin — they only
**mount**, **update options reactively**, and **clean up**. No re-render loop,
no framework-internal state.

### FileTree wrapper (shape)

```tsx
// packages/solid-pierre/src/FileTree.tsx (sketch)
import { FileTree, type GitStatusEntry } from "@pierre/trees";
import { createEffect, onCleanup, on } from "solid-js";

export type FileTreeProps = {
  paths: string[]; // canonical repo-relative
  gitStatus?: GitStatusEntry[];
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
};

export const FileTree: Component<FileTreeProps> = (props) => {
  let container!: HTMLDivElement;
  let tree: FileTreeClass | undefined;

  // Mount once — class owns its DOM. Don't recreate on prop changes.
  queueMicrotask(() => {
    tree = new FileTreeClass({
      paths: props.paths,
      initialExpansion: "open",
      search: true,
      gitStatus: props.gitStatus,
      onSelectionChange: (paths) => props.onSelect?.(paths[0] ?? ""),
    });
    tree.render({ containerWrapper: container });
  });

  // Reactively push updates via setters — `resetPaths`, `setGitStatus` patch
  // in place without rerenders.
  createEffect(
    on(
      () => props.paths,
      (paths) => tree?.resetPaths(paths),
      { defer: true },
    ),
  );
  createEffect(
    on(
      () => props.gitStatus,
      (g) => tree?.setGitStatus(g),
      { defer: true },
    ),
  );

  onCleanup(() => tree?.cleanUp());

  return <div ref={container!} class="h-full" />;
};
```

Key points:

- **Mount in `queueMicrotask`** (or `onMount`) — the container div must be in
  the DOM before `render()`.
- **Pass callbacks through `props.onSelect?.()`** — don't capture at mount
  time, the prop ref may change. Pierre calls back through the current closure.
- **Use setters for updates** (`resetPaths`, `setGitStatus`, `setIcons`,
  `setComposition`) — never reconstruct `FileTree` on prop change.
- **`defer: true`** on the effects so the initial mount doesn't fire them.
- **`onCleanup(() => tree?.cleanUp())`** is mandatory — leaks the shadow root
  otherwise.

### Git status mapping

Kolu's `GitChangeStatus` is a single letter (M / A / D / R / C / U / T / ?).
Pierre's `GitStatus` is a word (`modified`, `added`, `deleted`, `renamed`,
`untracked`, `ignored`). Map at the call site:

```ts
const MAP: Record<GitChangeStatus, GitStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  U: "modified",
  T: "modified",
  "?": "untracked",
};
```

No hand-built tree needed. Pass the flat `files.map(f => f.path)` directly to
`paths` and `files.map(f => ({ path: f.path, status: MAP[f.status] }))` to
`gitStatus`. Pierre handles hierarchy, collapse-chains, and sort.

### File-browser (lazy load) mode

`@pierre/trees` expects the full path list up front. For a lazy "browse the
whole repo" mode, there are two options:

1. **Eagerly list all paths once** — simpler, fine up to ~50k files. Use the
   server's `fs.listDir` recursively or add an `fs.listAll` endpoint.
2. **Synthesize paths on demand** and call `tree.add(path)` / `tree.batch([...])`
   as directories expand. Subscribe to the tree's expand events via the
   controller; requires deeper API reading.

The prototype replacement started with (1) — simpler, matches Pierre's
path-first model.

### CodeView wrapper (shape)

Since `@pierre/diffs@1.2`, the top-level `CodeView` class is the rendering
substrate for both files and diffs. Kolu's `@kolu/solid-pierre` exposes a
single `<CodeView>` Solid wrapper around it; the older per-class
`<FileView>` / `<FileDiff>` / `<Virtualizer>` trio is retired.

```tsx
// packages/solid-pierre/src/CodeView.tsx (sketch)
import {
  CodeView as CodeViewClass,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  DEFAULT_THEMES,
} from "@pierre/diffs";

export type CodeViewProps = {
  items: readonly CodeViewItem[];
  theme: "light" | "dark";
  diffStyle?: "unified" | "split";
  overflow?: "scroll" | "wrap";
  enableLineSelection?: boolean;
  selectedLines?: CodeViewLineSelection | null;
  onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
  onError: (err: Error) => void;
  class?: string;
  style?: JSX.CSSProperties;
};

export const CodeView: Component<CodeViewProps> = (props) => {
  let root!: HTMLDivElement;
  let instance: CodeViewClass | undefined;

  const buildOptions = (): CodeViewOptions<undefined> => ({
    theme: DEFAULT_THEMES,
    themeType: props.theme,
    diffStyle: props.diffStyle ?? "unified",
    overflow: props.overflow ?? "wrap",
    enableLineSelection: props.enableLineSelection ?? false,
    onSelectedLinesChange: (s) => props.onSelectedLinesChange?.(s),
  });

  onMount(() => {
    instance = new CodeViewClass(buildOptions());
    instance.setup(root);  // root IS the scroll container
    instance.setItems(props.items);
  });

  createEffect(on(() => props.items, (items) => instance?.setItems(items), { defer: true }));
  createEffect(on(() => props.theme,  () => instance?.setOptions(buildOptions()), { defer: true }));
  onCleanup(() => instance?.cleanUp());

  return <div ref={root} class={props.class} style={props.style} />;
};
```

Key points:

- **The root `<div>` IS Pierre's scroll container.** `setup(root)` registers it
  as the scroller. Put `overflow-auto` and sizing on it directly; do not nest
  another scroller inside.
- **`items` is typed.** Pass `{ id, type: "file", file: { name, contents } }`
  for a file or `{ id, type: "diff", fileDiff }` for a diff. Get the
  `FileDiffMetadata` via `parsePatchFiles(raw)[0]?.files[0]` from the call
  site — `parsePatchFiles` is the top-level Pierre API for raw unified-diff
  strings.
- **Single-file case** is just `items={[oneItem]}`. Pierre virtualizes
  unconditionally; there is no vanilla branch to opt into.
- **Selection is item-scoped.** `CodeViewLineSelection` is `{ id, range }` —
  the `id` must match one of the items currently in the viewport. When the
  rendered item changes (path swap), update `selectedLines` to either point
  at the new id or null.
- **Version tracking.** Pierre's `reconcileItems` keeps the previous record
  when an item's `version` is unchanged — passing a fresh `fileDiff`/`file`
  for the same `id` without bumping `version` leaves stale content on screen.
  The wrapper diffs incoming items by reference and bumps `version`
  internally so callers don't deal with the field. If you build your own
  wrapper, replicate that bump.
- **Advanced mode bypasses legacy bugs.** `VirtualizedFile.setVisibility` and
  `VirtualizedFileDiff.setVisibility` both early-return in advanced mode
  (`isAdvancedMode()` check), so the `setVisibility` upstream-bug workaround
  the old wrappers carried is no longer needed under `CodeView`.

## Peer dependencies

Both packages declare `react`, `react-dom` as **peer** dependencies. They're
only needed for the `./react` entry points. The vanilla core bundles `preact` +
`preact-render-to-string` as regular deps, so **no React install is required**
when consuming `@pierre/trees` / `@pierre/diffs` directly from SolidJS.

Suppress peer-dep warnings in `pnpm-workspace.yaml` or `.npmrc`:

```yaml
# pnpm-workspace.yaml
packageExtensions:
  "@pierre/trees@*":
    peerDependenciesMeta:
      react: { optional: true }
      react-dom: { optional: true }
  "@pierre/diffs@*":
    peerDependenciesMeta:
      react: { optional: true }
      react-dom: { optional: true }
```

## Theming hookup

Trees reads CSS variables; expose kolu's theme tokens by setting them on the
host element's inline style (or a wrapper class):

```css
.pierre-trees-host {
  --trees-fg-override: theme(colors.fg);
  --trees-selected-bg-override: theme(colors.surface.2);
  --trees-border-color-override: theme(colors.edge);
}
```

For diffs, prefer `DEFAULT_THEMES` (pierre-dark/pierre-light) initially. Move
to Kolu-branded Shiki themes later via `registerCustomTheme()` if needed.

## What to port, what to keep

Removed in earlier passes (no longer in the tree):

- `packages/client/src/ui/FileTree.tsx`
- `packages/client/src/ui/buildFileTree.ts`
- `packages/client/src/ui/buildFileTree.test.ts`
- `@git-diff-view/solid` dep
- `highlight.js` dep — the file browser's content viewer now runs through
  `@pierre/diffs`'s `CodeView` (file item), same shiki pipeline.

Removed when `CodeView` landed:

- `packages/solid-pierre/src/Virtualizer.tsx` — context-based dispatcher for
  vanilla vs. virtualized; advanced mode makes virtualization unconditional.
- `packages/solid-pierre/src/FileView.tsx` — single-file viewer wrapper. The
  rAF + line-height-estimate `scrollToLine` fallback and the
  `setVisibility` upstream-bug patch retired with it.
- `packages/solid-pierre/src/FileDiff.tsx` — single-diff viewer wrapper.

Keep (not replaced by pierre):

- `packages/common/src/contract.ts` — `GitDiffOutputSchema` still carries the
  raw unified diff. Consumers now `parsePatchFiles()` it instead of handing
  parsed hunks to `@git-diff-view`.
- Sub-tab state (`local` / `branch` / `browse`) in `useRightPanel` — pierre
  doesn't know about Kolu's diff modes.

## Gotchas

1. **Shadow DOM**: both libs render into a shadow root for CSS isolation.
   Tailwind classes on children won't pierce in. Style via CSS variables or
   `unsafeCSS` option, not Tailwind utilities inside the tree rows. `CodeView`
   creates one `<diffs-container>` shadow root per item — selection-walkers
   must descend recursively (see `packages/client/src/comments/shadowWalk.ts`).
2. **Path-first identity**: pierre's public API is keyed on path strings. Do
   not store or compare internal numeric IDs. `CodeViewItem.id` is also
   path-keyed by convention.
3. **Async load**: pierre's diff renderer loads shiki WASM lazily. First render
   of a new language is async; the `render()` call returns immediately and the
   rows paint in a later frame. Do not race cleanup.
4. **`setGitStatus([])` clears statuses** — pass `undefined` to leave alone.
5. **`resetPaths` discards expansion state** unless you pass
   `initialExpandedPaths` in the reset options.
6. **`setItems` reconciles by id**; same-id same-version is treated as
   no-change. Bump `version` when content swaps for an existing id.
7. **Nix `fetchPnpmDeps` hash** must be regenerated after adding new deps; see
   the `nix-typescript` skill.

## Development tips

- Pierre's benchmarks live in `/tmp/pierre/packages/trees/scripts/` and
  `/tmp/pierre/packages/diffs/scripts/` — useful to understand expected usage
  at scale.
- Pierre's own demo: `cd /tmp/pierre && bun install && bun run demo:dev` (but
  their demo is Preact-based; reference only).
- React wrappers in `/tmp/pierre/packages/diffs/src/react/` are the clearest
  reference for "what the intended consumer does" — especially
  `react/CodeView.tsx`, which mirrors the SolidJS wrapper's prop shape.
