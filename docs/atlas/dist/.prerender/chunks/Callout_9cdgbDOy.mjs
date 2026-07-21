import { E as maybeRenderHead, O as addAttribute, f as renderSlot, h as renderTemplate, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/Callout.astro
createAstro("https://astro.build");
var $$Callout = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Callout;
	const { kind = "note", title } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<aside${addAttribute(`callout callout-${kind}`, "class")} data-astro-cid-q2ml7llr>${title && renderTemplate`<p class="callout-title" data-astro-cid-q2ml7llr>${title}</p>`}<div class="callout-body" data-astro-cid-q2ml7llr>${renderSlot($$result, $$slots["default"])}</div></aside>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/Callout.astro", void 0);
//#endregion
export { $$Callout as t };
