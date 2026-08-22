/**
 * The loopback-wired stdio link — ONE harness, shared by every test that needs
 * a real served surface behind a real `stdioLink` without forking a subprocess.
 *
 * It is the same five steps every time — `createLoopbackPair` → `serveOverStdio`
 * → `greetLoopback` (the real banner, on the real wire, which is the gate
 * `stdioLink` demands) → `stdioLink` → a teardown that disposes, ends both write
 * halves and awaits the server — and two files had written it out independently
 * (`stdio.test.ts` and `stdioPingStall.test.ts`) over a character-identical
 * `math.add` surface. Two copies of a harness is two places for the gate, the
 * teardown order or the framing to drift, and the whole basis of "a green
 * loopback test is evidence about the ssh leg" is that this sequence is the real
 * one.
 *
 * The teardown awaits `serving` STRICTLY — no `.catch`. The two files disagreed
 * about that (`stdio.test.ts` bare, the stall file guarded), and the bare one is
 * right: `serveOverStdio` RESOLVES with a {@link ServeOverStdioEnd} saying how it
 * ended and never rejects, so a `.catch` there guarded nothing while reading as
 * if a rejection were expected. Ending both write halves is what delivers the
 * EOF it settles on, whether the link died of a ping timeout or was merely
 * disposed.
 */

import { Effect, Schema, Stream } from "effect";
import { defineSurface } from "../define";
import {
  createLoopbackPair,
  greetLoopback,
  type LoopbackPair,
} from "../loopback";
import { serveOverStdio, type ServeOverStdioEnd } from "../peer-server";
import { implementSurface } from "../server";
import { stdioLink } from "./stdio";
import type { WireLink } from "./wire";

/** The surface both files exercise: a unary `math.add`, plus a stream whose
 *  `to: 0` arm means "emit one frame, then never end" — the probe for "the
 *  server stops producing when the consumer goes away". */
export const loopbackSurface = defineSurface({
  procedures: {
    math: {
      add: {
        input: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
        output: Schema.Number,
      },
    },
  },
  streams: {
    counter: {
      inputSchema: Schema.Struct({ to: Schema.Number }),
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** Implement {@link loopbackSurface}. `onFinalize` makes the never-ending stream's
 *  finalizer observable. */
export function buildLoopbackRuntime(onFinalize?: () => void) {
  return implementSurface(loopbackSurface, {
    procedures: {
      math: { add: ({ input }) => Effect.succeed(input.a + input.b) },
    },
    streams: {
      counter: {
        source: (input) => {
          const frames: Stream.Stream<{ n: number }> =
            input.to === 0
              ? Stream.concat(Stream.make({ n: 0 }), Stream.never)
              : Stream.map(Stream.range(0, input.to - 1), (n) => ({ n }));
          return onFinalize === undefined
            ? frames
            : Stream.ensuring(
                frames,
                Effect.sync(() => onFinalize()),
              );
        },
      },
    },
  });
}

/** A live link over a loopback pair, plus everything a test needs to poke at
 *  either end of it. */
export interface LoopbackWired {
  readonly link: WireLink;
  readonly pair: LoopbackPair;
  /** The served surface's promise — settles when the server's read half EOFs. */
  readonly serving: Promise<ServeOverStdioEnd>;
  /** Dispose, EOF both directions, await the server, close the runtime. */
  done(): Promise<void>;
}

/** Wire {@link loopbackSurface} up over a loopback pair.
 *
 *  `describe` is the transport's name — the string a link puts in its transport
 *  errors, obtained (as it is in production) from the readiness proof rather
 *  than handed to the link directly. */
export async function wiredLoopback(opts?: {
  readonly onFinalize?: () => void;
  readonly describe?: string;
}): Promise<LoopbackWired> {
  const runtime = buildLoopbackRuntime(opts?.onFinalize);
  const pair = createLoopbackPair();
  const serving = serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: pair.server,
  });
  const readiness = await greetLoopback(pair, opts?.describe);
  const link = await stdioLink({
    group: loopbackSurface.group,
    read: pair.client.read,
    write: pair.client.write,
    readiness,
  });
  return {
    link,
    pair,
    serving,
    done: async () => {
      await link.dispose();
      pair.client.write.end();
      pair.server.write.end();
      await serving;
      await runtime.close();
    },
  };
}
