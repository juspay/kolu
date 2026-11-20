import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";

export const [deepLinkFocusIntent, setDeepLinkFocusIntent] =
  createSignal<TerminalId | null>(null);
