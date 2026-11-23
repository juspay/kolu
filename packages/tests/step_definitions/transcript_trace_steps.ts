/** TEMPORARY DIAGNOSTIC — records what the Conductor's transcript scroller did
 *  in the scenarios about following after a work is picked and left, and
 *  prints it to the log. Removed before the PR is ready. */

import { AfterStep, BeforeStep } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

const TRACED = /leaves a following chat at the bottom/;

const INSTALL = `(() => {
  if (window.__ttrace) return;
  const log = (window.__ttrace = []);
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const pill = () => !!document.querySelector('[data-testid="conductor-pane"] [data-testid="scroll-to-bottom"]');
  let el = null;
  const m = () => el ? [el.scrollTop, el.scrollHeight, el.clientHeight, el.scrollHeight - el.scrollTop - el.clientHeight, pill() ? 1 : 0] : null;
  const label = (n) => {
    if (n === el) return "scroller";
    const id = n.getAttribute && n.getAttribute("data-row-id");
    if (id) return "row:" + n.getAttribute("data-row-kind") + ":" + id.slice(0, 8);
    const tid = n.getAttribute && n.getAttribute("data-testid");
    return tid ? "tid:" + tid : (n.tagName || "?").toLowerCase() + "." + String(n.className || "").slice(0, 20);
  };
  const sizes = new Map();
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height);
      const was = sizes.get(e.target);
      sizes.set(e.target, h);
      if (was !== h) log.push([now(), "size", label(e.target), was ?? null, h, m()]);
    }
  });
  const watch = (n) => {
    if (!(n instanceof Element)) return;
    if (n.parentElement === el || n.matches('[data-row-id],[data-testid="work-question"]')) ro.observe(n);
    for (const c of n.querySelectorAll('[data-row-id],[data-testid="work-question"]')) ro.observe(c);
  };
  const attach = (found) => {
    el = found;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); log.push([now(), "write", Math.round(v), m()]); },
    });
    el.addEventListener("scroll", () => log.push([now(), "scroll", m()]));
    el.addEventListener("wheel", () => log.push([now(), "wheel", m()]));
    ro.observe(el);
    for (const c of el.children) watch(c);
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        watch(n);
        if (n instanceof Element) log.push([now(), "added", label(n), m()]);
      }
    }).observe(el, { childList: true, subtree: true });
    log.push([now(), "attached", m()]);
  };
  const look = () => {
    const found = document.querySelector('[data-testid="conductor-transcript"]');
    if (found && found !== el) attach(found);
  };
  look();
  new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
})()`;

BeforeStep(async function (this: KoluWorld, { pickle, pickleStep }) {
  if (!TRACED.test(pickle.name) || this.page === undefined) return;
  await this.page.evaluate(INSTALL).catch(() => undefined);
  await this.page
    .evaluate(
      (text) =>
        (window as unknown as { __ttrace?: unknown[] }).__ttrace?.push([
          "step",
          text,
        ]),
      pickleStep.text,
    )
    .catch(() => undefined);
});

AfterStep(async function (this: KoluWorld, { pickle, pickleStep, result }) {
  if (!TRACED.test(pickle.name) || this.page === undefined) return;
  const done =
    pickleStep.text ===
    "the conductor should not offer the way back to the bottom";
  if (result.status !== "FAILED" && !done) return;
  const trace = await this.page
    .evaluate(() => (window as unknown as { __ttrace?: unknown[] }).__ttrace)
    .catch((err) => `unreadable: ${err}`);
  console.log(
    `[transcript-trace] ${pickle.uri}:${pickle.name} status=${result.status} at="${pickleStep.text}" ${JSON.stringify(trace)}`,
  );
});
