/**
 * `GET /api/works/<workId>/files/<path>` — THE FILES A FINISHED WORK KEPT, as
 * bytes a browser can render.
 *
 * When a work ends, kolu copies its `.waterfall/` files under
 * `<stateRoot>/works/<workDirOf(workId)>/` (`conductor/workFiles.ts`), so a
 * plan outlives the worktree a merge deletes. The URL carries the WORK ID —
 * the browser has no business knowing the disk layout — and `workDirOf` is
 * the one helper that turns it into a directory name, the same one the
 * writer and the sweep use.
 * The card renders them through the Code tab's
 * own viewer stack, which renders a URL — this is that URL.
 *
 * It is `@kolu/serve-dir` over one rooted directory, which is the whole route:
 * the `..`/`%2f` segment guard, the mime, the range support a `<video>` needs
 * and the streamed body are all that primitive's, exactly as the terminal
 * preview route uses it. The two things kolu adds are the ROOT (the work's own
 * directory, resolved through `workFilesDir` — the one place a work id becomes
 * a path, so a `..` in the URL cannot address another work's files or anything
 * outside the state root) and the CSP sandbox every file this server serves
 * carries ({@link serveResultResponse}), because a kept `.waterfall/review.html`
 * is a document an agent wrote and it must not run at kolu's origin.
 *
 * The RAW request target is sliced here rather than read off the router's
 * params for the reason `iframePreviewRoute.ts` states at length: the matcher
 * decodes `*`, serve-dir decodes it again, and a WHATWG `URL` round trip
 * collapses `foo/../secret` before any guard sees it. Same slice, same reason.
 */

import { type ServeResult, rawPathname, serveFile } from "@kolu/serve-dir";
import { Effect } from "effect";
import {
  type HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { workDirOf } from "kolu-work";
import { workFilesDir } from "./conductor/workFiles.ts";
import { serveResultResponse } from "./iframePreviewRoute.ts";

/** Base of the kept-file route and its `files` segment — the shape the client
 *  builds a kept file's URL with:
 *  `${BASE}/{workId}/${FILES}/{encoded/path}`. */
export const WORK_FILE_ROUTE_BASE = "/api/works";
export const WORK_FILE_ROUTE_FILE_SEGMENT = "files";

/** The route pattern. A work id CARRIES SLASHES (`branch:<host>/<repo>/<branch>`,
 *  percent-encoded in the URL), and a router that decodes a path before
 *  matching sees those `%2F`s as segment separators — a `:workId` param then
 *  matches nothing and the request falls through to the SPA, which is served
 *  as the file's "bytes" (a plan that renders kolu's own index.html, #2376).
 *  So the whole tail is matched and parsed HERE, off the raw target. */
export const WORK_FILE_ROUTE_PATTERN = `${WORK_FILE_ROUTE_BASE}/*` as const;

/** The work id and the still-encoded file tail of a kept-file URL, off the RAW
 *  request target — `null` when the URL is not one this route can answer.
 *
 *  Both halves come from the raw pathname rather than from a decoded one for
 *  the reason `iframePreviewRoute.ts` states at length: a decode would turn
 *  the id's own `%2F`s into separators and `foo/../secret` into `secret`. The
 *  split is on the `/files/` segment, which the ENCODED id cannot contain. */
export function workFileRequest(
  rawUrl: string,
): { readonly workId: string; readonly tail: string } | null {
  const base = `${WORK_FILE_ROUTE_BASE}/`;
  const marker = `/${WORK_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = rawPathname(rawUrl);
  if (!pathname.startsWith(base)) return null;
  const at = pathname.indexOf(marker, base.length);
  if (at === -1) return null;
  const encoded = pathname.slice(base.length, at);
  if (encoded === "") return null;
  return {
    workId: decodeURIComponent(encoded),
    tail: pathname.slice(at + marker.length),
  };
}

const refusal = (body: string, status: number): ServeResult => ({
  status,
  headers: { "content-type": "text/plain; charset=utf-8" },
  body,
});

/** The kept-file route's handler. Compose it into a router at
 *  {@link WORK_FILE_ROUTE_PATTERN}. */
export const workFileRouteHandler = (options: {
  /** `<KOLU_STATE_DIR>` — `works/<id>` under it is this route's root. */
  readonly stateRoot: string;
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const asked = workFileRequest(request.url);
    // A target this route cannot read a work and a file out of — unreachable
    // through the registered pattern for a URL the client built, and stated
    // rather than cast so the route is total.
    if (asked === null) {
      return serveResultResponse(refusal("malformed work file route", 400));
    }
    let root: string;
    try {
      root = workFilesDir(options.stateRoot, workDirOf(asked.workId));
    } catch {
      // Unreachable for a hashed name (16 hex characters), and stated anyway
      // so the route is total: a directory that escapes the works corner is a
      // 400 answer, never a read.
      return serveResultResponse(refusal("invalid work id", 400));
    }
    return serveResultResponse(
      yield* serveFile(
        root,
        asked.tail,
        request.headers.range,
        undefined,
        request.headers["if-range"],
      ),
    );
  });
