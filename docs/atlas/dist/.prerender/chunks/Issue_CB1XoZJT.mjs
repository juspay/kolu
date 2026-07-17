import { E as maybeRenderHead, I as createAstro, L as createComponent, O as addAttribute, h as renderTemplate } from "./server_B0R_ZhRD.mjs";
import "./atlasGraph_BBFLFj6M.mjs";
//#region src/components/Issue.astro
createAstro("https://astro.build");
var $$Issue = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Issue;
	const { n, repo = "juspay/kolu", label } = Astro.props;
	const href = `https://github.com/${repo}/issues/${n}`;
	return renderTemplate`${maybeRenderHead($$result)}<a${addAttribute(href, "href")} rel="noopener" style="display:inline-flex;align-items:center;gap:.3em;vertical-align:baseline;font:600 .85em/1.2 ui-monospace,monospace;color:#0b6478;background:#e1f0f3;border:1px solid #bcdfe6;border-radius:6px;padding:.05em .45em;text-decoration:none"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="flex:none"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>#${n}${label ? ` · ${label}` : ""}</a>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Issue.astro", void 0);
//#endregion
export { $$Issue as t };
