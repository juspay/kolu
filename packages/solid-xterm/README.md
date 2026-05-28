# @kolu/solid-xterm

Solid-native adapter for [xterm.js](https://xtermjs.org/). One
primitive — `createSolidXterm(opts) → SolidXtermHandle` — that takes
the place of `new XTerm(...)` and owns:

- XTerm construction with reactive `theme` / `fontSize` accessors
  threaded into the initial constructor options + an internal
  `defer:true` effect that pushes subsequent changes through.
- The standard addon set (FitAddon, WebLinksAddon, SearchAddon,
  ImageAddon, Unicode11Addon, SerializeAddon, optional
  ClipboardAddon). Each defaults to *on*; per-addon opt-out via
  `addons: { search: false, ... }`.
- WebGL lifecycle policy — a reactive `enabled` predicate flips
  the WebglAddon on/off; the `.xterm-screen canvas:not(.xterm-link-layer)`
  selector trap, explicit `WEBGL_lose_context.loseContext()` before
  `addon.dispose()` (within Chrome's per-tab GPU context budget),
  and the re-entry guard against `webglcontextlost` all live
  internally. Observation hooks (`onCreate` / `onLoseContextCalled` /
  `onDispose`) let the host wire its own debug ledger without
  coupling the framework to it.
- Scroll-lock state machine — when the user scrolls up, incoming
  writes buffer (via `xterm.write(data)`) instead of passing
  through; flush on return-to-bottom. xterm's `buffer.active.baseY`
  vs `viewportY` math lives inside.
- RAF-debounced `fit()` for ResizeObserver-driven callers.

## API at a glance

```ts
import { createSolidXterm } from "@kolu/solid-xterm";

const xterm = createSolidXterm({
  fontFamily: "Berkeley Mono",
  theme: () => preferences().theme,
  fontSize,                              // Accessor<number>
  scrollback: 10_000,
  cursorBlink: true,
  addons: {
    clipboard: { provider: myClipboardProvider },
    // search: false,                     // opt out individually
  },
  webgl: {
    enabled: () =>
      preferences().renderer === "webgl" ||
      (preferences().renderer === "auto" && tileIsFocusedAndVisible()),
    onCreate: (canvas) => myObserver.note(canvas),
  },
  scrollLock: () => preferences().scrollLock,
  onTerm: (term) => {
    // Called after construction + addon attach + term.open(container).
    // Register link providers, custom key handlers, PTY stream
    // consumers, etc.
    term.attachCustomKeyEventHandler(...);
    consumeStream(streamFn, (data) => xterm.write(data));
  },
});

onMount(() => {
  const owner = getOwner();
  void (async () => {
    await document.fonts.load(`1em ${FONT_FAMILY}`);
    runWithOwner(owner, () => xterm.mount(containerRef));
  })();
});
```

The handle exposes:

- `xterm.term()` — reactive accessor, the live `XTerm` (null pre-mount).
- `xterm.fit()` — RAF-debounced. Safe to call from a `ResizeObserver`.
- `xterm.write(data)` — scroll-lock-aware. Use instead of
  `term.write(data)` for PTY output.
- `xterm.addons.{ fit, search, serialize }` — reactive addon refs.
- `xterm.scrollLock.{ locked, hasNewOutput, toBottom, reset }` —
  scroll-lock state + commands.
- `xterm.webgl.{ enabled, atlas, clearTextureAtlas }` — WebGL state
  + diagnostic probes + manual atlas clear.

## Why one primitive, not three loose helpers

Earlier iterations of this package (`0.1.x`) shipped
`createXtermWebgl`, `attachXtermStyleSync`, and `createScrollLock`
as three parallel public exports. The consumer had to import the
three of them, hold `new XTerm(...)` themselves, wire `term.open()`,
attach the addons, plug each helper's `onTerm`/`getTerm` hooks
together, and integrate everything by hand. That surface was *partial
wiring*: it gave you three xterm-adjacent helpers, not a SolidJS
adapter for xterm.

`0.2.x` ships one primitive that takes the place of `new XTerm(...)`
and hides the three lifecycle submodules under `./internal/`. The
package's name promises *a coherent SolidJS adapter for xterm*; the
shape now delivers that.

The discipline this follows is the same one
[`@kolu/surface`](https://kolu.dev/blog/surface-framework/) set:
extract a coherent primitive behind one entry point, hide the
internal axes, let consumers integrate via a small declarative
options object plus one `onTerm` callback for the live term.

## Reactive ownership

Call `createSolidXterm(opts)` synchronously in your component body —
it registers the scroll-lock's `createEffect` under the current
owner. Call `handle.mount(el)` later (typically from `onMount`
after awaiting `document.fonts.load(...)`). If `mount` is called
across an `await`, wrap in `runWithOwner(componentOwner, () =>
handle.mount(el))` so the mount-time effects (style sync, WebGL
policy, scroll-lock onScroll handler) register on the right owner.
The handle's own `onCleanup` (registered inside `mount`) tears
down the WebGL context, disposes the XTerm, and cancels the
debounced-fit RAF when the owner disposes.
