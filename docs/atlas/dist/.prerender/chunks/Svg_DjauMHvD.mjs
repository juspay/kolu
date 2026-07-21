import { E as maybeRenderHead, I as unescapeHTML, O as addAttribute, h as renderTemplate, l as Fragment, s as renderComponent, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/Svg.astro
createAstro("https://astro.build");
var $$Svg = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Svg;
	const { svg, caption, wide = false } = Astro.props;
	if (!svg || !svg.trimStart().startsWith("<svg")) throw new Error("Svg.astro: expected raw <svg> markup. Did you forget the `?raw` suffix on the import (e.g. `import d from \"../../diagrams/foo.svg?raw\"`)?");
	const inlined = svg.replace(/^<\?xml[^>]*\?>\s*/, "");
	return renderTemplate`${maybeRenderHead($$result)}<figure${addAttribute(["diagram", { wide }], "class:list")} data-astro-cid-6cvztg6h>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(inlined)}` })}${caption && renderTemplate`<figcaption data-astro-cid-6cvztg6h>${caption}</figcaption>`}</figure>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/Svg.astro", void 0);
//#endregion
export { $$Svg as t };
