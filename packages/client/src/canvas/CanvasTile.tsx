/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). Shell only: positioning,
 *  title bar, resize handle. Terminal rendering delegated to TerminalContent. */

import type { Component } from "solid-js";
import { createDraggable } from "@thisbeyond/solid-dnd";
import type { ITheme } from "@xterm/xterm";
import TerminalContent from "../terminal/TerminalContent";
import TerminalMeta from "../terminal/TerminalMeta";
import { ResizeGripIcon } from "../ui/Icons";
import type { TileLayout } from "./useCanvasLayouts";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const DEFAULT_W = 700;
const DEFAULT_H = 500;

const CanvasTile: Component<{
  id: TerminalId;
  parent: {
    activeId: TerminalId | null;
    getTerminalTheme: (id: TerminalId) => ITheme;
    getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
    getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
    onSelect: (id: TerminalId) => void;
    onCloseTerminal: (id: TerminalId) => void;
    onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
    activeMeta: TerminalMetadata | null;
    searchOpen: boolean;
    onSearchOpenChange: (open: boolean) => void;
    subTerminalIds: (id: TerminalId) => TerminalId[];
  };
  layouts: Record<string, TileLayout>;
  startResize: (id: TerminalId, e: PointerEvent) => void;
  zoom: () => number;
}> = (props) => {
  const { id } = props;
  const draggable = createDraggable(id);
  const isActive = () => props.parent.activeId === id;
  const theme = () => props.parent.getTerminalTheme(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  const themeBg = () => theme().background ?? "var(--color-surface-1)";
  const themeFg = () => theme().foreground ?? "var(--color-fg)";

  return (
    <div
      ref={draggable.ref}
      class="absolute flex flex-col rounded-xl overflow-hidden border transition-shadow duration-200"
      classList={{
        "border-accent/60 shadow-xl": isActive(),
        "border-edge/40 hover:border-edge/60": !isActive(),
      }}
      style={{
        left: `${layout().x}px`,
        top: `${layout().y}px`,
        width: `${layout().w}px`,
        height: `${layout().h}px`,
        "background-color": themeBg(),
        "z-index": isActive() ? 10 : 1,
        opacity: isActive() ? 1 : 0.92,
        "box-shadow": isActive()
          ? `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--color-accent)`
          : `0 2px 8px rgba(0,0,0,0.2)`,
        // Drag transform is screen-space — divide by zoom so the tile
        // moves at the correct rate in the scaled canvas coordinate system.
        transform: `translate(${draggable.transform.x / props.zoom()}px, ${draggable.transform.y / props.zoom()}px)`,
      }}
      onMouseDown={() => props.parent.onSelect(id)}
    >
      {/* Title bar — uses terminal foreground at low opacity for guaranteed
       *  contrast against the terminal background, regardless of theme. */}
      <div
        class="flex items-center gap-2 px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none"
        style={{
          "background-color": `color-mix(in oklch, ${themeFg()} 8%, ${themeBg()})`,
          "border-bottom": `1px solid color-mix(in oklch, ${themeFg()} 12%, ${themeBg()})`,
          "--color-fg": themeFg(),
          "--color-fg-2": `color-mix(in oklch, ${themeFg()} 75%, ${themeBg()})`,
          "--color-fg-3": `color-mix(in oklch, ${themeFg()} 55%, ${themeBg()})`,
        }}
        {...draggable.dragActivators}
      >
        <div class="flex-1 min-w-0">
          <TerminalMeta info={props.parent.getDisplayInfo(id)} />
        </div>
        <button
          class="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm"
          style={{
            color: `color-mix(in oklch, ${themeFg()} 50%, ${themeBg()})`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.parent.onCloseTerminal(id);
          }}
          title="Close terminal"
        >
          ×
        </button>
      </div>

      {/* Terminal content — shared with focus mode */}
      <TerminalContent
        terminalId={id}
        visible={true}
        focused={isActive()}
        theme={theme()}
        searchOpen={isActive() && props.parent.searchOpen}
        onSearchOpenChange={props.parent.onSearchOpenChange}
        subTerminalIds={props.parent.subTerminalIds(id)}
        getMetadata={props.parent.getMetadata}
        onCreateSubTerminal={props.parent.onCreateSubTerminal}
        onCloseTerminal={props.parent.onCloseTerminal}
        activeMeta={props.parent.activeMeta}
        onFocus={() => props.parent.onSelect(id)}
      />

      {/* Resize handle — bottom-right corner, larger hit area */}
      <div
        class="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity"
        onPointerDown={(e) => props.startResize(id, e)}
      >
        <span
          class="absolute bottom-0.5 right-0.5"
          style={{
            color: `color-mix(in oklch, ${themeFg()} 40%, ${themeBg()})`,
          }}
        >
          <ResizeGripIcon />
        </span>
      </div>
    </div>
  );
};

export default CanvasTile;
