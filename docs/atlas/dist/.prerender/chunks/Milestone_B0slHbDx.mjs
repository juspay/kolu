import { E as maybeRenderHead, I as createAstro, L as createComponent, O as addAttribute, f as renderSlot, h as renderTemplate } from "./server_B0R_ZhRD.mjs";
import "./atlasGraph_BBFLFj6M.mjs";
//#region src/components/Roadmap.astro
var $$Roadmap = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${maybeRenderHead($$result)}<ul class="roadmap" data-astro-cid-ubuqyyp6>${renderSlot($$result, $$slots["default"])}</ul>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Roadmap.astro", void 0);
//#endregion
//#region src/components/Milestone.astro
createAstro("https://astro.build");
var $$Milestone = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Milestone;
	const { status, label } = Astro.props;
	const mark = status === "done" ? "✓" : status === "now" ? "▸" : "○";
	return renderTemplate`${maybeRenderHead($$result)}<li${addAttribute(`ms ms-${status}`, "class")} data-astro-cid-bobtpk34><span class="ms-mark" aria-hidden="true" data-astro-cid-bobtpk34>${mark}</span><span class="ms-text" data-astro-cid-bobtpk34>${label && renderTemplate`<strong class="ms-label" data-astro-cid-bobtpk34>${label}</strong>`}${renderSlot($$result, $$slots["default"])}</span></li>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Milestone.astro", void 0);
//#endregion
export { $$Roadmap as n, $$Milestone as t };
