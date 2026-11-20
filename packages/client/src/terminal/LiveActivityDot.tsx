import type { Component } from "solid-js";

const LiveActivityDot: Component = () => {
  return (
    <span
      data-testid="live-activity-dot"
      class="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-ok motion-safe:animate-pulse ring-2 ring-ok/25"
      title="Live — output updating"
    />
  );
};

export default LiveActivityDot;
