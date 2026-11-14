/**
 * `GET /api/works/<workId>/files/<path>` — THE FILES A FINISHED WORK KEPT, as
 * bytes a browser can render.
 *
 * When a work ends, kolu copies its `.waterfall/` files under
 * `<stateRoot>/works/<workId>/` (`conductor/workFiles.ts`), so a plan outlives
 * the worktree a merge deletes. The card renders them through the Code tab's
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
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { workFilesDir } from "./conductor/workFiles.ts";
import { serveResultResponse } from "./iframePreviewRoute.ts";

/** Base of the kept-file route and its `files` segment — the shape the client
 *  builds a kept file's URL with:
 *  `${BASE}/{workId}/${FILES}/{encoded/path}`. */
export const WORK_FILE_ROUTE_BASE = "/api/works";
export const WORK_FILE_ROUTE_FILE_SEGMENT = "files";

/** The route pattern. `:workId` is an ordinary param; the trailing `*` matches
 *  the file tail, which is deliberately NOT read from the router. */
export const WORK_FILE_ROUTE_PATTERN =
  `${WORK_FILE_ROUTE_BASE}/:workId/${WORK_FILE_ROUTE_FILE_SEGMENT}/*` as const;

/** The still-encoded path tail of a kept-file URL, off the RAW request target.
 *  `""` when the URL does not carry the prefix (the registration guarantees it
 *  does; the guard keeps this pure and total). */
export function workFileTailFromRawUrl(rawUrl: string, workId: string): string {
  const prefix = `${WORK_FILE_ROUTE_BASE}/${encodeURIComponent(workId)}/${WORK_FILE_ROUTE_FILE_SEGMENT}/`;
  const pathname = rawPathname(rawUrl);
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
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
    const params = yield* HttpRouter.params;
    const workId = params.workId;
    // Unreachable through the registered pattern — stated rather than cast so
    // the route is total.
    if (workId === undefined) {
      return serveResultResponse(refusal("malformed work file route", 400));
    }
    let root: string;
    try {
      root = workFilesDir(options.stateRoot, workId);
    } catch {
      // A work id that is not a directory name under the works corner (`..`,
      // a separator): a 400 answer, never a read.
      return serveResultResponse(refusal("invalid work id", 400));
    }
    return serveResultResponse(
      yield* serveFile(
        root,
        workFileTailFromRawUrl(request.url, workId),
        request.headers.range,
        undefined,
        request.headers["if-range"],
      ),
    );
  });
