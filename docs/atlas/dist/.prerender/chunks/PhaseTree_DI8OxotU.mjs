import { E as maybeRenderHead, O as addAttribute, h as renderTemplate, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/PhaseTree.astro
createAstro("https://astro.build");
var $$PhaseTree = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$PhaseTree;
	const { title, legend = "✓ shipped · ▶ do next · ◐ build-clean · ○ todo · → drill in", phases } = Astro.props;
	const C = {
		ship: "#15803d",
		prog: "#b45309",
		last: "#64748b",
		txt: "#1f2937",
		sub: "#6b7280",
		line: "#cbd5e1"
	};
	return renderTemplate`${maybeRenderHead($$result)}<div style="font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:#fbfcfd;border:1px solid #e2e8f0;border-radius:10px;padding:.9rem 1.1rem;margin:1.1rem 0;overflow-x:auto"><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.4rem;margin-bottom:.55rem"><span style="color:#334155;font-weight:700;font-size:.92em;letter-spacing:.02em">${title}</span><span style="color:#94a3b8;font-size:.8em">${legend}</span></div>${phases.map((r) => {
		const d = r.d ?? 0;
		const col = C[r.c ?? "prog"];
		return renderTemplate`<div${addAttribute(`display:flex;align-items:baseline;gap:.6ch;padding:.07rem 0;padding-left:${d * 1.6}rem`, "style")}><span${addAttribute(`color:${col};width:1.2ch;flex:none;text-align:center`, "style")}>${r.g}</span><span${addAttribute(`color:${C.txt};font-weight:${d === 0 ? 600 : 400}`, "style")}>${r.l}</span><span${addAttribute(`color:${C.sub};margin-left:auto;white-space:nowrap;font-size:.92em`, "style")}>${r.h ? renderTemplate`<a${addAttribute(r.h, "href")}${addAttribute(`color:${C.sub};text-decoration:underline;text-decoration-color:${C.line};text-underline-offset:2px`, "style")}>${r.m}</a>` : r.m}</span></div>`;
	})}</div>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/PhaseTree.astro", void 0);
//#endregion
export { $$PhaseTree as t };
