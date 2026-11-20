import type { Component, JSX } from "solid-js";

const CanvasCreateSurface: Component<{
  onCreate: () => void;
  backdrop: JSX.Element;
  children?: JSX.Element;
}> = (props) => (
  <div class="relative flex-1 min-h-0">
    <button
      type="button"
      data-testid="canvas-container"
      aria-label="New terminal"
      class="absolute inset-0 canvas-grid-bg cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
      onDblClick={() => props.onCreate()}
      onClick={(e) => {
        if (e.detail === 0) props.onCreate();
      }}
    />
    <div class="absolute inset-0 pointer-events-none">{props.backdrop}</div>
    {props.children}
  </div>
);

export default CanvasCreateSurface;
