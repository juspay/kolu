/** `FileView` — the toggle host of `@kolu/solid-fileview`. Pure mechanism:
 *  it owns the Source ⇄ Rendered toggle, decides which modes a file offers,
 *  and picks the matching rendered appliance. It has *no* rendering
 *  dependencies — the source view and every rendered form are injected
 *  renderers (see `./types`), so the host knows nothing of syntax
 *  highlighting, images, iframes, oRPC, git, or comments.
 *
 *  Mode availability is read straight off the file's shape and the renderer
 *  list:
 *    - source available   ⇔ a `source` renderer was supplied,
 *    - rendered available  ⇔ some `rendered` renderer's `match(path)` is true.
 *  The toggle appears exactly when both are available; otherwise the single
 *  available mode renders with no chrome (today's behaviour for code, images,
 *  and documents alike). */

import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  Show,
} from "solid-js";
import type {
  FileData,
  FileViewMode,
  RenderedRenderer,
  SourceRenderer,
} from "./types";

export type FileViewProps = {
  file: FileData;
  /** Injected source renderer. Omit when the file has no source form
   *  (e.g. a raster image — there's nothing to toggle to). */
  source?: SourceRenderer;
  /** Candidate rendered renderers, tried in order; the first whose `match`
   *  returns true for `file.path` wins. Omit when the file has no rendered
   *  form (e.g. plain source code). */
  rendered?: RenderedRenderer[];
  /** Which mode to show when *both* are available. Defaults to "rendered" —
   *  a document's rendered form is what a reader expects first. */
  defaultMode?: FileViewMode;
  /** Optional CONTROLLED override of the resolved mode. When non-null it wins
   *  over both the user's in-toggle pick and `defaultMode` — the host drives
   *  the surface (e.g. a comment-tray jump forcing the toggle back to the
   *  surface the comment lives on). Each new non-null value re-asserts even if
   *  the user has since toggled away, so re-issuing the same jump re-lands it;
   *  pass a fresh-identity signal value per assertion. Null/undefined → the
   *  component stays self-controlled (toggle + `defaultMode`). */
  mode?: FileViewMode | null;
};

export const FileView: Component<FileViewProps> = (props) => {
  const matchedRendered = createMemo(() =>
    props.rendered?.find((r) => r.match(props.file.path)),
  );
  const hasSource = () => props.source != null;
  const hasRendered = () => matchedRendered() != null;
  const both = () => hasSource() && hasRendered();

  // The user's explicit pick for this mount; null until they touch the
  // toggle, so the resolved mode tracks `defaultMode` reactively until then.
  const [chosen, setChosen] = createSignal<FileViewMode | null>(null);

  // A controlled `mode` assertion adopts the same `chosen` slot the toggle
  // writes — so the host forces the surface, yet the user can still toggle
  // away afterward (their click overwrites `chosen` in turn). A null value is
  // a no-op (the component stays self-controlled on `defaultMode` + toggle);
  // only a non-null value moves the surface, and it fires on the initial run
  // too so a fresh mount whose host already names a surface (a tray jump that
  // remounted this view) lands on it instead of falling back to `defaultMode`.
  createEffect(
    on(
      () => props.mode,
      (m) => {
        if (m != null) setChosen(m);
      },
    ),
  );

  const mode = createMemo<FileViewMode>(() => {
    const picked = chosen();
    if (picked) return picked;
    if (both()) return props.defaultMode ?? "rendered";
    // Only one form exists — show it regardless of any stale default.
    return hasRendered() ? "rendered" : "source";
  });

  // The active appliance, for SINGLE-form files (no toggle — a binary image, a
  // video, a sandboxed iframe, or plain source). Read as a child expression so
  // Solid tracks `props.file`: a save mints a fresh `FileData` (new `url` for a
  // binary, new `content` for text), and the matching renderer has to re-run to
  // pick it up. The earlier `<Show>`-callback form ran the rendered branch once
  // under `untrack` and keyed it on the (stable) matched-renderer identity, so
  // an iframe/image preview captured its first `url` and never reloaded after an
  // edit — only the source view (rendered via the tracked `fallback` slot)
  // updated. One tracked expression keeps both branches symmetric: each
  // re-renders its appliance on a fresh snapshot. (Two-form files take the
  // keep-alive path below, where `KeepAliveMode` owns the same reload-on-edit
  // behaviour via its `heldFile` snapshot.)
  const active = () =>
    mode() === "rendered"
      ? matchedRendered()?.render(props.file)
      : props.source?.render(props.file);

  return (
    <div class="flex h-full w-full flex-col">
      <Show when={both()}>
        <FileViewToggle mode={mode()} onChange={setChosen} />
      </Show>
      <div class="min-h-0 flex-1">
        {/* When a file offers BOTH forms (Markdown's Source ⇄ Rendered), keep
            each mode alive across toggles: mounting the inactive one off-screen
            instead of unmounting it means flipping back doesn't rebuild and
            re-render the appliance (no Markdown re-parse / re-sanitize / re-
            tokenize, no Pierre re-init). Single-form files have nothing to
            toggle to, so they stay on the plain `active()` path — no second
            appliance is ever mounted. */}
        <Show when={both()} fallback={active()}>
          <KeepAliveMode
            show={mode() === "rendered"}
            file={props.file}
            render={(file) => matchedRendered()?.render(file)}
          />
          <KeepAliveMode
            show={mode() === "source"}
            file={props.file}
            render={(file) => props.source?.render(file)}
          />
        </Show>
      </div>
    </div>
  );
};

/** One keep-alive slot of the Source ⇄ Rendered toggle. Mounts its appliance
 *  lazily on first show, then keeps it alive across toggles — hidden with
 *  `display:none` (the `hidden` class) rather than unmounted, so re-showing is a
 *  pure visibility flip, never a rebuild. The file snapshot is frozen while the
 *  slot is hidden (`heldFile`) and adopted the instant it's shown again: a
 *  content edit to a hidden mode is deferred until that mode is next shown,
 *  so a save never re-renders both modes at once. A toggle with no intervening
 *  edit keeps the same `heldFile` reference, so the appliance isn't re-rendered
 *  at all. */
const KeepAliveMode: Component<{
  show: boolean;
  file: FileData;
  render: (file: FileData) => JSX.Element;
}> = (props) => {
  const [visited, setVisited] = createSignal(props.show);
  createEffect(() => {
    if (props.show) setVisited(true);
  });
  const heldFile = createMemo<FileData>((prev) =>
    props.show || prev === undefined ? props.file : prev,
  );
  return (
    <Show when={visited()}>
      {/* `aria-hidden` on the inactive slot mirrors RightPanel's kept-alive
          content pane: `display:none` already removes it from the a11y tree,
          so this is belt-and-suspenders, but it keeps the repo's keep-alive
          slots consistent rather than handling the same hidden-surface a11y
          axis two different ways. */}
      <div
        class="h-full w-full"
        classList={{ hidden: !props.show }}
        aria-hidden={!props.show}
      >
        {props.render(heldFile())}
      </div>
    </Show>
  );
};

/** Segmented Source / Rendered control. Theme-agnostic: it paints with
 *  `currentColor` so it inherits the host's foreground, like the rest of the
 *  package's appliances. */
const FileViewToggle: Component<{
  mode: FileViewMode;
  onChange: (mode: FileViewMode) => void;
}> = (props) => (
  <div
    data-testid="fileview-toggle"
    class="flex shrink-0 items-center gap-0.5 border-b border-current/10 px-2 py-1"
  >
    <For each={["rendered", "source"] as const}>
      {(value) => (
        <button
          type="button"
          data-testid={`fileview-toggle-${value}`}
          aria-pressed={props.mode === value}
          onClick={() => props.onChange(value)}
          class="rounded px-2 py-0.5 text-[0.7rem] font-medium capitalize opacity-60 transition-colors hover:opacity-100 aria-pressed:bg-current/15 aria-pressed:opacity-100"
        >
          {value}
        </button>
      )}
    </For>
  </div>
);
