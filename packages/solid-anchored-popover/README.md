# @kolu/solid-anchored-popover

Minimal SolidJS popover-positioning primitive. Anchors a panel to a
trigger element, clamps to the viewport, dismisses on outside-click
or Escape. No DOM rendering — the consumer renders the panel via
`<Portal>` and binds the returned `panelRef` + `panelStyle()`.

Six in-tree Kolu consumers today (option menu, settings popover,
record-popover, mode-chip picker, activity-window chip, PR-unavailable
tooltip); the highest-reuse SolidJS primitive Kolu had. The
extraction is justified by the in-tree reuse (the same single-bar
the larger framework extractions cleared) plus the externalizability
of a pure positioning helper.

## Why not Corvu / Floating UI?

Both are heavier than this one needs. Corvu's Popover is component-
shaped (you render `<Popover.Trigger />` and `<Popover.Content />`);
this hook stays close to the imperative `getBoundingClientRect` +
position math so consumers stay in control of the DOM and the
portal target.

## Encapsulated axis

Viewport-clamped positioning + dismiss policy. The axis has already
shifted (added `top-start` / `top-end` upward variants, the
`portalled` background-color fallback for Firefox); the receptacle
absorbs the next change.

## API

```ts
const { panelRef, panelStyle } = useAnchoredPopover({
  triggerRef: () => myButton,        // signal-backed accessor — handles remounts
  open: () => isOpen(),              // doc listeners only attached while true
  onDismiss: () => setIsOpen(false), // outside-click + Escape go here
  anchor: "bottom-end",              // bottom-start | bottom-end | top-start | top-end
  panelMinWidth: 240,                // for viewport clamp on left-anchored variants
  offset: 4,                         // gap between trigger and panel
});

return <Portal>
  <div ref={panelRef} style={panelStyle()}>...</div>
</Portal>;
```
