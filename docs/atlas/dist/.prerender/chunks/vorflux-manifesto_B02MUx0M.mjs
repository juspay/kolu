import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/content/atlas/vorflux-manifesto.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"A reading of ",
			createVNode(_components.a, {
				href: "https://vorflux.com/manifesto",
				children: "the Vorflux manifesto"
			}),
			" (“The Great Flattening”), kept honest in both directions: where kolu is already the thing it describes, and where kolu’s doctrine deliberately disagrees."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-it-claims",
			children: "What it claims"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The models woke up." }),
				" Frontier models are “genuinely superhuman” at programming (SWE-bench Verified 33%→88.2% in two years; Codeforces 99.8th percentile) — and they’ve outgrown laptops, but “the cloud they were offered is ",
				createVNode(_components.strong, { children: "blind" }),
				"”: agents can’t ",
				createVNode(_components.em, { children: "run and watch" }),
				" the application, so humans get dragged back for verification."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The Great Flattening." }),
				" Organizations collapse from layered hierarchy toward a ",
				createVNode(_components.strong, { children: "harness" }),
				" — one system encoding company judgment. The human’s job “goes meta”: ",
				createVNode(_components.em, { children: "“you stop solving the task in front of you and start solving why the organism couldn’t solve it itself.”" }),
				" The ",
				createVNode(_components.strong, { children: "human cell boundary" }),
				" survives at the outward-facing edge (sales, relationships); everything internal — planning, design, review, execution — flattens."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Six bottlenecks" }),
				" on the way: the Machine (real multi-repo environments, not sandboxes) · Planning (a plan of plans) · Orchestration (route work to the right model per task) · Testing (live app testing, browser automation, recordings) · Review (",
				createVNode(_components.strong, { children: "cross-lab adversarial review" }),
				" — competitor models judging) · the Merge (automated conflict resolution + flags)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tokenmaxxing." }),
				" “The seat is the wrong unit of compute. The token is the right one.” And once execution is cheap, ",
				createVNode(_components.strong, { children: "backlogs are obsolete" }),
				": don’t prioritize — ",
				createVNode(_components.em, { children: "“build them all and find out which ones matter.”" }),
				" Stay vendor-neutral across model families to avoid lock-in."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "kolu-is-already-most-of-this--literally-this-week",
			children: "Kolu is already most of this — literally, this week"
		}),
		"\n",
		createVNode(_components.p, { children: "The manifesto describes, as a future, the shape of an ordinary kolu campaign. The six bottlenecks against kolu’s shipped stack:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Vorflux bottleneck" }),
					"\n",
					createVNode(_components.th, { children: "kolu today" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the Machine" }),
					"\n",
					createVNode(_components.td, { children: "padi hosts + the pu box pool — real repos, real daemons, leased per PR, egress-checked" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Planning" }),
					"\n",
					createVNode(_components.td, { children: "the Atlas plan-of-record: id-first phase trees, dep-sequenced rows, gates, done-criteria" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Orchestration" }),
					"\n",
					createVNode(_components.td, { children: "the coordinator’s model rule (“fable judges, opus grounds”), lens-run workflows, per-lane briefs" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Testing" }),
					"\n",
					createVNode(_components.td, { children: "e2e + seal on the exact shipping SHA, two platforms; agents drive chrome-devtools against the live app" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Review" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "the gauntlet" }), " — lens-debate, /codex-debate (a competitor lab’s model adversarially reviewing, warm-session, to consensus), code-police"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the Merge" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "deliberately human" }), " — srid merges; see the disagreement below"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"And the “job goes meta” line is kolu’s operating culture already: every coordinator failure this campaign became an encoded rule the same day (the atlas-branch liveness check, the ",
			createVNode(_components.code, { children: "/goal" }),
			" pin, the blocking-ask rule, the design-bearing lens trigger).",
			createVNode($$Footnote, { children: [
				"All in ",
				createVNode(_components.code, { children: "/orchestrator" }),
				" and the surface rule, each carrying its recorded failure as the rationale — the manifesto’s “solve why the organism couldn’t solve it itself,” practiced as skill-writing."
			] }),
			" The manifesto’s sharpest observation — the ",
			createVNode(_components.strong, { children: "blind cloud" }),
			" — names kolu’s exact differentiator: kolu is the anti-blind-cloud, a canvas where agents ",
			createVNode(_components.em, { children: "and" }),
			" the human watch the same live terminals, the same running app, the same dashboards."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-to-adopt",
			children: "What to adopt"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Say the thesis out loud." }),
				" Kolu’s story is scattered across notes; the manifesto compresses it: ",
				createVNode(_components.em, { children: "the harness is the product" }),
				". A kolu built for one user today is a company-judgment harness at any scale — the orchestrator skill, the gauntlet, the Atlas graph ",
				createVNode(_components.em, { children: "are" }),
				" the encoded judgment. Positioning, docs, and the website should claim this frame."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Cross-lab review as a first-class feature, not a skill." }),
				" /codex-debate proves the pattern (a rival lab’s model arguing to consensus); kolu terminals already host codex, opencode, grok. Generalize: a reviewer-panel primitive where N ",
				createVNode(_components.em, { children: "different-vendor" }),
				" agents debate a diff on the canvas — the manifesto’s bottleneck 5 as a product surface. (The debate skill’s ",
				createVNode(_components.code, { children: "--orchestrate" }),
				" mode is the seed.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Vendor neutrality as architecture." }),
				" Kolu already runs mixed-vendor agents in PTYs — the neutral-harness claim is true by construction. Keep it structural: nothing in padi/kaval may assume one agent CLI (the ",
				createVNode(_components.code, { children: "prohibitedKeybinds" }),
				" registry is the pattern — per-tool facts as data, not baked-in assumptions)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Token accounting where seat accounting was." }),
				" “Tokenmaxxing” needs meters: per-lane token/cost visibility on the dashboard and in reports (this week’s 81%-of-weekly-limit moment was discovered ",
				createVNode(_components.em, { children: "incidentally" }),
				", in a terminal footer). A harness that routes work by cost needs cost as a first-class fact."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Recordings as evidence." }), " Bottleneck 4’s “recordings” names a gap: kolu’s evidence class is screenshots + test output; a padi-native “record this lane’s screen for the PR” would make visual evidence one verb."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "where-kolu-disagrees",
			children: "Where kolu disagrees"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "“Backlogs are obsolete — build them all.”" }),
				" Kolu’s doctrine says the opposite, with receipts: prove-then-extract, parked-with-gate, declined-dated-with-revive-triggers. SR10 was ",
				createVNode(_components.em, { children: "declined" }),
				" this week precisely because building it was cheap but ",
				createVNode(_components.strong, { children: "owning it wasn’t" }),
				" — the constraint that survives cheap execution is not “what to build” but ",
				createVNode(_components.em, { children: "what to maintain, verify, and keep coherent" }),
				". “Build them all” maximizes exactly the accidental complexity the design philosophy exists to kill. The roadmap-graph work keeps the gate discipline; it does not replace prioritization with spray."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The fully-automated Merge." }),
				" Kolu keeps the human at merge — not as a bottleneck but as the ",
				createVNode(_components.em, { children: "adjudication seat" }),
				": this campaign’s record shows the human catching what every automated layer missed (the composition smell in a merged PR, a mis-clicked adjudication, a lying rules doc). The manifesto’s own “human cell boundary” is drawn at sales; kolu draws it at ",
				createVNode(_components.strong, { children: "judgment" }),
				" — the flattening stops where accountability starts."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Benchmark triumphalism." }), " The 88.2%-therefore-superhuman framing is marketing shorthand; kolu’s culture is evidence-per-claim (a fix isn’t done at “CI green” but at real-GPU soak, live acceptance, exact-SHA proof). Adopt the thesis, not the epistemics."] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The Vorflux Manifesto, Read From Kolu",
	"description": "A study of vorflux.com/manifesto — the Great Flattening thesis, its six bottlenecks, tokenmaxxing — mapped honestly onto what kolu already is, what it should adopt, and where its doctrine disagrees.",
	"parents": ["analysis"],
	"maturity": "seedling",
	"updated": "2026-07-15T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-it-claims",
			"text": "What it claims"
		},
		{
			"depth": 2,
			"slug": "kolu-is-already-most-of-this--literally-this-week",
			"text": "Kolu is already most of this — literally, this week"
		},
		{
			"depth": 2,
			"slug": "what-to-adopt",
			"text": "What to adopt"
		},
		{
			"depth": 2,
			"slug": "where-kolu-disagrees",
			"text": "Where kolu disagrees"
		}
	];
}
var url = "src/content/atlas/vorflux-manifesto.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/vorflux-manifesto.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/vorflux-manifesto.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
