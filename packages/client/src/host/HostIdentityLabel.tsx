import type { HostKey } from "kolu-common/hostKey";
import { type Component, Show } from "solid-js";
import { HomeIcon } from "../ui/Icons";
import { useServerIdentity } from "../useServerIdentity";
import { hostLabel } from "./hostChipTone";

export const HostIdentityLabel: Component<{
  host: HostKey;
  labelClass?: string;
  glyphClass?: string;
}> = (props) => {
  const { hostname } = useServerIdentity();
  const localName = () => hostname() ?? hostLabel(props.host);

  return (
    <Show
      when={props.host.kind === "local"}
      fallback={<span class={props.labelClass}>{hostLabel(props.host)}</span>}
    >
      <HomeIcon
        class={`${props.glyphClass ?? "h-3.5 w-3.5"} shrink-0 opacity-80`}
      />
      <span class={props.labelClass}>{localName()}</span>
    </Show>
  );
};
