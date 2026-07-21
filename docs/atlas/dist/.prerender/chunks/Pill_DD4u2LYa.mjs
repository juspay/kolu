import { E as maybeRenderHead, O as addAttribute, f as renderSlot, h as renderTemplate, z as createAstro } from "./server_ZVLTETd9.mjs";
import { t as createComponent } from "./compiler_BRvTyc2O.mjs";
//#region src/components/Pill.astro
createAstro("https://astro.build");
var $$Pill = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Pill;
	const { variant = "todo" } = Astro.props;
	const C = {
		hi: [
			"#a02a2a",
			"#fbe9e9",
			"#f0c9c9"
		],
		bad: [
			"#a02a2a",
			"#fbe9e9",
			"#f0c9c9"
		],
		fail: [
			"#a02a2a",
			"#fbe9e9",
			"#f0c9c9"
		],
		md: [
			"#8a5a00",
			"#fbf1dc",
			"#ecd9ab"
		],
		warn: [
			"#8a5a00",
			"#fbf1dc",
			"#ecd9ab"
		],
		ok: [
			"#1b7a3a",
			"#e6f4ea",
			"#bce3c8"
		],
		good: [
			"#1b7a3a",
			"#e6f4ea",
			"#bce3c8"
		],
		done: [
			"#1b7a3a",
			"#e6f4ea",
			"#bce3c8"
		],
		fix: [
			"#5a3ff0",
			"#efebff",
			"#d4cbff"
		],
		run: [
			"#0b6478",
			"#e1f0f3",
			"#bcdfe6"
		],
		new: [
			"#0b6478",
			"#e1f0f3",
			"#bcdfe6"
		],
		dx: [
			"#7c4dd4",
			"#f1e9fb",
			"#ddc9f2"
		],
		todo: [
			"#5b6470",
			"#eef0f2",
			"#d9dde2"
		],
		sm: [
			"#5b6470",
			"#eef0f2",
			"#d9dde2"
		],
		lo: [
			"#5b6470",
			"#eef0f2",
			"#d9dde2"
		]
	};
	const [fg, bg, bd] = C[variant] ?? C.todo;
	return renderTemplate`${maybeRenderHead($$result)}<span class="pill"${addAttribute(`color:${fg};background:${bg};border:1px solid ${bd}`, "style")} data-astro-cid-4xidn2cs>${renderSlot($$result, $$slots["default"])}</span>`;
}, "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/components/Pill.astro", void 0);
//#endregion
export { $$Pill as t };
