import {
  type Accessor,
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

export type FileViewProps<TFile extends FileData = FileData> = {
  file: TFile;
  /** Injected source renderer. Omit when the file has no source form
   *  (e.g. a raster image — there's nothing to toggle to). */
  source?: SourceRenderer<TFile>;
  /** Candidate rendered renderers, tried in order; the first whose `match`
   *  returns true for `file.path` wins. Omit when the file has no rendered
   *  form (e.g. plain source code). */
  rendered?: RenderedRenderer<TFile>[];
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

export function FileView<TFile extends FileData = FileData>(
  props: FileViewProps<TFile>,
): JSX.Element {
  const matchedRendered = createMemo(() =>
    props.rendered?.find((r) => r.match(props.file.path)),
  );
  const hasSource = () => props.source != null;
  const hasRendered = () => matchedRendered() != null;
  const both = () => hasSource() && hasRendered();

  const [chosen, setChosen] = createSignal<FileViewMode | null>(null);

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
    return hasRendered() ? "rendered" : "source";
  });

  const activeRenderer = createMemo(() =>
    mode() === "rendered" ? matchedRendered() : props.source,
  );
  const active = () => (
    <Show when={activeRenderer()} keyed>
      {(renderer) => renderer.render(() => props.file)}
    </Show>
  );

  return (
    <div class="flex h-full w-full flex-col">
      <Show when={both()}>
        <FileViewToggle mode={mode()} onChange={setChosen} />
      </Show>
      <div class="relative min-h-0 flex-1">
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
}

function KeepAliveMode<TFile extends FileData>(props: {
  show: boolean;
  file: TFile;
  render: (file: Accessor<TFile>) => JSX.Element;
}): JSX.Element {
  const visited = createMemo<boolean>((was) => was || props.show, false);
  const heldFile = createMemo<TFile>((prev) =>
    props.show || prev === undefined ? props.file : prev,
  );
  return (
    <Show when={visited()}>
      <div
        class="h-full w-full"
        style={{
          position: props.show ? "relative" : "absolute",
          inset: "0",
          "content-visibility": props.show ? "visible" : "hidden",
        }}
        inert={!props.show}
        aria-hidden={!props.show}
      >
        {props.render(heldFile)}
      </div>
    </Show>
  );
}

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
