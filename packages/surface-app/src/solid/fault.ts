/**
 * `SurfaceFaultBoundary` — what an app's own render throwing must NOT look
 * like: a white tab with the truth in a console nobody opened.
 *
 * A throw while drawing unmounts the subtree that faulted — Solid does that
 * either way; the only choice is between a card that says so and a blank page.
 * This boundary is the framework's half of that card. It CATCHES (an
 * `Errored` boundary around whatever it wraps — the composition root wraps the
 * whole shell, because a client that threw mid-render is not running the code
 * that would draw any in-app error screen). It RECORDS (one `console.error`
 * naming the moment — a boundary SWALLOWS, and Solid re-throws only when
 * nothing catches, so without this line a page that faulted after its first
 * frame reaches no console at all, and a browser test fails as a bare timeout
 * on a missing element with its "no page errors" assertion beside it green).
 * And it PRINTS (`thrownText` — the fault arrives as `unknown`, and a card
 * that summarised it would be the white tab with extra steps).
 *
 * The one thing it does not own is the LOOK. `fault` is the consumer's markup,
 * handed the printed text verbatim — the same cut the readout makes: the
 * framework decides what is true, the app decides what it looks like.
 *
 * `<SurfaceAppProvider>` composes this boundary over its children off its own
 * REQUIRED `fault` prop — the way the connect seams require `retired` — so an
 * app shell built on the provider cannot compile without saying what an
 * uncaught throw looks like. An app whose root plumbing does not ride the
 * provider composes this boundary directly around its shell.
 *
 * Written without JSX (uses `createComponent`), like the rest of `/solid`, so
 * it's safely consumable from `node_modules`.
 */

import { createComponent, createEffect, Errored } from "solid-js";
import type { JSX } from "@solidjs/web";
import { thrownText } from "../index";

/** The LOOK of an uncaught throw — the one thing a consumer supplies. Handed
 *  the fault as `thrownText` printed it: verbatim and never empty, because
 *  that text is what a bug report is made of. */
export type FaultLook = (text: string) => JSX.Element;

export interface SurfaceFaultBoundaryProps {
  /** The markup an uncaught throw is drawn with. See {@link FaultLook}. */
  fault: FaultLook;
  children: JSX.Element;
}

/** Catch, record, and print an uncaught render throw; draw it with the app's
 *  own `fault` LOOK. See the module docstring for why all three verbs live
 *  here and only the LOOK stays with the app. */
export function SurfaceFaultBoundary(
  props: SurfaceFaultBoundaryProps,
): JSX.Element {
  return createComponent(Errored, {
    // `Errored` hands its fallback the fault as an ACCESSOR (and a `reset` this
    // boundary does not offer: a client that threw mid-render is reloaded, not
    // retried in place). The fallback body is a render scope, so the accessor
    // is read where reads are tracked — the effect's compute and the returned
    // render function — never at its top level.
    fallback: (error: () => unknown) => {
      // THE RECORD, and it is not decoration: the boundary swallows, so this
      // line is the only way the fault reaches a console at all. One line
      // naming the moment, the way `createSurfaceSocket` records a retirement.
      createEffect(error, (fault) => {
        console.error(
          "surface-app: this client threw while drawing the page —",
          fault,
        );
      });
      return () => props.fault(thrownText(error()));
    },
    get children() {
      return props.children;
    },
  });
}
