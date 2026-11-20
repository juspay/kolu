import { type Component, type JSX, Show } from "solid-js";
import DocLink, { type DocSlug } from "../ui/DocLink";

const TONE_CONFIG = {
  muted: { colorClass: "text-fg-3/70", glyph: "" },
  warn: { colorClass: "text-warning", glyph: "⚠ " },
} as const;

export type Hint = { text: string; tone?: keyof typeof TONE_CONFIG };

const SettingHint: Component<{
  hint: Hint;
  class?: string;
}> = (props) => {
  const cfg = () => TONE_CONFIG[props.hint.tone ?? "muted"];
  return (
    <p
      class={`text-xs whitespace-pre-line leading-relaxed ${cfg().colorClass} ${props.class ?? ""}`}
    >
      <Show when={cfg().glyph}>
        <span aria-hidden="true">{cfg().glyph}</span>
      </Show>
      {props.hint.text}
    </p>
  );
};

const SettingRow: Component<{
  label: string;
  icon?: JSX.Element;
  hint?: Hint;
  details?: JSX.Element;
  doc?: DocSlug;
  aside?: JSX.Element;
  children: JSX.Element;
}> = (props) => (
  <div>
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span class="flex items-center gap-1.5 text-sm font-medium text-fg">
        {props.icon}
        {props.label}
      </span>
      {props.children}
    </div>
    <Show when={props.hint}>
      {(hint) => <SettingHint hint={hint()} class="mt-1.5" />}
    </Show>
    {props.details}
    <Show when={props.doc}>
      {(slug) => (
        <div class="mt-1 flex items-baseline gap-3 text-xs">
          <DocLink slug={slug()}>Docs →</DocLink>
          {props.aside}
        </div>
      )}
    </Show>
  </div>
);

export default SettingRow;
