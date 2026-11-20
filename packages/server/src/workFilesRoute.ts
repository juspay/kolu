import { type ServeResult, rawPathname, serveFile } from "@kolu/serve-dir";
import { Effect } from "effect";
import {
  type HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { workDirOf } from "kolu-conductor";
import { workFilesDir } from "./conductor/workFiles.ts";
import { serveResultResponse } from "./iframePreviewRoute.ts";

export const WORK_FILE_ROUTE_BASE = "/api/works";
export const WORK_FILE_ROUTE_FILE_SEGMENT = "files";

export const WORK_FILE_ROUTE_PATTERN = `${WORK_FILE_ROUTE_BASE}/*` as const;

export function parseRawWorkFileTarget(
  rawUrl: string,
): { readonly workId: string; readonly encodedTail: string } | null {
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
    encodedTail: pathname.slice(at + marker.length),
  };
}

const refusal = (body: string, status: number): ServeResult => ({
  status,
  headers: { "content-type": "text/plain; charset=utf-8" },
  body,
});

export const workFileRouteHandler = (options: {
  readonly stateRoot: string;
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const asked = parseRawWorkFileTarget(request.url);
    if (asked === null) {
      return serveResultResponse(refusal("malformed work file route", 400));
    }
    let root: string;
    try {
      root = workFilesDir(options.stateRoot, workDirOf(asked.workId));
    } catch {
      return serveResultResponse(refusal("invalid work id", 400));
    }
    return serveResultResponse(
      yield* serveFile(
        root,
        asked.encodedTail,
        request.headers.range,
        undefined,
        request.headers["if-range"],
      ),
    );
  });
