import type { HostKey } from "kolu-common/hostKey";
import type { Component, JSX } from "solid-js";
import { HostIdentityLabel } from "./HostIdentityLabel";

type NoClassAuthorityBag<T> = Omit<T, "class" | "classList">;

function tabStateClass(active: boolean, down: boolean): string {
  return [
    active ? "host-tab-active" : "",
    !active && !down ? "host-tab-idle" : "",
    down ? "host-tab-down" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function labelToneClass(active: boolean, down: boolean): string {
  if (down) return "text-fg-3";
  return active ? "text-fg" : "text-fg-2 hover:text-fg";
}

export const HostChipShell: Component<{
  host: HostKey;
  decoration?: string;
  active?: boolean;
  down?: boolean;
  tab?: NoClassAuthorityBag<JSX.HTMLAttributes<HTMLDivElement>> & {
    "data-asking"?: string;
    "data-unseen"?: string;
  };
  diagnostics?: NoClassAuthorityBag<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>
  > & {
    "data-testid"?: string;
  };
  select?: NoClassAuthorityBag<JSX.ButtonHTMLAttributes<HTMLButtonElement>> & {
    "data-testid"?: string;
  };
  status?: JSX.Element;
  attention: JSX.Element;
  agents?: JSX.Element;
  stripe?: JSX.Element;
}> = (props) => (
  <div
    {...props.tab}
    class={`host-tab relative flex h-8 items-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 has-[:focus-visible]:ring-inset ${tabStateClass(props.active ?? false, props.down ?? false)}`}
  >
    <button
      type="button"
      {...props.diagnostics}
      class="pointer-events-auto ml-2 flex h-7 w-4 shrink-0 items-center justify-center rounded-tl-[10px] transition-colors hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
    >
      {props.status}
    </button>
    <button
      type="button"
      {...props.select}
      class={`pointer-events-auto flex h-8 items-center gap-1.5 pl-1 pr-2.5 transition-colors focus-visible:outline-none cursor-pointer ${labelToneClass(props.active ?? false, props.down ?? false)}`}
    >
      <HostIdentityLabel
        host={props.host}
        labelClass={`truncate max-w-[5rem] lg:max-w-[10rem] font-medium${props.decoration ?? ""}`}
      />
    </button>
    {props.agents}
    {props.attention}
    {props.stripe}
  </div>
);
