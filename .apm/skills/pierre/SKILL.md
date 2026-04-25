---
name: pierre
description: Use Pierre Computer Company's `@pierre/trees` (path-first file tree) and `@pierre/diffs` (shiki-based diff renderer) in Kolu. Pierre ships Preact/vanilla cores with optional React wrappers — Kolu consumes the vanilla classes and wraps them in thin SolidJS components. Trigger when: wiring up a file tree, rendering unified diffs, replacing `@git-diff-view`, or any mention of `@pierre/trees` / `@pierre/diffs` / "pierre library".
---

# @pierre/trees + @pierre/diffs integration

Kolu uses two Pierre packages for code-review surfaces (CodeTab):

- `@pierre/trees` — virtualized, path-first file-tree UI with search, git status,
  drag-and-drop, context menus, icons, themes.
- `@pierre/diffs` — shiki-backed unified/split diff renderer with annotations,
  line selection, virtualization, custom hunk separators.

Both publish a **vanilla class API** (Preact-rendered internally) plus optional
React wrappers. Kolu consumes the vanilla core from SolidJS — no React.

- Source for study: `git clone https://github.com/pierrecomputer/pierre /tmp/pierre`
- npm: `@pierre/trees@1.0.0-beta.3`, `@pierre/diffs@1.1.19`

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
// packages/client/src/ui/PierreFileTree.tsx
import { FileTree, type GitStatusEntry } from "@pierre/trees";
import { createEffect, onCleanup, on } from "solid-js";

export type PierreFileTreeProps = {
  paths: string[]; // canonical repo-relative
  gitStatus?: GitStatusEntry[];
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
};

export const PierreFileTree: Component<PierreFileTreeProps> = (props) => {
  let container!: HTMLDivElement;
  let tree: FileTree | undefined;

  // Mount once — class owns its DOM. Don't recreate on prop changes.
  queueMicrotask(() => {
    tree = new FileTree({
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

### Diff wrapper (shape)

```tsx
// packages/client/src/ui/PierreDiffView.tsx
import { FileDiff, parsePatchFiles, DEFAULT_THEMES } from "@pierre/diffs";
import { createEffect, onCleanup } from "solid-js";

export type PierreDiffViewProps = {
  rawDiff: string; // full `git diff` output for one file
  theme?: "light" | "dark";
};

export const PierreDiffView: Component<PierreDiffViewProps> = (props) => {
  let container!: HTMLDivElement;
  let instance: FileDiff | undefined;

  queueMicrotask(() => {
    const parsed = parsePatchFiles(props.rawDiff);
    const fileDiff = parsed[0]?.files[0];
    if (!fileDiff) return;

    instance = new FileDiff({
      theme: DEFAULT_THEMES,
      themeType: props.theme ?? "dark",
      diffStyle: "unified",
      overflow: "wrap",
    });
    instance.render({ containerWrapper: container, fileDiff });
  });

  createEffect(() => instance?.setThemeType(props.theme ?? "dark"));
  onCleanup(() => instance?.cleanUp());

  return <div ref={container!} class="h-full overflow-auto" />;
};
```

Key points:

- **`parsePatchFiles(raw)`** accepts a raw unified-diff string. Kolu's server
  returns `hunks: string[]` where each entry is already a full per-file patch
  (with `--- / +++ / @@` headers). Call `parsePatchFiles(hunks[0])`.
- **`DEFAULT_THEMES`** is `{ dark: 'pierre-dark', light: 'pierre-light' }`.
- **`themeType`** switches between the two at runtime via `setThemeType(t)`.
- **`diffStyle: 'unified' | 'split'`** — split only makes sense for wide panes.

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

Remove after switch:

- `packages/client/src/ui/FileTree.tsx`
- `packages/client/src/ui/buildFileTree.ts`
- `packages/client/src/ui/buildFileTree.test.ts`
- `@git-diff-view/solid` dep
- `highlight.js` dep (if the file browser's content viewer also moves to
  `@pierre/diffs`'s `File` component — same shiki pipeline, one less lib).

Keep (not replaced by pierre):

- `packages/common/src/contract.ts` — `GitDiffOutputSchema` still carries the
  raw unified diff. Consumers now `parsePatchFiles()` it instead of handing
  parsed hunks to `@git-diff-view`.
- Sub-tab state (`local` / `branch` / `browse`) in `useRightPanel` — pierre
  doesn't know about Kolu's diff modes.

## Gotchas

1. **Shadow DOM**: both libs render into a shadow root for CSS isolation.
   Tailwind classes on children won't pierce in. Style via CSS variables or
   `unsafeCSS` option, not Tailwind utilities inside the tree rows.
2. **Path-first identity**: pierre's public API is keyed on path strings. Do
   not store or compare internal numeric IDs.
3. **Async load**: pierre's diff renderer loads shiki WASM lazily. First render
   of a new language is async; the `render()` call returns immediately and the
   rows paint in a later frame. Do not race cleanup.
4. **`setGitStatus([])` clears statuses** — pass `undefined` to leave alone.
5. **`resetPaths` discards expansion state** unless you pass
   `initialExpandedPaths` in the reset options.
6. **Nix `fetchPnpmDeps` hash** must be regenerated after adding new deps; see
   the `nix-typescript` skill.

## Development tips

- Pierre's benchmarks live in `/tmp/pierre/packages/trees/scripts/` and
  `/tmp/pierre/packages/diffs/scripts/` — useful to understand expected usage
  at scale.
- Pierre's own demo: `cd /tmp/pierre && bun install && bun run demo:dev` (but
  their demo is Preact-based; reference only).
- React wrappers in `/tmp/pierre/packages/trees/src/react/` are the clearest
  reference for "what the intended consumer does" — SolidJS wrappers mirror
  their shape.
