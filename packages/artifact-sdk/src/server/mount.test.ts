import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountArtifactSdk } from "./index";

/** The decoration middleware rewrites the HTML body (splices the SDK
 *  <script>), so it must not carry forward a strong validator of the
 *  ORIGINAL bytes. serve-dir now stamps an `ETag` on every streamed
 *  200/206; if the middleware preserved it, the decorated HTML would be
 *  served with a validator for a representation we no longer send. */
describe("mountArtifactSdk HTML decoration", () => {
  const opts = { sdkScriptPath: "/sdk.js", htmlRoutePrefix: "/preview/*" };

  it("drops the stale ETag of the original bytes and injects the script", async () => {
    const app = new Hono();
    mountArtifactSdk(app, opts);
    app.get(
      "/preview/x",
      () =>
        new Response("<html><body>hi</body></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ETag: '"orig-file-bytes"',
            "Cache-Control": "private, max-age=60",
          },
        }),
    );

    const res = await app.request("/preview/x");
    const body = await res.text();

    expect(res.headers.get("etag")).toBeNull();
    expect(body).toContain('<script src="/sdk.js?v=');
    // A non-validator header the middleware must still preserve.
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("leaves non-HTML responses (and their ETag) untouched", async () => {
    const app = new Hono();
    mountArtifactSdk(app, opts);
    app.get(
      "/preview/vid",
      () =>
        new Response("rawbytes", {
          status: 200,
          headers: { "Content-Type": "video/mp4", ETag: '"vid"' },
        }),
    );

    const res = await app.request("/preview/vid");
    expect(res.headers.get("etag")).toBe('"vid"');
    expect(await res.text()).toBe("rawbytes");
  });
});
