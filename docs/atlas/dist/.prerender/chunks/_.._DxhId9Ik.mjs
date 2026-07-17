import { p as __exportAll } from "./parse_CmKbeYJl.mjs";
import { E as maybeRenderHead, I as createAstro, L as createComponent, O as addAttribute, h as renderTemplate, l as Fragment, s as renderComponent } from "./server_B0R_ZhRD.mjs";
import { a as getCollection, i as $$AtlasLayout, n as resolveParents, o as renderEntry, t as buildAtlasGraph } from "./atlasGraph_BBFLFj6M.mjs";
//#region src/components/TocList.astro
createAstro("https://astro.build");
var $$TocList = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$TocList;
	const { items } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<ul class="toc-list" data-astro-cid-rda6bqd5>${items.map((it) => renderTemplate`<li class="toc-item" data-astro-cid-rda6bqd5><a${addAttribute(`#${it.slug}`, "href")} data-astro-cid-rda6bqd5>${it.text}</a>${it.children.length > 0 && renderTemplate`${renderComponent($$result, "Astro.self", Astro.self, {
		"items": it.children,
		"data-astro-cid-rda6bqd5": true
	})}`}</li>`)}</ul>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/TocList.astro", void 0);
//#endregion
//#region src/components/Toc.astro
createAstro("https://astro.build");
var $$Toc = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Toc;
	const { headings, minDepth = 2, maxDepth = 3 } = Astro.props;
	const flat = headings.filter((h) => h.depth >= minDepth && h.depth <= maxDepth);
	const tree = [];
	const stack = [];
	for (const h of flat) {
		const node = {
			...h,
			children: []
		};
		while (stack.length > 0 && stack[stack.length - 1].depth >= h.depth) stack.pop();
		(stack.length > 0 ? stack[stack.length - 1].children : tree).push(node);
		stack.push(node);
	}
	return renderTemplate`${flat.length > 1 && renderTemplate`${maybeRenderHead($$result)}<nav class="toc" aria-label="Table of contents" data-astro-cid-7k3pnqyz><p class="toc-title" data-astro-cid-7k3pnqyz>Contents</p>${renderComponent($$result, "TocList", $$TocList, {
		"items": tree,
		"data-astro-cid-7k3pnqyz": true
	})}</nav>`}`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Toc.astro", void 0);
//#endregion
//#region src/components/Backlinks.astro
createAstro("https://astro.build");
var $$Backlinks = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Backlinks;
	const { notes } = Astro.props;
	return renderTemplate`${notes.length > 0 && renderTemplate`${maybeRenderHead($$result)}<nav class="backlinks" aria-label="Notes that reference this one" data-astro-cid-aziudkuj><h2 class="backlinks-h" data-astro-cid-aziudkuj>Referenced by</h2><ul class="backlinks-list" data-astro-cid-aziudkuj>${notes.map((n) => renderTemplate`<li data-astro-cid-aziudkuj><a${addAttribute(`./${n.id}.html`, "href")} data-astro-cid-aziudkuj>${n.title}</a></li>`)}</ul></nav>`}`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Backlinks.astro", void 0);
//#endregion
//#region src/pages/[...slug].astro
var ____slug__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Component,
	file: () => $$file,
	getStaticPaths: () => getStaticPaths,
	url: () => $$url
});
createAstro("https://astro.build");
async function getStaticPaths() {
	const notes = (await getCollection("atlas")).filter((n) => !n.data.draft);
	const { backlinks } = buildAtlasGraph(notes);
	const byId = new Map(notes.map((n) => [n.id, n]));
	const indexLabelOf = (note) => {
		if (note.data.moc) return "index";
		for (const pid of resolveParents(byId, note)) if (byId.get(pid)?.data.moc) return byId.get(pid).data.title;
	};
	return notes.map((note) => ({
		params: { slug: note.id },
		props: {
			note,
			backlinks: backlinks.get(note.id) ?? [],
			indexLabel: indexLabelOf(note)
		}
	}));
}
var $$Component = createComponent(async ($$result, $$props, $$slots) => {
	const Astro2 = $$result.createAstro($$props, $$slots);
	Astro2.self = $$Component;
	const { note, backlinks, indexLabel } = Astro2.props;
	const { Content, headings } = await renderEntry(note);
	const d = note.data;
	const fmtDate = (date) => date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "2-digit",
		timeZone: "UTC"
	}).toUpperCase();
	return renderTemplate`${renderComponent($$result, "AtlasLayout", $$AtlasLayout, {
		"title": d.title,
		"description": d.description,
		"path": `${note.id}.html`,
		"ogType": "article",
		"pubDate": d.updated
	}, { "default": async ($$result2) => renderTemplate`
  ${maybeRenderHead($$result2)}<article class="wrap"><header><a class="backlink" href="./index.html">← the Atlas</a><h1 class="note-h1">${d.title}</h1><div class="meta-row">${indexLabel && renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": ($$result3) => renderTemplate`<span>${indexLabel}</span><span class="meta-sep">·</span>` })}`}<span>${d.maturity}</span>${d.status && renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": ($$result3) => renderTemplate`<span class="meta-sep">·</span><span>${d.status}</span>` })}`}${d.draft && renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": ($$result3) => renderTemplate`<span class="meta-sep">·</span><span class="badge-draft">draft</span>` })}`}${d.updated && renderTemplate`${renderComponent($$result2, "Fragment", Fragment, {}, { "default": ($$result3) => renderTemplate`<span class="meta-sep">·</span><time${addAttribute(d.updated.toISOString(), "datetime")}>${fmtDate(d.updated)}</time>` })}`}</div><p class="note-sub">${d.description}</p>${renderComponent($$result2, "Toc", $$Toc, { "headings": headings })}</header><div class="prose">${renderComponent($$result2, "Content", Content, {})}</div>${renderComponent($$result2, "Backlinks", $$Backlinks, { "notes": backlinks })}<footer class="note-foot"><a class="backlink" href="./index.html">← the Atlas</a><a class="backlink" href="https://github.com/juspay/kolu" rel="noopener">github ↗</a></footer></article>
` })}`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/pages/[...slug].astro", void 0);
var $$file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/pages/[...slug].astro";
var $$url = "/[...slug].html";
//#endregion
//#region \0virtual:astro:page:src/pages/[...slug]@_@astro
var page = () => ____slug__exports;
//#endregion
export { page };
