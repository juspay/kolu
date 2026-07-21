import { E as maybeRenderHead, I as unescapeHTML, h as renderTemplate, l as Fragment, s as renderComponent, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
import { execFileSync } from "node:child_process";
//#region src/components/D2.astro
createAstro("https://astro.build");
var $$D2 = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$D2;
	const { code, caption, theme = 0 } = Astro.props;
	let svg;
	try {
		svg = execFileSync("d2", [
			"--layout=dagre",
			"--sketch=false",
			`--theme=${theme}`,
			"--pad=16",
			"-",
			"-"
		], {
			input: code,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error("D2 render failed (is the 'd2' binary on PATH? it ships in the Nix devShell — run inside `nix develop`):\n" + msg);
	}
	svg = svg.replace(/^<\?xml[^>]*\?>\s*/, "");
	return renderTemplate`${maybeRenderHead($$result)}<figure class="d2" data-astro-cid-cfiuptvn>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(svg)}` })}${caption && renderTemplate`<figcaption data-astro-cid-cfiuptvn>${caption}</figcaption>`}</figure>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/D2.astro", void 0);
//#endregion
export { $$D2 as t };
