import { E as maybeRenderHead, O as addAttribute, h as renderTemplate, l as Fragment, s as renderComponent, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/Phase.astro
createAstro("https://astro.build");
var $$Phase = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Phase;
	const { id, name, status = "todo", needs = [], blocks = [], links = [] } = Astro.props;
	const S = {
		shipped: {
			bg: "#e6f4ea",
			bd: "#bce3c8",
			fg: "#15803d",
			label: "✓ shipped"
		},
		next: {
			bg: "#fef3e2",
			bd: "#f5d8a8",
			fg: "#b45309",
			label: "▶ do next"
		},
		"build-clean": {
			bg: "#eef2ff",
			bd: "#c7d2fe",
			fg: "#4f46e5",
			label: "◐ build-clean"
		},
		todo: {
			bg: "#f8fafc",
			bd: "#e2e8f0",
			fg: "#64748b",
			label: "○ todo"
		}
	};
	const s = S[status] ?? S.todo;
	const hasMeta = needs.length > 0 || blocks.length > 0 || links.length > 0;
	return renderTemplate`${maybeRenderHead($$result)}<div${addAttribute(`border:1px solid ${s.bd};background:${s.bg};border-radius:8px;padding:.45rem .7rem;margin:.6rem 0 .5rem;font-size:.9em`, "style")}><div style="display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap"><span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:#0f172a">${id}</span>${name && renderTemplate`<span style="color:#334155">· ${name}</span>`}<span${addAttribute(`margin-left:auto;font-size:.85em;font-weight:600;color:${s.fg}`, "style")}>${s.label}</span></div>${hasMeta && renderTemplate`<div style="display:flex;gap:1.3rem;flex-wrap:wrap;margin-top:.32rem;font-size:.84em;color:#475569">${needs.length > 0 && renderTemplate`<span><span style="color:#94a3b8">needs ←</span> ${needs.join(" · ")}</span>`}${blocks.length > 0 && renderTemplate`<span><span style="color:#94a3b8">blocks →</span> ${blocks.join(" · ")}</span>`}${links.length > 0 && renderTemplate`<span><span style="color:#94a3b8">links</span>${" "}${links.map((l, i) => renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${i > 0 ? " · " : ""}<a${addAttribute(l.href, "href")} style="color:#475569;text-decoration:underline;text-decoration-color:#cbd5e1">${l.label}</a>` })}`)}</span>`}</div>`}</div>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/Phase.astro", void 0);
//#endregion
export { $$Phase as t };
