import { When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import { POLL_TIMEOUT } from "../support/world.ts";
import type { KoluWorld } from "../support/world.ts";

/** Drive xterm's link providers from JS instead of relying on a real
 *  pixel-perfect mouse click on the canvas. We reach into the active
 *  terminal's `__xterm` ref, ask each registered link provider for
 *  links on every buffer row, and activate the first one whose text
 *  matches the expected file ref. This exercises the same activation
 *  path the production click handler takes — it just doesn't simulate
 *  the canvas hit-testing layer, which is unstable across renderer
 *  backends (WebGL vs DOM). */
When(
  "I trigger the terminal file-ref link {string}",
  async function (this: KoluWorld, expectedText: string) {
    const result = await this.page.waitForFunction(
      ({ sel, target }: { sel: string; target: string }) => {
        const container = document.querySelector(sel) as
          | (HTMLElement & {
              __xterm?: {
                buffer: { active: { length: number } };
                _core?: {
                  linkifier?: {
                    _linkProviders?: Array<{
                      provideLinks: (
                        line: number,
                        cb: (
                          links?: Array<{
                            text: string;
                            activate: (e: Event, t: string) => void;
                          }>,
                        ) => void,
                      ) => void;
                    }>;
                  };
                  _linkifier?: {
                    _linkProviders?: Array<{
                      provideLinks: (
                        line: number,
                        cb: (
                          links?: Array<{
                            text: string;
                            activate: (e: Event, t: string) => void;
                          }>,
                        ) => void,
                      ) => void;
                    }>;
                  };
                };
              };
            })
          | null;
        const term = container?.__xterm;
        if (!term) return null;
        const providers =
          term._core?.linkifier?._linkProviders ??
          term._core?._linkifier?._linkProviders ??
          [];
        if (providers.length === 0) return null;
        const length = term.buffer.active.length;
        for (let y = 1; y <= length; y++) {
          for (const provider of providers) {
            let found = false;
            provider.provideLinks(y, (links) => {
              if (!links) return;
              const match = links.find((l) => l.text === target);
              if (match) {
                match.activate(new MouseEvent("click"), match.text);
                found = true;
              }
            });
            if (found) return { y };
          }
        }
        return null;
      },
      { sel: ACTIVE_TERMINAL, target: expectedText },
      { timeout: POLL_TIMEOUT },
    );
    if (result === null) {
      throw new Error(`No file-ref link matching "${expectedText}" found`);
    }
    await this.waitForFrame();
  },
);
