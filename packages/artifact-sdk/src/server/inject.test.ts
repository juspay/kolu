import { describe, expect, it } from "vitest";
import { decorateHtml } from "./inject";

describe("decorateHtml", () => {
  it("splices before </body>", () => {
    const out = decorateHtml("<html><body>hi</body></html>", "/sdk.js?v=abc");
    expect(out).toBe(
      '<html><body>hi<script src="/sdk.js?v=abc"></script></body></html>',
    );
  });

  it("case-insensitive close-body match", () => {
    const out = decorateHtml("<BODY>x</BODY>", "/s.js");
    expect(out).toBe('<BODY>x<script src="/s.js"></script></BODY>');
  });

  it("appends when </body> missing", () => {
    const out = decorateHtml("<div>fragment</div>", "/s.js");
    expect(out).toBe('<div>fragment</div><script src="/s.js"></script>');
  });
});
