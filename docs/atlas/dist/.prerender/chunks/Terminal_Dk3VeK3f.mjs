import { E as maybeRenderHead, O as addAttribute, h as renderTemplate, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/Terminal.astro
createAstro("https://astro.build");
var $$Terminal = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Terminal;
	const { title = "kolu", lines } = Astro.props;
	const rows = lines.map((line) => {
		if (line.startsWith("$ ")) return {
			kind: "prompt",
			text: line.slice(2)
		};
		if (line.startsWith("# ")) return {
			kind: "comment",
			text: line
		};
		return {
			kind: "output",
			text: line
		};
	});
	return renderTemplate`${maybeRenderHead($$result)}<div class="term" data-astro-cid-kenkipkp><div class="term-bar" data-astro-cid-kenkipkp><span class="term-dot" style="background:#ff5f56" data-astro-cid-kenkipkp></span><span class="term-dot" style="background:#ffbd2e" data-astro-cid-kenkipkp></span><span class="term-dot" style="background:#27c93f" data-astro-cid-kenkipkp></span><span class="term-title" data-astro-cid-kenkipkp>${title}</span></div><div class="term-body" data-astro-cid-kenkipkp>${rows.map((r) => r.kind === "prompt" ? renderTemplate`<div class="term-line" data-astro-cid-kenkipkp><span class="term-prompt" data-astro-cid-kenkipkp>$</span> <span class="term-cmd" data-astro-cid-kenkipkp>${r.text}</span></div>` : renderTemplate`<div${addAttribute(`term-line ${r.kind === "comment" ? "term-comment" : "term-out"}`, "class")} data-astro-cid-kenkipkp>${r.text || "\xA0"}</div>`)}</div></div>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/Terminal.astro", void 0);
//#endregion
export { $$Terminal as t };
