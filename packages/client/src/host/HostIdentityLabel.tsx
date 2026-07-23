/** A host's on-screen identity for strip/switcher/mobile chips.
 *
 *  · **local** — Home glyph + the machine hostname kolu-server runs on
 *    (from `server.info` / {@link useServerIdentity}; same value as PWA branding)
 *  · **remote** — ssh target (`user@host`)
 *
 *  Connection status is a separate pip (`chipStatusDot`), not part of identity.
 *  `labelClass` styles the text span (truncation varies per site);
 *  `glyphClass` sizes the local Home icon (default `h-3.5 w-3.5`). */

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
  // Local: Home + real machine name. Fall back to the word "local" only until
  // server.info lands (or if the cosmetic fetch failed).
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
