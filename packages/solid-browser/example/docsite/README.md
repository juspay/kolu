# docsite — a standalone example for @kolu/solid-browser

A tiny **doc browser**: a sidebar of pages, a content pane, and ◀ ▶ buttons that
go back and forward through the pages you've visited — like any web browser.
(Your mouse's dedicated back/forward buttons work too.)

```
┌───────────────────────────────────────────────────────────┐
│ ◀  ▶   docsite://history         @kolu/solid-browser · …   │  ← ◀/▶ = createBrowser
├──────────────┬────────────────────────────────────────────┤
│ Pages        │  Back & forward, for free                   │
│  Welcome     │                                             │
│  The browser…│  A browser has history the way a heart has  │
│ ▸The browser │  chambers. Once every navigation routes …   │
│  Back & forw…│                                             │
│  createBrow… │  Read next   [ The createBrowser API → ]    │
│  FAQ         │              [ The browser is … → ]         │
└──────────────┴────────────────────────────────────────────┘
```

The twist: the pages are a **mini handbook about `@kolu/solid-browser` itself**,
so reading the site both *demonstrates* and *explains* the package.

## What it actually proves

`@kolu/solid-browser`'s claim is that the history controller (`createBrowser`)
is reusable — kolu's Code tab is just one host that injects "git repo + mode →
file" behind it. A reuse claim needs a **second, unrelated host actually
plugging in**, or it's just a nicely-factored package. This app is that host.

It injects an entirely different volatility, and reuses the controller verbatim:

| | kolu's Code tab | this doc-site |
| --- | --- | --- |
| Location type | `{ mode, path, ref }` | `{ slug }` |
| Resolves a location by | git, per mode | a static `slug → page` map ([`docs.ts`](src/client/docs.ts)) |
| Renders with | `@kolu/solid-fileview` + Pierre | ~70 lines of Solid ([`App.tsx`](src/client/App.tsx)) |
| Back / forward | `createBrowser` | **the same `createBrowser`** |

The entire integration is [`src/docsite.ts`](src/docsite.ts) (~40 lines): it
adds only `slug → page` resolution; the back/forward feature *is* the injected
controller, untouched. `App.tsx` renders whatever page the controller says is
current and routes clicks back into it — the ◀ ▶ enablement and the content
track navigation reactively, with no extra wiring.

## Run it

```sh
just dev        # boots the Vite client — open the printed http://localhost URL
just build      # static bundle → dist/
just test       # the reuse-proof unit test (no browser needed)
just typecheck
```

`just test` ([`src/docsite.test.ts`](src/docsite.test.ts)) drives the site like
a reader — follow links, go back, go forward, fork history by opening a new page
after a back — and asserts the right page shows at each step. It's also built and
checked in CI (`nix build .#solid-browser-example-docsite`), so the second
consumer can't silently rot.
