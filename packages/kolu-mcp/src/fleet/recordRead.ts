/**
 * HOW THIS FACE ANSWERS `resources/read` — so that one terminal's RECORD is
 * addressed with the reference every other answer on this face hands out.
 *
 * THE DEFECT THIS EXISTS FOR. A fleet reference is `<host>/<id>`, and the
 * adapter addresses a collection item by SEGMENT: it splits a
 * `surface://collections/…` URI on `/` and reads two segments as a core
 * collection's item and three as a sibling's (`parseCollectionItem`,
 * `packages/surface-mcp/src/expose.ts`). So the URI an agent actually writes —
 * the reference it was just handed, pasted after the collection —
 * `surface://collections/terminals/remote:gossamer/9ab1…` has THREE segments
 * and is read as a sibling called `terminals` holding a collection called
 * `remote:gossamer`: no such thing, "unknown resource". Only
 * `terminals/remote%3Agossamer%2F9ab1…` resolved, which no agent guesses and
 * nothing on this face ever showed. Reading one terminal's record — the thing
 * the standing prompt tells the Conductor to do before it reads a screen —
 * therefore never worked here.
 *
 * WHY THE FIX IS HERE rather than in the segment rule. The encoding rule is
 * `@kolu/surface`'s, shared by every consumer of the adapter and gated behind
 * its own review; the SPELLING of a terminal is kolu's, and it is this package
 * that minted a member key with a slash in it. So this face takes the
 * reference in the shape it hands out, canonicalizes it to the one address the
 * adapter resolves, and hands the read on — the generic reader keeps its one
 * segment rule, and kolu keeps its one spelling of a terminal.
 *
 * WHAT IT DOES, in three answers:
 *   - A URI under the record template's prefix is a RECORD read, however its
 *     reference is spelled: the segments after the prefix are decoded, joined
 *     back into the reference, and re-addressed as the single encoded segment
 *     the adapter reads. The answer carries the address the caller ASKED at,
 *     because a `contents[].uri` an agent did not write reads as a second,
 *     secret address.
 *   - A record that cannot be read is refused in a sentence that says so AND
 *     says what a record address looks like — the one piece of teaching the
 *     generic "unknown resource" could never carry, because the generic reader
 *     does not know what a terminal is.
 *   - Anything else this face does not serve is refused here, with the same
 *     sentence, rather than reaching the generic reader to be told only that
 *     the URI is unknown.
 *
 * PINNED-SDK ASSUMPTION. `Protocol.setRequestHandler` is documented to REPLACE
 * the handler for a method and is a plain `Map.set` into a private
 * `_requestHandlers` (`@modelcontextprotocol/sdk` 1.32.1,
 * `dist/esm/shared/protocol.js`), so the adapter's own `resources/read` is
 * taken out of that map and called as the delegate below. There is no public
 * getter; if a later SDK renames the map, {@link serveFleetRecordReads} throws
 * at BOOT with the sentence below rather than quietly serving a face whose
 * records cannot be read — which is the failure this module exists to end.
 */

import { messageOf, resolveExpose } from "@kolu/surface-mcp";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  type ReadResourceRequest,
  ReadResourceRequestSchema,
  type ReadResourceResult,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { KOLU_FLEET_EXPOSE } from "../expose.ts";
import { fleetSurface } from "./fleetSurface.ts";

/** The adapter's item-template placeholder — the tail
 *  `collectionItemTemplate` writes, and the only part of a template this
 *  module reads off rather than builds. */
const ITEM_PLACEHOLDER = "{id}";

const READ_RESOURCE_METHOD = "resources/read";

/** The SDK's stored `resources/read` handler, as this module calls it. */
type ReadResourceHandler = (
  request: ReadResourceRequest,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => Promise<ReadResourceResult>;

/** WHAT THIS FACE SERVES, as addresses — resolved from the same spec and the
 *  same expose map the served bundle is built from, so "which resources are
 *  there" is answered once in this package and cannot drift from what the
 *  adapter registered. */
interface FleetAddresses {
  /** Every static resource URI (the cells, and the collection's key set). */
  readonly served: ReadonlySet<string>;
  /** `surface://collections/terminals/` — the record template with its `{id}`
   *  taken off, which is the prefix every record address starts with. */
  readonly recordPrefix: string;
  /** The key-set resource behind that template — the live set of references. */
  readonly recordCollection: string;
}

function fleetAddresses(): FleetAddresses {
  const resolved = resolveExpose(
    fleetSurface.spec,
    KOLU_FLEET_EXPOSE,
    // The fleet bundle is one core surface and no siblings — exactly as
    // `./serve.ts` builds it.
    undefined,
  );
  // ONE collection, and the assert is how a second one arrives as a boot
  // failure rather than as a sentence that names the wrong member: every
  // record sentence below is about THE collection a terminal belongs to, and a
  // face with two of them needs a reader that asks which.
  const [template, ...rest] = resolved.resourceTemplates;
  if (template === undefined || rest.length > 0) {
    throw new Error(
      `kolu-mcp fleet: this face expects exactly one collection to address records in, and \`fleetSurface\` exposes ${resolved.resourceTemplates.length}. The record-address sentence names one collection; a second needs its own.`,
    );
  }
  if (!template.uriTemplate.endsWith(ITEM_PLACEHOLDER)) {
    throw new Error(
      `kolu-mcp fleet: the adapter's item template is ${JSON.stringify(template.uriTemplate)}, which does not end in ${ITEM_PLACEHOLDER} — this face reads the record prefix off it.`,
    );
  }
  const collection = resolved.resources.find(
    (entry) => entry.kind === "collection" && entry.key === template.key,
  );
  if (collection === undefined) {
    throw new Error(
      `kolu-mcp fleet: no key-set resource for the ${JSON.stringify(template.key)} collection — a record address is taught beside the set it is a member of.`,
    );
  }
  return {
    served: new Set(resolved.resources.map((entry) => entry.uri)),
    recordPrefix: template.uriTemplate.slice(0, -ITEM_PLACEHOLDER.length),
    recordCollection: collection.uri,
  };
}

/** WHERE A RECORD IS READ — the sentence every refusal on this face ends with,
 *  and the one `packages/conductor/src/teaching.md` states to the Conductor in
 *  its own words. Built from the addresses the face actually serves, so a
 *  renamed collection moves the sentence with it. */
function recordAddress(at: FleetAddresses): string {
  return `A terminal's record is read at "${at.recordPrefix}<host>/<id>" — the reference exactly as the tools, the wakes and the resources hand it out ("local/<id>", "remote:<host>/<id>"), with nothing escaped; "${at.recordCollection}" is the live set of them.`;
}

/** The whole URI, as THIS face reads it. */
type Route =
  /** A static resource this face serves — passed through untouched. */
  | { readonly kind: "member" }
  /** One terminal's record, at the single encoded segment the adapter
   *  resolves — which is the asked URI itself when it was already spelled
   *  that way. */
  | { readonly kind: "record"; readonly canonical: string }
  /** Nothing this face serves. */
  | { readonly kind: "unknown" };

/** The reference a record URI's tail spells: each segment decoded on its own
 *  and joined back with the separator the grammar uses, so `local/<id>`,
 *  `remote:gossamer/<id>` and a half-escaped `remote%3Agossamer/<id>` all name
 *  the same terminal. `null` for a tail that is not decodable at all. */
function referenceIn(tail: string): string | null {
  try {
    return tail
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

function routeOf(uri: string, at: FleetAddresses): Route {
  if (at.served.has(uri)) return { kind: "member" };
  if (!uri.startsWith(at.recordPrefix)) return { kind: "unknown" };
  const reference = referenceIn(uri.slice(at.recordPrefix.length));
  if (reference === null || reference === "") return { kind: "unknown" };
  return {
    kind: "record",
    canonical: `${at.recordPrefix}${encodeURIComponent(reference)}`,
  };
}

/** The SDK `Protocol` internal this module pins: the handler map
 *  `setRequestHandler` writes into. Declared as a shape because the class
 *  declares the field `private`, and nothing is taken out of it before the
 *  value has been CHECKED at runtime. */
type SdkRequestHandlers = { readonly _requestHandlers?: unknown };

/** The adapter's own `resources/read`, lifted out of the SDK's handler map —
 *  see the module header's pinned-SDK note. */
function delegateReader(server: Server): ReadResourceHandler {
  // The pinned internal, named: the SDK publishes no getter for a registered
  // handler, and the shape it is read for is checked on the next two lines.
  const internals = server as unknown as SdkRequestHandlers;
  const handlers = internals._requestHandlers;
  const found: unknown =
    handlers instanceof Map ? handlers.get(READ_RESOURCE_METHOD) : undefined;
  if (typeof found !== "function") {
    throw new Error(
      `kolu-mcp fleet: the MCP SDK no longer keeps its ${READ_RESOURCE_METHOD} handler in a private \`_requestHandlers\` map, so this face cannot serve a terminal record at the reference it hands out. See packages/kolu-mcp/src/fleet/recordRead.ts.`,
    );
  }
  // What the SDK stores at that method, by its own `setRequestHandler`: the
  // registered handler behind a parse of the request schema it was registered
  // with.
  return found as ReadResourceHandler;
}

/** Take this face's `resources/read` over, in front of the adapter's.
 *
 *  Called by `./serve.ts` immediately after the bundle is served — the earliest
 *  moment the `Server` exists. A host cannot have read anything by then: MCP
 *  requires a completed `initialize` round trip first, and this registration
 *  happens in the same turn the connect resolved in. */
export function serveFleetRecordReads(server: Server): void {
  const at = fleetAddresses();
  const delegate = delegateReader(server);
  server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => {
    const asked = req.params.uri;
    const route = routeOf(asked, at);
    if (route.kind === "unknown") {
      throw new Error(
        `unknown resource "${asked}" on kolu's fleet face. ${recordAddress(at)} The other resources it serves are ${[...at.served].map((uri) => `"${uri}"`).join(", ")}.`,
      );
    }
    if (route.kind === "member") return delegate(req, extra);
    const answer = await delegate(
      { ...req, params: { ...req.params, uri: route.canonical } },
      extra,
    ).catch((cause: unknown): never => {
      // The reason WHOLE — the adapter's own sentence, which says whether the
      // reference named no terminal, a host that is not connected, or a
      // reference that is not one at all — at the address the caller wrote,
      // not the one this module re-addressed it to.
      const detail = messageOf(cause).replaceAll(route.canonical, asked);
      throw new Error(
        `no terminal record at "${asked}" — ${detail}. ${recordAddress(at)}`,
        { cause },
      );
    });
    if (route.canonical === asked) return answer;
    return {
      ...answer,
      contents: answer.contents.map((one) =>
        one.uri === route.canonical ? { ...one, uri: asked } : one,
      ),
    };
  });
}
