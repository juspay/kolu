import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/dock-repo-colour-axes.svg?raw
var dock_repo_colour_axes_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 814 432\" font-family=\"ui-sans-serif,system-ui,sans-serif\" role=\"img\" aria-label=\"One colour source feeds two axes. repoColor (cool) reaches only the tiny 9.6px section name — the single starved repo sink. branchColor = annotationColor (hot) floods every full-size 13.6px row label — the rainbow. One colour spent on a sliver, the other on everything.\">\n  <defs>\n    <marker id=\"draArrCool\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#0D32B2\"/>\n    </marker>\n    <marker id=\"draArrHot\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"8.5\" markerHeight=\"8.5\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#b3471f\"/>\n    </marker>\n    <linearGradient id=\"draRainbow\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\">\n      <stop offset=\"0\" stop-color=\"#c0392b\"/>\n      <stop offset=\"0.22\" stop-color=\"#b8860b\"/>\n      <stop offset=\"0.45\" stop-color=\"#15803D\"/>\n      <stop offset=\"0.68\" stop-color=\"#0D32B2\"/>\n      <stop offset=\"1\" stop-color=\"#7a2d8f\"/>\n    </linearGradient>\n  </defs>\n\n  <!-- edges: src -> repo (cool, thin, starved) · src -> branch (hot, heavy, the flood) -->\n  <g fill=\"none\">\n    <path d=\"M362 70 C 268 112 218 122 218 174\" stroke=\"#0D32B2\" stroke-width=\"1.5\" marker-end=\"url(#draArrCool)\"/>\n    <path d=\"M432 70 C 540 110 596 118 596 158\" stroke=\"#b3471f\" stroke-width=\"3\" marker-end=\"url(#draArrHot)\"/>\n    <path d=\"M218 250 L218 326\" stroke=\"#0D32B2\" stroke-width=\"1.5\" marker-end=\"url(#draArrCool)\"/>\n    <path d=\"M596 244 L596 304\" stroke=\"#b3471f\" stroke-width=\"3\" marker-end=\"url(#draArrHot)\"/>\n  </g>\n\n  <!-- src: the one shared colour source -->\n  <g>\n    <rect x=\"135\" y=\"4\" width=\"524\" height=\"66\" rx=\"8\" fill=\"#F7F8FE\" stroke=\"#0D32B2\" stroke-width=\"2\"/>\n    <text x=\"397\" y=\"33\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#0A0F25\">terminalDisplay.ts — assignColors()</text>\n    <text x=\"397\" y=\"51\" text-anchor=\"middle\" font-size=\"12.5\" fill=\"#4A5072\">oklch(0.75 0.14, golden-angle hue)</text>\n  </g>\n\n  <!-- repo axis (cool / starved) — narrow, quiet -->\n  <g>\n    <rect x=\"119\" y=\"174\" width=\"198\" height=\"62\" rx=\"8\" fill=\"#EDF0FD\" stroke=\"#0D32B2\" stroke-width=\"1.5\"/>\n    <text x=\"218\" y=\"201\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#0A0F25\">repoColor</text>\n    <text x=\"218\" y=\"221\" text-anchor=\"middle\" font-size=\"12\" fill=\"#4A5072\">per repo</text>\n  </g>\n\n  <!-- branch axis (hot / the rainbow) — wide, heavy -->\n  <g>\n    <rect x=\"424\" y=\"158\" width=\"344\" height=\"86\" rx=\"9\" fill=\"#fbeee7\" stroke=\"#b3471f\" stroke-width=\"2.5\"/>\n    <text x=\"596\" y=\"192\" text-anchor=\"middle\" font-size=\"14.5\" font-weight=\"700\" fill=\"#3a1a0c\">branchColor = annotationColor</text>\n    <text x=\"596\" y=\"214\" text-anchor=\"middle\" font-size=\"12.5\" fill=\"#7a4a30\">per branch</text>\n    <rect x=\"468\" y=\"224\" width=\"256\" height=\"6\" rx=\"3\" fill=\"url(#draRainbow)\"/>\n  </g>\n\n  <!-- name sink: the only repo sink — TINY (9.6px), cool, starved -->\n  <g>\n    <rect x=\"133\" y=\"326\" width=\"170\" height=\"44\" rx=\"6\" fill=\"#EDF0FD\" stroke=\"#0D32B2\" stroke-width=\"1.5\"/>\n    <text x=\"218\" y=\"345\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"600\" fill=\"#0A0F25\">section name · 9.6px mono</text>\n    <text x=\"218\" y=\"361\" text-anchor=\"middle\" font-size=\"10\" fill=\"#4A5072\">◂ the only repo sink</text>\n  </g>\n\n  <!-- row sink: the rainbow — BIG (13.6px), hot, floods every row -->\n  <g>\n    <!-- stacked rows = the flood: every row label painted a different branch hue -->\n    <rect x=\"438\" y=\"318\" width=\"316\" height=\"100\" rx=\"9\" fill=\"#fef2f2\" stroke=\"#b3471f\" stroke-width=\"2.5\"/>\n    <g font-size=\"11\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">\n      <rect x=\"452\" y=\"328\" width=\"232\" height=\"13\" rx=\"3\" fill=\"#fbeee7\"/>\n      <rect x=\"452\" y=\"328\" width=\"4\" height=\"13\" rx=\"2\" fill=\"#0e9aa7\"/>\n      <text x=\"464\" y=\"338\" fill=\"#0e9aa7\">kaval</text>\n      <rect x=\"452\" y=\"345\" width=\"232\" height=\"13\" rx=\"3\" fill=\"#fbeee7\"/>\n      <rect x=\"452\" y=\"345\" width=\"4\" height=\"13\" rx=\"2\" fill=\"#d05a3e\"/>\n      <text x=\"464\" y=\"355\" fill=\"#d05a3e\">feat/tile-placeme…</text>\n      <rect x=\"452\" y=\"362\" width=\"232\" height=\"13\" rx=\"3\" fill=\"#fbeee7\"/>\n      <rect x=\"452\" y=\"362\" width=\"4\" height=\"13\" rx=\"2\" fill=\"#9b51c4\"/>\n      <text x=\"464\" y=\"372\" fill=\"#9b51c4\">zmosh</text>\n      <rect x=\"452\" y=\"379\" width=\"232\" height=\"13\" rx=\"3\" fill=\"#fbeee7\"/>\n      <rect x=\"452\" y=\"379\" width=\"4\" height=\"13\" rx=\"2\" fill=\"#2f9e54\"/>\n      <text x=\"464\" y=\"389\" fill=\"#2f9e54\">haskell-flake-revamp</text>\n    </g>\n    <text x=\"596\" y=\"411\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"#b3471f\">every row label · 13.6px  ◂ the rainbow</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/dock-repo-identity.mdx
var ProtoStyles = () => createVNode("style", { children: `
  .dk-gal{display:flex;flex-wrap:wrap;gap:1.15rem;margin:1.3rem 0;align-items:flex-start}
  .dk-fig{margin:0;display:flex;flex-direction:column;gap:.5rem}
  .dk-cap{font:.72rem/1.35 ui-sans-serif,system-ui;color:#8b929d;max-width:262px}
  .dk-cap b{color:#dadde2}
  .dk{width:262px;background:#161618;border:1px solid #27272c;border-radius:12px;overflow:hidden;box-shadow:0 8px 26px -10px rgba(0,0,0,.7);font-family:ui-sans-serif,system-ui}
  .dk-hd{display:flex;align-items:center;gap:.7rem;padding:.4rem .7rem;border-bottom:1px solid rgba(39,39,44,.7);color:#6f6f7c;font:.95rem/1 ui-monospace,monospace}
  .dk-hd .sp{margin-left:auto;font-size:.8rem}
  .dk-sec{position:relative}
  .dk-sech{display:flex;align-items:center;gap:.5rem;padding:.36rem .7rem;background:color-mix(in oklch,#1f1f23 60%,transparent);border-top:1px solid rgba(39,39,44,.55);border-bottom:1px solid rgba(39,39,44,.55)}
  .dk-name{font:700 .6rem/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--rc)}
  .dk-count{margin-left:auto;font:.6rem/1 ui-monospace,monospace;color:#838390}
  .dk-av{display:none}
  .dk-row{padding:.42rem .7rem .42rem 1.1rem}
  .dk-l1{display:grid;grid-template-columns:14px 1fr auto;gap:.5rem;align-items:center}
  .dk-l2{padding-left:calc(14px + .5rem)}
  .dk-pip{width:14px;display:flex;justify-content:center}
  .dk-pip i{display:block;border-radius:50%}
  .pip-unread i{width:9px;height:9px;background:#a78bfa;animation:dk-pulse 1.4s ease-in-out infinite}
  .pip-working i{width:9px;height:9px;border:1.5px solid #5a9ea0;background:transparent}
  .pip-idle i{width:5px;height:5px;background:#5c5c66}
  .dk-lab{font:600 .82rem/1.25 ui-sans-serif,system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
  .dk-time{font:.6rem/1 ui-monospace,monospace;color:#838390}
  .dk-sub{font:.63rem/1.3 ui-monospace,monospace;color:#9a9aa6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
  @keyframes dk-pulse{0%,100%{opacity:1}50%{opacity:.4}}
  /* calmed rows — repo owns the hue, labels go neutral (branch kept by a faint dot, see below) */
  .dk.calm .dk-lab{color:#dde0e5!important}
  /* ── A · SPINE + tinted header ── */
  .v-spine .dk-sec{border-left:3px solid var(--rc)}
  .v-spine .dk-sech{background:color-mix(in oklch,var(--rc) 15%,#1b1b1f)}
  .v-spine .dk-name{color:color-mix(in oklch,var(--rc) 78%,#ffffff)}
  /* ── B · avatar swatch ── */
  .v-avatar .dk-av{display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:var(--rc);color:#141416;font:700 .64rem/1 ui-monospace,monospace;flex:none}
  .v-avatar .dk-name{color:#cdd0d6}
  /* ── C · bold band ── */
  .v-band .dk-sech{background:color-mix(in oklch,var(--rc) 90%,#161618);border-color:transparent}
  .v-band .dk-name{color:#161618}
  .v-band .dk-count{color:rgba(20,20,24,.65)}
  @media (prefers-reduced-motion:reduce){.pip-unread i{animation:none}}
  ` });
var REPOS = [
	{
		name: "KOLU",
		color: "oklch(0.7 0.16 255)",
		rows: [
			{
				pip: "unread",
				label: "kaval",
				bc: "oklch(0.79 0.13 195)",
				sub: "Revert pull request 1288",
				time: "now"
			},
			{
				pip: "idle",
				label: "feat/tile-placeme…",
				bc: "oklch(0.78 0.15 18)",
				sub: "Checkout in current directory",
				time: "1h"
			},
			{
				pip: "idle",
				label: "zmosh",
				bc: "oklch(0.72 0.16 305)",
				sub: "Research Kaval implementation",
				time: "3h"
			}
		]
	},
	{
		name: "PANDOC",
		color: "oklch(0.8 0.16 115)",
		rows: [{
			pip: "working",
			label: "haskell-flake-revamp",
			bc: "oklch(0.77 0.16 150)",
			sub: "Update flake.nix to use haskell…",
			time: "1m"
		}]
	},
	{
		name: "PADAM",
		color: "oklch(0.7 0.18 350)",
		rows: [{
			pip: "idle",
			label: "master",
			bc: "oklch(0.78 0.15 72)",
			sub: "Bootstrap Claude Code to video pipe…",
			time: "3m"
		}]
	}
];
var Dock = (props) => createVNode("div", {
	class: `dk v-${props.variant}${props.calm ? " calm" : ""}`,
	children: [createVNode("div", {
		class: "dk-hd",
		children: [
			createVNode("span", { children: "+" }),
			createVNode("span", { children: "⌕" }),
			createVNode("span", {
				class: "sp",
				children: "‹"
			})
		]
	}), REPOS.map((r) => createVNode("div", {
		class: "dk-sec",
		style: `--rc:${r.color}`,
		children: [createVNode("div", {
			class: "dk-sech",
			children: [
				createVNode("span", {
					class: "dk-av",
					children: r.name[0]
				}),
				createVNode("span", {
					class: "dk-name",
					children: r.name
				}),
				createVNode("span", {
					class: "dk-count",
					children: r.rows.length
				})
			]
		}), r.rows.map((row) => createVNode("div", {
			class: `dk-row pip-${row.pip}`,
			children: [createVNode("div", {
				class: "dk-l1",
				children: [
					createVNode("span", {
						class: "dk-pip",
						children: createVNode("i", {})
					}),
					createVNode("span", {
						class: "dk-lab",
						style: `color:${row.bc}`,
						children: row.label
					}),
					createVNode("span", {
						class: "dk-time",
						children: row.time
					})
				]
			}), createVNode("div", {
				class: "dk-l2",
				children: createVNode("span", {
					class: "dk-sub",
					children: row.sub
				})
			})]
		}))]
	}))]
});
var DockCard = (props) => createVNode("figure", {
	class: "dk-fig",
	children: [createVNode(Dock, {
		variant: props.variant,
		calm: props.calm
	}), createVNode("figcaption", {
		class: "dk-cap",
		children: props.children
	})]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		b: "b",
		code: "code",
		em: "em",
		h2: "h2",
		p: "p",
		strong: "strong"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The dock already groups rows by repo. But you can’t ",
			createVNode(_components.em, { children: "see" }),
			" the grouping: the\nrepo colour is one ",
			createVNode(_components.strong, { children: "9.6px" }),
			" label that scrolls away, while every row label is\npainted a different ",
			createVNode(_components.strong, { children: "branch" }),
			" hue — a rainbow that fights the grouping it sits\ninside."
		] }),
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(ProtoStyles, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-two-colour-systems",
			children: "The two colour systems"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "buildTerminalDisplayInfos" }),
			" hands every render site two OKLCH hues — one per\n",
			createVNode(_components.strong, { children: "repo" }),
			" (",
			createVNode(_components.code, { children: "repoColor" }),
			"), one per ",
			createVNode(_components.strong, { children: "branch" }),
			" (",
			createVNode(_components.code, { children: "branchColor" }),
			", aliased\n",
			createVNode(_components.code, { children: "annotationColor" }),
			"). Cards mode spends them backwards: repo gets a single tiny\nlabel, branch gets every row."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: dock_repo_colour_axes_default,
			caption: "One palette, two axes — but the big sink is the wrong one. repoColor (cool blue) reaches only the 9.6px section name; branchColor (hot orange) paints every full-size row label. So the loudest colour on screen tracks branch, not the repo grouping the rows actually live in."
		}),
		"\n",
		createVNode("div", {
			class: "dk-gal",
			children: createVNode(DockCard, {
				variant: "today",
				calm: false,
				children: createVNode(_components.p, { children: [createVNode(_components.b, { children: "Today." }), " Repo = the small coloured word on a grey band. The rows\nbelow are a per-branch rainbow; nothing on a row carries its repo, so once\nthe header scrolls off you’ve lost the anchor."] })
			})
		}),
		"\n",
		createVNode(_components.h2, {
			id: "three-repo-treatments",
			children: "Three repo treatments"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Same dock, repo colour moved onto a surface with real mass — and pinned so it\nsurvives the scroll. These prototypes also calm the rows to neutral to show the\nrepo hue uncontested — but that second half was ",
			createVNode(_components.em, { children: "not" }),
			" shipped (see ",
			createVNode(_components.a, {
				href: "#the-row-rainbow",
				children: "The row\nrainbow"
			}),
			" below: branch colours stay). The three differ only in\n",
			createVNode(_components.em, { children: "how loud" }),
			" the repo signal gets; they compose."
		] }),
		"\n",
		createVNode("div", {
			class: "dk-gal",
			children: [
				createVNode(DockCard, {
					variant: "spine",
					calm: true,
					children: createVNode(_components.p, { children: [
						createVNode(_components.b, { children: "A · Spine + tinted header." }),
						" A continuous repo-colour bar down the\nsection’s left edge (persists below the header) and a faintly repo-tinted\nband — sticky in the real dock, so the label never leaves. Refined, low\nclutter. ",
						createVNode(_components.em, { children: "Recommended." })
					] })
				}),
				createVNode(DockCard, {
					variant: "avatar",
					calm: true,
					children: createVNode(_components.p, { children: [createVNode(_components.b, { children: "B · Avatar swatch." }), " A filled repo-colour tile + initial in each\nheader — the same vocabulary the rail-mode chips already use, so the two\ndock modes finally rhyme. A bright colour blob, but only at the header."] })
				}),
				createVNode(DockCard, {
					variant: "band",
					calm: true,
					children: createVNode(_components.p, { children: [createVNode(_components.b, { children: "C · Bold band." }), " The whole header filled with the repo colour, dark\ntext. Maximum separation between repo zones — reads as hard section\nbreaks. Heaviest; most colour on screen."] })
				})
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-row-rainbow",
			children: "The row rainbow"
		}),
		"\n",
		createVNode(_components.p, { children: "The other half of the fix is the rows. Keep them branch-coloured and the repo\ntreatment still fights the rainbow; calm them to neutral and repo owns the hue\noutright (branch stays distinguishable by the state pip and, if wanted, a faint\ndot). Same treatment A, both ways:" }),
		"\n",
		createVNode("div", {
			class: "dk-gal",
			children: [createVNode(DockCard, {
				variant: "spine",
				calm: false,
				children: createVNode(_components.p, { children: [createVNode(_components.b, { children: "Rainbow kept." }), " Branch hue on every label still pulls the eye off the\nrepo spine."] })
			}), createVNode(DockCard, {
				variant: "spine",
				calm: true,
				children: createVNode(_components.p, { children: [createVNode(_components.b, { children: "Rows calmed." }), " One hue per zone. The repo is the colour; the branch is\nthe word."] })
			})]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "recommendation",
			children: "Recommendation"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Spine + sticky tinted header (branch colours kept)",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Shipped: treatment A" }),
				" — ",
				createVNode($$PrLink, { pr: 1379 }),
				". A continuous repo-colour ",
				createVNode(_components.strong, { children: "spine" }),
				" down each section’s\nleft edge plus a faintly repo-tinted ",
				createVNode(_components.strong, { children: "sticky" }),
				" header — the smallest, most\nreversible change that puts a ",
				createVNode(_components.em, { children: "persistent" }),
				" repo cue on every row and keeps the\nlabel on screen as the rows scroll, without the visual weight of a full colour\nband. The per-row ",
				createVNode(_components.strong, { children: "branch colours stay" }),
				" (the rainbow was kept by choice — it\nstill tells branches apart within a repo); the spine sits at the section’s outer\nedge (x 0–3) and the active row’s existing 3px accent left-stripe\n(",
				createVNode($$Cite, {
					file: "packages/client/src/canvas/dock/Dock.tsx",
					lines: "464"
				}),
				") sits just\ninside it (x 3–6), so the two cues read together without overlapping. The same\n",
				createVNode(_components.code, { children: ".dock-cards-section*" }),
				" treatment rides the mobile drawer, and rail mode already\ncarries the repo colour in its section marks\n(",
				createVNode($$Cite, {
					file: "packages/client/src/canvas/dock/Dock.tsx",
					lines: "541"
				}),
				"), so every\ndock surface shares one repo-identity vocabulary."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Dock — telling repos apart at a glance",
	"description": "The cards-mode dock groups rows by repo, but spends its whole colour budget on a per-branch rainbow and gives repo identity one 9.6px label that scrolls away. Shipped treatment A — repo colour moved onto a left-edge spine + a sticky tinted header (PR #1379). Calming the per-branch row rainbow was prototyped alongside but deliberately NOT shipped: branch colours stay, because they still tell branches apart within a repo.",
	"parents": ["feature"],
	"status": "implemented",
	"maturity": "seedling"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-two-colour-systems",
			"text": "The two colour systems"
		},
		{
			"depth": 2,
			"slug": "three-repo-treatments",
			"text": "Three repo treatments"
		},
		{
			"depth": 2,
			"slug": "the-row-rainbow",
			"text": "The row rainbow"
		},
		{
			"depth": 2,
			"slug": "recommendation",
			"text": "Recommendation"
		}
	];
}
var url = "src/content/atlas/dock-repo-identity.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/dock-repo-identity.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/dock-repo-identity.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, Dock, DockCard, ProtoStyles, REPOS, file, frontmatter, getHeadings, url };
