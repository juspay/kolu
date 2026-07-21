import { E as maybeRenderHead, O as addAttribute, f as renderSlot, h as renderTemplate, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/Finding.astro
createAstro("https://astro.build");
var $$Finding = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Finding;
	const { sev = "medium", id, title } = Astro.props;
	const label = sev === "high" ? "High" : sev === "low" ? "Low" : "Medium";
	return renderTemplate`${maybeRenderHead($$result)}<article${addAttribute(`finding finding-${sev}`, "class")}${addAttribute(id, "id")} data-astro-cid-adrh2cs3><h3 class="finding-head" data-astro-cid-adrh2cs3><span${addAttribute(`sev sev-${sev}`, "class")} data-astro-cid-adrh2cs3>${label}</span> ${title}</h3><div class="finding-body" data-astro-cid-adrh2cs3>${renderSlot($$result, $$slots["default"])}</div></article>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/Finding.astro", void 0);
//#endregion
export { $$Finding as t };
