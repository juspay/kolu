import { E as maybeRenderHead, I as createAstro, L as createComponent, O as addAttribute, h as renderTemplate } from "./server_B0R_ZhRD.mjs";
import "./atlasGraph_BBFLFj6M.mjs";
//#region src/components/Cite.astro
createAstro("https://astro.build");
var $$Cite = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Cite;
	const { file, lines, repo = "juspay/kolu", rev = "master", label } = Astro.props;
	const href = `https://github.com/${repo}/blob/${rev}/${file}${lines ? `#L${lines.replace("-", "-L")}` : ""}`;
	const text = label ?? (lines ? `${file}:${lines}` : file);
	return renderTemplate`${maybeRenderHead($$result)}<a${addAttribute(href, "href")} rel="noopener" class="cite" data-astro-cid-5pdjtcv2>${text}</a>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Cite.astro", void 0);
//#endregion
export { $$Cite as t };
