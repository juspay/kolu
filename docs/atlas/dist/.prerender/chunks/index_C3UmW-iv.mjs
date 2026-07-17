import { p as __exportAll } from "./parse_CmKbeYJl.mjs";
import { E as maybeRenderHead, I as createAstro, L as createComponent, O as addAttribute, h as renderTemplate, s as renderComponent } from "./server_B0R_ZhRD.mjs";
import { a as getCollection, i as $$AtlasLayout, n as resolveParents, r as titleCmp, t as buildAtlasGraph } from "./atlasGraph_BBFLFj6M.mjs";
import { forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
//#region src/components/ForceGraph.astro
createAstro("https://astro.build");
var $$ForceGraph = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$ForceGraph;
	const { viewBox, nodes, edges } = Astro.props;
	const mocEdges = edges.filter((e) => e.toMoc);
	const realEdges = edges.filter((e) => !e.toMoc);
	return renderTemplate`${maybeRenderHead($$result)}<figure class="atlas-graph" data-astro-cid-5zu2za2p><div class="graph-bar" data-astro-cid-5zu2za2p><label class="graph-search" data-astro-cid-5zu2za2p><svg class="search-ic" viewBox="0 0 16 16" aria-hidden="true" data-astro-cid-5zu2za2p><circle cx="7" cy="7" r="4.5" data-astro-cid-5zu2za2p></circle><line x1="10.6" y1="10.6" x2="14" y2="14" data-astro-cid-5zu2za2p></line></svg><input type="search" data-graph-search placeholder="search notes by title…" aria-label="Search notes by title" autocomplete="off" spellcheck="false" data-astro-cid-5zu2za2p></label><span class="graph-bar-meta mono" data-astro-cid-5zu2za2p><span class="search-count" data-search-count aria-live="polite" data-astro-cid-5zu2za2p></span><button type="button" class="graph-reset" data-graph-reset data-astro-cid-5zu2za2p>reset view</button></span></div><svg class="graph-svg"${addAttribute(viewBox, "viewBox")} role="img" aria-label="Force-directed graph of the Atlas: every note, wired to its index note and its links" preserveAspectRatio="xMidYMid meet" data-astro-cid-5zu2za2p><g class="edges" data-astro-cid-5zu2za2p>${mocEdges.map((e) => renderTemplate`<line class="edge moc"${addAttribute(e.x1, "x1")}${addAttribute(e.y1, "y1")}${addAttribute(e.x2, "x2")}${addAttribute(e.y2, "y2")}${addAttribute(e.a, "data-a")}${addAttribute(e.b, "data-b")} vector-effect="non-scaling-stroke" data-astro-cid-5zu2za2p></line>`)}${realEdges.map((e) => renderTemplate`<line${addAttribute(`edge ${e.rel}`, "class")}${addAttribute(e.x1, "x1")}${addAttribute(e.y1, "y1")}${addAttribute(e.x2, "x2")}${addAttribute(e.y2, "y2")}${addAttribute(e.a, "data-a")}${addAttribute(e.b, "data-b")} vector-effect="non-scaling-stroke" data-astro-cid-5zu2za2p></line>`)}</g><g class="nodes" data-astro-cid-5zu2za2p>${nodes.map((n) => n.isMoc ? renderTemplate`<a class="node moc"${addAttribute(n.href, "href")}${addAttribute(n.id, "data-id")}${addAttribute(n.neighbors, "data-nb")}${addAttribute(`${n.title} ${n.id}`.toLowerCase(), "data-search")} data-astro-cid-5zu2za2p><g${addAttribute(`translate(${n.x} ${n.y})`, "transform")} data-astro-cid-5zu2za2p><title>${n.title}</title><rect${addAttribute(`chip c-${n.color}`, "class")}${addAttribute(-(n.chipW ?? 0) / 2, "x")}${addAttribute(-9, "y")}${addAttribute(n.chipW, "width")}${addAttribute(18, "height")}${addAttribute(9, "rx")} data-astro-cid-5zu2za2p></rect><text class="chip-label" data-astro-cid-5zu2za2p>${n.label}</text></g></a>` : renderTemplate`<a${addAttribute(`node${n.isHub ? " hub" : ""}`, "class")}${addAttribute(n.href, "href")}${addAttribute(n.id, "data-id")}${addAttribute(n.neighbors, "data-nb")}${addAttribute(`${n.title} ${n.id}`.toLowerCase(), "data-search")} data-astro-cid-5zu2za2p><g${addAttribute(`translate(${n.x} ${n.y})`, "transform")} data-astro-cid-5zu2za2p><title>${n.title}</title><circle${addAttribute(`dot c-${n.color} m-${n.maturity}`, "class")}${addAttribute(n.r, "r")} vector-effect="non-scaling-stroke" data-astro-cid-5zu2za2p></circle><text${addAttribute(`label${n.isHub ? " label-hub" : ""}`, "class")}${addAttribute(n.r + 10, "y")} data-astro-cid-5zu2za2p>${n.label}</text></g></a>`)}</g></svg><p class="graph-foot mono" data-astro-cid-5zu2za2p>drag to pan · scroll to zoom · click a node to open</p></figure><script>
  (function () {
    var fig = document.querySelector(".atlas-graph");
    if (!fig) return;
    var svg = fig.querySelector(".graph-svg");
    if (!svg) return;
    var nodes = Array.prototype.slice.call(svg.querySelectorAll(".node"));
    var edges = Array.prototype.slice.call(svg.querySelectorAll(".edge"));
    var byId = {};
    nodes.forEach(function (n) {
      byId[n.getAttribute("data-id")] = n;
    });

    // ── title search filter (its lit set is restored by clearHi after a hover) ──
    var searchActive = false;
    var matchIds = {};
    function renderSearch() {
      svg.classList.add("dim");
      nodes.forEach(function (n) {
        n.classList.toggle("on", !!matchIds[n.getAttribute("data-id")]);
      });
      edges.forEach(function (e) {
        e.classList.toggle(
          "on",
          !!matchIds[e.getAttribute("data-a")] &&
            !!matchIds[e.getAttribute("data-b")],
        );
      });
    }

    // ── 1-hop hover highlight (also driven by the hub cards via [data-hub]) ──
    function highlight(id) {
      var node = byId[id];
      if (!node) return;
      var nb = {};
      nb[id] = true;
      (node.getAttribute("data-nb") || "").split(" ").forEach(function (x) {
        if (x) nb[x] = true;
      });
      svg.classList.add("dim");
      nodes.forEach(function (n) {
        n.classList.toggle("on", !!nb[n.getAttribute("data-id")]);
      });
      edges.forEach(function (e) {
        e.classList.toggle(
          "on",
          e.getAttribute("data-a") === id || e.getAttribute("data-b") === id,
        );
      });
    }
    function clearHi() {
      if (searchActive) {
        renderSearch();
        return;
      }
      svg.classList.remove("dim");
      nodes.forEach(function (n) {
        n.classList.remove("on");
      });
      edges.forEach(function (e) {
        e.classList.remove("on");
      });
    }
    nodes.forEach(function (n) {
      var id = n.getAttribute("data-id");
      n.addEventListener("pointerenter", function () {
        highlight(id);
      });
      n.addEventListener("pointerleave", clearHi);
    });
    document.querySelectorAll("[data-hub]").forEach(function (card) {
      var id = card.getAttribute("data-hub");
      card.addEventListener("pointerenter", function () {
        highlight(id);
      });
      card.addEventListener("pointerleave", clearHi);
    });

    // ── pan + zoom via viewBox; drag suppresses the node's <a> navigation ──
    var vb = svg.viewBox.baseVal;
    var base = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    var MINR = 0.3,
      MAXR = 5;
    var dragging = false,
      moved = false,
      px = 0,
      py = 0,
      ox = 0,
      oy = 0;

    svg.addEventListener("pointerdown", function (e) {
      dragging = true;
      moved = false;
      px = e.clientX;
      py = e.clientY;
      ox = vb.x;
      oy = vb.y;
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - px,
        dy = e.clientY - py;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      var rect = svg.getBoundingClientRect();
      vb.x = ox - (dx * vb.width) / rect.width;
      vb.y = oy - (dy * vb.height) / rect.height;
    });
    window.addEventListener("pointerup", function () {
      dragging = false;
    });
    svg.addEventListener(
      "click",
      function (e) {
        if (moved) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );

    svg.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var rect = svg.getBoundingClientRect();
        var fx = (e.clientX - rect.left) / rect.width;
        var fy = (e.clientY - rect.top) / rect.height;
        var ux = vb.x + fx * vb.width;
        var uy = vb.y + fy * vb.height;
        var factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
        var ratio = (vb.width * factor) / base.w;
        if (ratio < MINR) factor = (MINR * base.w) / vb.width;
        if (ratio > MAXR) factor = (MAXR * base.w) / vb.width;
        vb.width *= factor;
        vb.height *= factor;
        vb.x = ux - fx * vb.width;
        vb.y = uy - fy * vb.height;
      },
      { passive: false },
    );

    var reset = fig.querySelector("[data-graph-reset]");
    if (reset)
      reset.addEventListener("click", function () {
        vb.x = base.x;
        vb.y = base.y;
        vb.width = base.w;
        vb.height = base.h;
      });

    // ── wire the search box → live title filter ──
    var search = fig.querySelector("[data-graph-search]");
    var countEl = fig.querySelector("[data-search-count]");
    function applySearch() {
      var q = (search.value || "").trim().toLowerCase();
      searchActive = q.length > 0;
      matchIds = {};
      if (!searchActive) {
        if (countEl) countEl.textContent = "";
        clearHi();
        return;
      }
      var count = 0;
      var total = 0;
      nodes.forEach(function (n) {
        var s = n.getAttribute("data-search");
        if (s == null) return; // kind chips aren't title-searchable
        total++;
        if (s.indexOf(q) !== -1) {
          matchIds[n.getAttribute("data-id")] = true;
          count++;
        }
      });
      renderSearch();
      if (countEl) countEl.textContent = count + " / " + total;
    }
    if (search) search.addEventListener("input", applySearch);
  })();
<\/script>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/ForceGraph.astro", void 0);
//#endregion
//#region src/components/MocHubs.astro
createAstro("https://astro.build");
var $$MocHubs = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$MocHubs;
	const { hubs } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<section class="moc-hubs" aria-label="Maps of Content" data-astro-cid-pyzg7dyc><div class="moc-grid" data-astro-cid-pyzg7dyc>${hubs.map((h) => renderTemplate`<article${addAttribute(`hub-card cc-${h.color}${h.isMoc ? " is-moc" : ""}`, "class")}${addAttribute(h.id, "data-hub")} data-astro-cid-pyzg7dyc><header class="hub-head" data-astro-cid-pyzg7dyc><span class="hub-bar" data-astro-cid-pyzg7dyc></span><a class="hub-title"${addAttribute(h.href, "href")} data-astro-cid-pyzg7dyc>${h.label}</a><span class="hub-count" data-astro-cid-pyzg7dyc>${h.count} ${h.countLabel}</span></header><p class="hub-desc" data-astro-cid-pyzg7dyc>${h.description}</p><ul class="cluster" data-astro-cid-pyzg7dyc>${h.cluster.map((c) => renderTemplate`<li data-astro-cid-pyzg7dyc><a class="cluster-row"${addAttribute(`./${c.id}.html`, "href")} data-astro-cid-pyzg7dyc><span${addAttribute(`cluster-dot m-${c.maturity}`, "class")} data-astro-cid-pyzg7dyc></span><span class="cluster-t" data-astro-cid-pyzg7dyc>${c.title}</span>${h.isMoc && renderTemplate`<span class="cluster-d" data-astro-cid-pyzg7dyc>${c.description}</span>`}</a></li>`)}</ul></article>`)}</div></section>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/MocHubs.astro", void 0);
//#endregion
//#region src/lib/graphView.ts
var RING_RADIUS = 300;
var TICKS = 340;
var NOTE_CHARGE = -210;
var MOC_CHARGE = -1500;
var EDGE_DISTANCE = 46;
var MOC_DISTANCE = 78;
var EDGE_STRENGTH = .7;
var MOC_STRENGTH = .16;
var PAD = 50;
var TOPICAL_MIN_INBOUND = 2;
var TOPICAL_CAP = 6;
var chipWidth = (label) => Math.round(label.length * 6.7 + 24);
var radiusOf = (degree) => 3.5 + Math.sqrt(degree) * 2.2;
var snap = (v) => Math.round(v) || 0;
var round1 = (v) => Math.round(v * 10) / 10;
function buildGraphLayout(notes, graph) {
	const { backlinks, edges, degree } = graph;
	const byId = new Map(notes.map((n) => [n.id, n]));
	const isMoc = (id) => byId.get(id)?.data.moc === true;
	const colorOf = (id) => {
		const d = byId.get(id).data;
		if (d.moc) return d.color ?? "grey";
		for (const pid of resolveParents(byId, byId.get(id))) {
			const pd = byId.get(pid)?.data;
			if (pd?.moc) return pd.color ?? "grey";
		}
		return "grey";
	};
	const ids = notes.map((n) => n.id).sort();
	const N = ids.length;
	const pairKey = (a, b) => a < b ? `${a} ${b}` : `${b} ${a}`;
	const sortedEdges = [...edges].sort((x, y) => {
		const kx = pairKey(x.source, x.target);
		const ky = pairKey(y.source, y.target);
		return kx < ky ? -1 : kx > ky ? 1 : 0;
	});
	const nbr = new Map(ids.map((id) => [id, /* @__PURE__ */ new Set()]));
	for (const e of sortedEdges) {
		nbr.get(e.source)?.add(e.target);
		nbr.get(e.target)?.add(e.source);
	}
	const neighborsStr = (id) => [...nbr.get(id) ?? []].sort().join(" ");
	const chipW = new Map(ids.filter(isMoc).map((id) => [id, chipWidth(byId.get(id).data.title)]));
	const rOf = (id) => isMoc(id) ? chipW.get(id) / 2 : radiusOf(degree.get(id) ?? 0);
	const simNodes = ids.map((id, i) => ({
		id,
		isMoc: isMoc(id),
		r: rOf(id),
		charge: isMoc(id) ? MOC_CHARGE : NOTE_CHARGE,
		x: Math.cos(2 * Math.PI * i / N) * RING_RADIUS,
		y: Math.sin(2 * Math.PI * i / N) * RING_RADIUS
	}));
	const simById = new Map(simNodes.map((n) => [n.id, n]));
	const simLinks = sortedEdges.map((e) => ({
		source: e.source,
		target: e.target,
		toMoc: isMoc(e.source) || isMoc(e.target)
	}));
	forceSimulation(simNodes).force("charge", forceManyBody().strength((d) => d.charge).theta(.9)).force("link", forceLink(simLinks).id((d) => d.id).distance((l) => l.toMoc ? MOC_DISTANCE : EDGE_DISTANCE).strength((l) => l.toMoc ? MOC_STRENGTH : EDGE_STRENGTH)).force("collide", forceCollide().radius((d) => d.r + 6).iterations(2)).stop().tick(TICKS);
	for (const n of simNodes) {
		n.x = snap(n.x ?? 0);
		n.y = snap(n.y ?? 0);
	}
	const inboundOf = (id) => backlinks.get(id)?.length ?? 0;
	const topical = ids.filter((id) => !isMoc(id)).sort((a, b) => inboundOf(b) - inboundOf(a) || (a < b ? -1 : a > b ? 1 : 0)).filter((id) => inboundOf(id) >= TOPICAL_MIN_INBOUND).slice(0, TOPICAL_CAP);
	const topicalSet = new Set(topical);
	const nodes = ids.map((id) => {
		const d = byId.get(id).data;
		const sn = simById.get(id);
		return {
			id,
			label: d.moc ? d.title : id,
			title: d.title,
			color: colorOf(id),
			isMoc: !!d.moc,
			href: `./${id}.html`,
			maturity: d.moc ? void 0 : d.maturity,
			isHub: topicalSet.has(id),
			x: sn.x,
			y: sn.y,
			r: d.moc ? chipW.get(id) / 2 : round1(radiusOf(degree.get(id) ?? 0)),
			chipW: d.moc ? chipW.get(id) : void 0,
			neighbors: neighborsStr(id)
		};
	});
	const graphEdges = sortedEdges.map((e) => {
		const s = simById.get(e.source);
		const t = simById.get(e.target);
		return {
			x1: s.x,
			y1: s.y,
			x2: t.x,
			y2: t.y,
			rel: e.kind,
			toMoc: isMoc(e.source) || isMoc(e.target),
			a: e.source,
			b: e.target
		};
	});
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const n of nodes) {
		minX = Math.min(minX, n.x - n.r);
		maxX = Math.max(maxX, n.x + n.r);
		minY = Math.min(minY, n.y - n.r);
		maxY = Math.max(maxY, n.y + n.r);
	}
	const vbX = Math.floor(minX - PAD);
	const vbY = Math.floor(minY - PAD);
	const viewBox = `${vbX} ${vbY} ${Math.ceil(maxX + PAD) - vbX} ${Math.ceil(maxY + PAD) - vbY}`;
	const member = (id) => {
		const d = byId.get(id).data;
		return {
			id,
			title: d.title,
			description: d.description,
			maturity: d.maturity
		};
	};
	const byTitle = (a, b) => titleCmp(a.title, b.title);
	return {
		viewBox,
		nodes,
		edges: graphEdges,
		hubs: ids.filter(isMoc).sort((a, b) => {
			return (byId.get(a).data.order ?? Number.POSITIVE_INFINITY) - (byId.get(b).data.order ?? Number.POSITIVE_INFINITY) || titleCmp(byId.get(a).data.title, byId.get(b).data.title);
		}).map((id) => {
			const d = byId.get(id).data;
			const cluster = (backlinks.get(id) ?? []).map((ref) => member(ref.id)).sort(byTitle);
			return {
				id,
				isMoc: true,
				label: d.title,
				href: `./${id}.html`,
				color: d.color ?? "grey",
				count: cluster.length,
				countLabel: cluster.length === 1 ? "note" : "notes",
				description: d.description,
				cluster
			};
		})
	};
}
//#endregion
//#region src/pages/index.astro
var pages_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => ""
});
var $$Index = createComponent(async ($$result, $$props, $$slots) => {
	const notes = (await getCollection("atlas")).filter((n) => !n.data.draft);
	const graph = buildAtlasGraph(notes);
	const layout = buildGraphLayout(notes, graph);
	const noteCount = notes.length;
	const edgeCount = graph.edges.length;
	const indexNotes = layout.hubs.filter((h) => h.isMoc).map((h) => ({
		label: h.label,
		color: h.color
	}));
	return renderTemplate`${renderComponent($$result, "AtlasLayout", $$AtlasLayout, {
		"title": "Atlas",
		"description": "kolu's in-repo Atlas — every note as one graph, with its Maps of Content. One entry point; everything is reachable from here.",
		"data-astro-cid-lcdefpme": true
	}, { "default": async ($$result2) => renderTemplate`
  ${maybeRenderHead($$result2)}<div class="wrap wrap-index" data-astro-cid-lcdefpme><p class="eyebrow" data-astro-cid-lcdefpme>the kolu atlas</p><h1 class="atlas-title" data-astro-cid-lcdefpme>The <span class="accent" data-astro-cid-lcdefpme>Atlas</span>.</h1><p class="lede" data-astro-cid-lcdefpme>Every note, wired by the links it already has — <code data-astro-cid-lcdefpme>parents</code> edges and same-directory references. The <strong data-astro-cid-lcdefpme>index notes</strong> (Bugs, Features, …) are just notes too, marked <code data-astro-cid-lcdefpme>moc</code>; every note hangs off one, so the Maps of Content below name them all. Hover to trace a note's neighborhood; click to open it.<strong data-astro-cid-lcdefpme>${noteCount}</strong> notes, <strong data-astro-cid-lcdefpme>${edgeCount}</strong> links.</p><div class="graph-legend" data-astro-cid-lcdefpme><div class="legend-group" data-astro-cid-lcdefpme><span class="legend-cap" data-astro-cid-lcdefpme>index</span>${indexNotes.map((m) => renderTemplate`<span class="legend-item" data-astro-cid-lcdefpme><span${addAttribute(`legend-swatch c-${m.color}`, "class")} data-astro-cid-lcdefpme></span>${m.label}</span>`)}</div><div class="legend-group" data-astro-cid-lcdefpme><span class="legend-cap" data-astro-cid-lcdefpme>maturity</span><span class="legend-item" data-astro-cid-lcdefpme><span class="legend-ring m-seedling" data-astro-cid-lcdefpme></span>seedling</span><span class="legend-item" data-astro-cid-lcdefpme><span class="legend-ring m-budding" data-astro-cid-lcdefpme></span>budding</span><span class="legend-item" data-astro-cid-lcdefpme><span class="legend-ring m-evergreen" data-astro-cid-lcdefpme></span>evergreen</span></div><div class="legend-group" data-astro-cid-lcdefpme><span class="legend-cap" data-astro-cid-lcdefpme>edge</span><span class="legend-item" data-astro-cid-lcdefpme><span class="legend-line solid" data-astro-cid-lcdefpme></span>parent</span><span class="legend-item" data-astro-cid-lcdefpme><span class="legend-line dashed" data-astro-cid-lcdefpme></span>reference</span></div></div>${renderComponent($$result2, "ForceGraph", $$ForceGraph, {
		"viewBox": layout.viewBox,
		"nodes": layout.nodes,
		"edges": layout.edges,
		"data-astro-cid-lcdefpme": true
	})}<div class="moc-head" data-astro-cid-lcdefpme><h2 class="moc-h" data-astro-cid-lcdefpme>Maps of Content</h2><p class="moc-sub" data-astro-cid-lcdefpme>The index notes — each lists every note filed under it. Together they name every note, so the whole Atlas is reachable from here; it all falls straight out of the <code data-astro-cid-lcdefpme>parents</code> links.</p></div>${renderComponent($$result2, "MocHubs", $$MocHubs, {
		"hubs": layout.hubs,
		"data-astro-cid-lcdefpme": true
	})}<footer class="note-foot" data-astro-cid-lcdefpme><a class="backlink" href="https://github.com/juspay/kolu" rel="noopener" data-astro-cid-lcdefpme>github ↗</a><a class="backlink" href="./meta.html" data-astro-cid-lcdefpme>what is the Atlas? →</a></footer></div>
` })}`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/pages/index.astro", void 0);
var $$file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/pages/index.astro";
//#endregion
//#region \0virtual:astro:page:src/pages/index@_@astro
var page = () => pages_exports;
//#endregion
export { page };
