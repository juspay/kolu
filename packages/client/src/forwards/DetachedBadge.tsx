import type { Component } from "solid-js";
import Chip from "../ui/Chip";

export const DetachedBadge: Component<{ testid: string }> = (props) => (
  <Chip
    tone="warning"
    title="served by a process that left every terminal"
    data-testid={props.testid}
  >
    detached
  </Chip>
);
