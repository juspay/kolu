import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/anyforge.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		ol: "ol",
		p: "p",
		pre: "pre",
		span: "span",
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
			createVNode(_components.strong, { children: [
				"The plan for ",
				createVNode($$Issue, { n: 1240 }),
				" — PR metadata on forges beyond GitHub."
			] }),
			" Kolu’s PR pill was hardcoded to ",
			createVNode(_components.code, { children: "gh pr view" }),
			": on a Forgejo/Codeberg/GitLab remote it failed, was misclassified as ",
			createVNode(_components.code, { children: "not-authenticated" }),
			", and WARN-logged every 30s per terminal (fixed in phase 0a, ",
			createVNode($$PrLink, { pr: 1256 }),
			"). ic4-y’s draft ",
			createVNode($$PrLink, {
				pr: 1,
				repo: "ic4-y/kolu",
				label: "ic4-y/kolu#1"
			}),
			" proves the feature end-to-end (open PRs resolve on a real Forgejo instance) and lands several right calls — but it grows the forge-neutral kernel ",
			createVNode(_components.em, { children: "inside" }),
			" ",
			createVNode(_components.code, { children: "kolu-github" }),
			", so the Forgejo adapter depends on the GitHub adapter and even Forgejo’s error codes live in GitHub’s package. This plan re-cuts the same feature on the repo’s own precedent: ",
			createVNode(_components.code, { children: "anyagent" }),
			" is the neutral leaf agents share (",
			createVNode($$Cite, {
				file: "packages/integrations/anyagent/src/agent-adapter.ts",
				lines: "77-178"
			}),
			"); ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "anyforge" }), " is the same move for forges"] }),
			". Phase 0b is a pure refactor (GitHub-only, zero behavior change); phase 0c then pre-stages every ",
			createVNode(_components.em, { children: "cross-package" }),
			" seam a second forge has to cross — ",
			createVNode(_components.code, { children: "remoteUrl" }),
			", the server’s forge registry + detection, and the two forge-neutral helpers the gh adapter was still hoarding — all GitHub-only and zero-behavior, so ",
			createVNode(_components.strong, { children: "phase 1 (the Forgejo adapter) adds a sibling package and one registry line, and edits no shared mechanism." }),
			" The goal is a contributor diff that is purely ",
			createVNode(_components.em, { children: "additive" }),
			": new Forgejo code plus the irreducible compile-time union/popover arms, nothing structural."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phases-at-a-glance",
			children: "Phases at a glance"
		}),
		"\n",
		createVNode($$D2, {
			caption: "Target package graph. anyforge is the stable kernel — wire schemas, the PrProvider contract (kind: string, naming no forge), the generic poll loop, plus the forge-neutral grammar/helpers (parseRemoteHost · foldCheckOutcomes · logPrResolveFailure) — and nothing forge-specific. kolu-github and kolu-forgejo are sibling adapters that never see each other. Forge detection (which adapter resolves a remote) is a server concern: phase 0c lands the registry + detectForge GitHub-only, then 0d inverts the default — only github.com → github, every other remote → unsupported (never reaching gh) — so phase 1 just adds the forgejo entry above that default. Dashed = phase 1.",
			code: `direction: down
client: "client\\nPR pill · tooltip · recovery popover"
server: "kolu-server providers.ts\\nstartPrProvider — one watcher per terminal\\nPR_REGISTRY + detectForge + dispatching provider (0c, gh-only)\\nforgejo = +1 registry entry (phase 1)"
common: "kolu-common\\nterminalMetadata wire schema\\ncomposes closed PrUnavailableSource union\\n(like AgentInfoSchema)"
git: "kolu-git\\nGitInfo.remoteUrl + config-watcher (0c)"
adapters: "sibling adapters — never see each other" {
github: "kolu-github\\ngh pr view spawn\\nclassifyGhError · classifyCheck\\nowns GhUnavailable codes"
forgejo: "kolu-forgejo (phase 1)\\nForgejo/Codeberg REST"
}
anyforge: "anyforge — the leaf · names no forge\\nPrInfo · generic PrResult<S> · PrUnavailableSourceBase\\nPrProvider (kind: string) · subscribePr\\nparseRemoteHost · foldCheckOutcomes · logPrResolveFailure" {
style.bold: true
}
client -> server: "WebSocket (m.pr)"
client -> common: "TerminalMetadata"
server -> git: "git channel (incl. remoteUrl)"
server -> adapters: "registry dispatch on detectForge" {
style.stroke-dash: 3
}
server -> anyforge: "subscribePr · detectForge"
common -> anyforge: "PrResultSchema"
adapters -> anyforge: "implement PrProvider · reuse helpers"
`
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Gist" }),
					"\n",
					createVNode(_components.th, { children: "User-facing change" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0a" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "classifyGhError" }),
						": gh’s “point to a known GitHub host” refusal reclassified ",
						createVNode(_components.code, { children: "absent" }),
						", not ",
						createVNode(_components.code, { children: "not-authenticated" }),
						". One file + two tests."
					] }),
					"\n",
					createVNode(_components.td, { children: "Non-GitHub repos stop WARN-logging every 30s and stop showing a lying auth warning." }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1256 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0b" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Extract the ",
						createVNode(_components.strong, { children: "anyforge" }),
						" leaf: neutral schemas (renamed ",
						createVNode(_components.code, { children: "GitHubPrInfo" }),
						"→",
						createVNode(_components.code, { children: "PrInfo" }),
						" as part of the move), ",
						createVNode(_components.code, { children: "subscribePr" }),
						" poll loop, ",
						createVNode(_components.code, { children: "PrProvider" }),
						" contract (",
						createVNode(_components.code, { children: "kind: string" }),
						" — the kernel names no forge, mirroring ",
						createVNode(_components.code, { children: "anyagent" }),
						"). ",
						createVNode(_components.code, { children: "startPrProvider" }),
						" injects the one gh adapter."
					] }),
					"\n",
					createVNode(_components.td, { children: "None — behavior preserved (plus a stale-resolve guard surfaced in review: switching branches mid-lookup no longer flashes the prior branch’s PR)." }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1257 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0c" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Pre-stage the cross-package seams a second forge crosses, GitHub-only:" }),
						" ",
						createVNode(_components.code, { children: "GitInfo.remoteUrl" }),
						" (credential-stripped) + a ",
						createVNode(_components.code, { children: ".git/config" }),
						" watcher; ",
						createVNode(_components.code, { children: "PrGitContext.remoteUrl" }),
						"; the server’s ",
						createVNode(_components.code, { children: "PR_REGISTRY" }),
						" + sync/pure ",
						createVNode(_components.code, { children: "detectForge" }),
						" + a dispatching ",
						createVNode(_components.code, { children: "PrProvider" }),
						" (one entry, every host → gh); ",
						createVNode(_components.code, { children: "parseRemoteHost" }),
						" in the leaf; and ",
						createVNode(_components.strong, { children: "lift the two forge-neutral helpers the gh adapter still owned" }),
						" — the check-status fold (",
						createVNode(_components.code, { children: "foldCheckOutcomes" }),
						") and the resolve-failure log policy (",
						createVNode(_components.code, { children: "logPrResolveFailure" }),
						") — into ",
						createVNode(_components.code, { children: "anyforge" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: "None — every host still resolves through gh; behavior identical." }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1283 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0d" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							"Invert ",
							createVNode(_components.code, { children: "detectForge" }),
							"’s default to be honest about what’s GitHub."
						] }),
						" A new forge-neutral ",
						createVNode(_components.code, { children: "PrResult" }),
						" kind ",
						createVNode(_components.code, { children: "unsupported" }),
						" (distinct from ",
						createVNode(_components.code, { children: "absent" }),
						": “no adapter for this remote” ≠ “this branch has no PR”), and ",
						createVNode(_components.code, { children: "detectForge" }),
						" now maps ",
						createVNode(_components.strong, { children: [
							"only ",
							createVNode(_components.code, { children: "github.com" }),
							" → ",
							createVNode(_components.code, { children: "github" }),
							"; every other remote → ",
							createVNode(_components.code, { children: "unsupported" })
						] }),
						" (a trivial non-gh ",
						createVNode(_components.code, { children: "FORGE_ADAPTERS" }),
						" arm). The decision is made at the knowing endpoint (the remote host) instead of guessed from ",
						createVNode(_components.code, { children: "gh" }),
						"’s stderr, and kolu no longer ",
						createVNode(_components.em, { children: "claims" }),
						" an arbitrary URL is GitHub — so the bug below can’t be expressed for any non-GitHub remote. ",
						createVNode(_components.em, { children: "Accepted cost: a GitHub Enterprise remote loses its PR pill (out of scope, #1240)." })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Codeberg / self-hosted-forge / no-remote terminals stop emitting ",
						createVNode(_components.code, { children: "error" }),
						"-level log noise and the scary “gh: unknown error” popover; they show nothing (no GitHub PR), like a branch with no PR but for the honest reason."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1631 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "1" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kolu-forgejo" }),
						" sibling adapter — now ",
						createVNode(_components.strong, { children: "purely additive" }),
						": the detection/registry/",
						createVNode(_components.code, { children: "remoteUrl" }),
						" plumbing already exists (0c–0d), so this is ",
						createVNode(_components.strong, { children: [
							"one ",
							createVNode(_components.code, { children: "PR_REGISTRY" }),
							" entry + one host match in ",
							createVNode(_components.code, { children: "detectForge" })
						] }),
						" (",
						createVNode(_components.code, { children: "codeberg.org" }),
						" / ",
						createVNode(_components.code, { children: "KOLU_FORGEJO_HOSTS" }),
						" → ",
						createVNode(_components.code, { children: "forgejo" }),
						", ",
						createVNode(_components.em, { children: "above" }),
						" the ",
						createVNode(_components.code, { children: "unsupported" }),
						" default) plus the Forgejo REST resolver (zod-validated, typed errors) and the irreducible compile-time union/popover arms. ",
						createVNode(_components.code, { children: "kolu-github" }),
						" and ",
						createVNode(_components.code, { children: "kolu-git" }),
						" are untouched."
					] }),
					"\n",
					createVNode(_components.td, { children: "Full PR pill — number, title, open/merged/closed state, CI checks — on Codeberg and self-hosted Forgejo/Gitea." }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "todo",
						children: "closes #1240"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "later" }) }),
					"\n",
					createVNode(_components.td, { children: "GitLab adapter; per-host tokens; opt-in auto-detection probe." }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "todo",
						children: "not scheduled"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-the-draft-teaches",
			children: "What the draft teaches"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A structural pass (Hickey + Lowy lenses) over ",
			createVNode($$PrLink, {
				pr: 1,
				repo: "ic4-y/kolu",
				label: "ic4-y/kolu#1"
			}),
			" sorted its ~1.5k-line diff into keep / re-home / redo:"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Keep as-is" }), " — the parts a clean implementation adopts verbatim:"] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"The ",
				createVNode(_components.code, { children: "classifyGhError" }),
				" reclassification (with its tripwire test) — the actual bug fix, done at the right layer (classification, not call-site log suppression)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "remoteUrl" }),
				" on ",
				createVNode(_components.code, { children: "GitInfo" }),
				" — right home (",
				createVNode(_components.code, { children: "kolu-git" }),
				" owns remote discovery), best-effort ",
				createVNode(_components.code, { children: "git remote get-url origin" }),
				" → ",
				createVNode(_components.code, { children: "null" }),
				", ",
				createVNode(_components.code, { children: "gitInfoEqual" }),
				" extended so a remote change re-triggers downstream. ",
				createVNode(_components.strong, { children: "Adopted in 0c" }),
				": it lands with ",
				createVNode(_components.code, { children: "detectForge" }),
				" and the registry, GitHub-only — the one deliberate “field with no live consumer yet” the plan accepts, traded for a phase-1 contributor diff that adds rather than restitches (the draft’s coupling came from ",
				createVNode(_components.em, { children: "where" }),
				" it put the logic, not from staging it early)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The ",
				createVNode(_components.code, { children: "subscribePrResolver" }),
				" extraction — the poll/dedup/pending/emit-guard machinery genuinely is forge-neutral, and the draft’s Forgejo adapter correctly does ",
				createVNode(_components.strong, { children: "not" }),
				" duplicate it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The registry idea mirroring ",
				createVNode(_components.code, { children: "AgentProvider" }),
				", the exhaustive ",
				createVNode(_components.code, { children: "ts-pattern" }),
				" dispatch on ",
				createVNode(_components.code, { children: "PrUnavailableSource.provider" }),
				" (a new forge arm is a compile error at every render site), and the per-code popover recovery copy."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Re-home" }),
			" — right code, wrong package. The neutral contract (",
			createVNode(_components.code, { children: "PrProvider" }),
			", ",
			createVNode(_components.code, { children: "PrWatcher" }),
			", ",
			createVNode(_components.code, { children: "subscribePrResolver" }),
			", ",
			createVNode(_components.code, { children: "detectForge" }),
			", the ",
			createVNode(_components.code, { children: "PrInfo" }),
			"/",
			createVNode(_components.code, { children: "PrResult" }),
			" schemas) all landed inside ",
			createVNode(_components.code, { children: "kolu-github" }),
			", so ",
			createVNode(_components.code, { children: "kolu-forgejo" }),
			" imports its own types ",
			createVNode(_components.em, { children: "from the GitHub adapter" }),
			", and ",
			createVNode(_components.code, { children: "ForgejoUnavailableCodeSchema" }),
			" is defined in GitHub’s schemas file. The codebase already named this smell: the schemas header had carried a “when a second provider lands, promote the neutrals to their own leaf” note since day one — the draft ",
			createVNode(_components.em, { children: "is" }),
			" the second provider, and it edited the comment instead of doing the promotion; 0b (",
			createVNode($$PrLink, { pr: 1257 }),
			") performed it. ",
			createVNode(_components.code, { children: "kolu-common" }),
			" importing ",
			createVNode(_components.code, { children: "PrResultSchema" }),
			" from ",
			createVNode(_components.code, { children: "kolu-github/schemas" }),
			" was the same coupling on the wire side — removed in 0b, where the closed union and wire schema now compose in ",
			createVNode(_components.code, { children: "kolu-common" }),
			" itself."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Redo" }), " — design faults, not placement faults:"] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Async detection races the git channel." }),
				" The draft probes unknown hosts over the network (",
				createVNode(_components.code, { children: "GET https://host/api/v1/version" }),
				") and ",
				createVNode(_components.code, { children: "await" }),
				"s that inside the git channel’s ",
				createVNode(_components.code, { children: "onEvent" }),
				" — but the channel contract is synchronous fire-and-forget, so two quick git events can interleave and a stale slow probe can tear down the fresh watcher. Detection must be sync and pure."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Auto-egress to arbitrary hosts" }),
				" parsed out of git remotes is a privacy decision smuggled in as an implementation detail — and it’s what makes the global ",
				createVNode(_components.code, { children: "KOLU_FORGEJO_TOKEN" }),
				" dangerous (a token sent to any host that answers the probe)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Lifecycle churn from interface shape." }),
				" ",
				createVNode(_components.code, { children: "subscribe(repoRoot, branch, remoteUrl, …)" }),
				" bakes git state into construction, so the orchestrator grows a ",
				createVNode(_components.code, { children: "lastKey" }),
				" string and a teardown/rebuild dance just to survive a remote change; meanwhile ",
				createVNode(_components.code, { children: "resolveGitHubPr" }),
				" gained an unused ",
				createVNode(_components.code, { children: "_branch" }),
				" param mid-signature and ",
				createVNode(_components.code, { children: "resolveForgejoPr" }),
				" ignores its ",
				createVNode(_components.code, { children: "repoRoot" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Resolver rigor" }),
				": responses parsed with ",
				createVNode(_components.code, { children: "as T" }),
				" casts despite zod being a dependency; HTTP status re-parsed out of error message ",
				createVNode(_components.em, { children: "strings" }),
				" (",
				createVNode(_components.code, { children: "msg.includes(\"401\")" }),
				"); branch matched by ",
				createVNode(_components.code, { children: "head.ref" }),
				" alone — the exact fork-PR bug GitHub’s resolver documents avoiding — and only ",
				createVNode(_components.code, { children: "state=open" }),
				" queried, so Forgejo PRs can never show the merged/closed pill. Zero tests in the new package."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-anyforge-leaf",
			children: "The anyforge leaf"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "packages/integrations/anyforge/" }),
			" (package name ",
			createVNode(_components.code, { children: "anyforge" }),
			", mirroring ",
			createVNode(_components.code, { children: "anyagent" }),
			"), a leaf depending only on ",
			createVNode(_components.code, { children: "kolu-shared" }),
			" + zod + ts-pattern. It owns the two things that are stable while forges vary — and, crucially, ",
			createVNode(_components.strong, { children: "names no specific forge" }),
			" (the kernel is the ",
			createVNode(_components.em, { children: "receptacle" }),
			", not a registry of plugs):"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The wire vocabulary — the neutral half." }),
			" ",
			createVNode(_components.code, { children: "PrInfoSchema" }),
			" (",
			createVNode(_components.code, { children: "number/title/url/state/checks/checkRuns" }),
			" — already forge-neutral in shape), ",
			createVNode(_components.code, { children: "PrStateSchema" }),
			", ",
			createVNode(_components.code, { children: "CheckStatusSchema" }),
			", ",
			createVNode(_components.code, { children: "CheckRunSchema" }),
			", the ",
			createVNode(_components.strong, { children: "generic" }),
			" ",
			createVNode(_components.code, { children: "PrResult<S>" }),
			" (",
			createVNode(_components.code, { children: "pending | ok | absent | unsupported | unavailable{ source: S }" }),
			") over the open ",
			createVNode(_components.code, { children: "PrUnavailableSourceBase = { provider: string; code: string }" }),
			", plus the ",
			createVNode(_components.code, { children: "prValue" }),
			" / ",
			createVNode(_components.code, { children: "prLabel" }),
			" / ",
			createVNode(_components.code, { children: "prResultEqual" }),
			" helpers. The leaf names ",
			createVNode(_components.strong, { children: "no forge" }),
			". The ",
			createVNode(_components.strong, { children: "closed" }),
			" ",
			createVNode(_components.code, { children: "PrUnavailableSource" }),
			" union and the wire ",
			createVNode(_components.code, { children: "PrResultSchema" }),
			" — the part the client must ",
			createVNode(_components.code, { children: "match(...).exhaustive()" }),
			" — are composed one layer up, in the app (",
			createVNode(_components.code, { children: "kolu-common" }),
			"), and each adapter’s failure codes live ",
			createVNode(_components.strong, { children: "in that adapter" }),
			" (",
			createVNode(_components.code, { children: "GhUnavailableCodeSchema" }),
			" + ",
			createVNode(_components.code, { children: "reasonForGhCode" }),
			" in ",
			createVNode(_components.code, { children: "kolu-github" }),
			"). This is exactly the ",
			createVNode(_components.code, { children: "anyagent" }),
			" split: ",
			createVNode(_components.code, { children: "AgentInfoShape" }),
			" (generic, in the leaf) → ",
			createVNode(_components.code, { children: "ClaudeCodeInfoSchema" }),
			" (concrete, in ",
			createVNode(_components.code, { children: "kolu-claude-code" }),
			") → ",
			createVNode(_components.code, { children: "AgentInfoSchema" }),
			" (the closed union, composed in ",
			createVNode(_components.code, { children: "kolu-common" }),
			"). The closed-union exhaustiveness trade-off is preserved — just at the layer that owns it."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The provider contract — a pure resolver." }),
			" Mirrors ",
			createVNode(_components.code, { children: "anyagent" }),
			"’s ",
			createVNode(_components.code, { children: "AgentProvider" }),
			" exactly: a ",
			createVNode(_components.code, { children: "kind: string" }),
			" discriminator (the leaf enumerates no forge — just as ",
			createVNode(_components.code, { children: "AgentProvider.kind" }),
			" is ",
			createVNode(_components.code, { children: "string" }),
			" and the concrete ",
			createVNode(_components.code, { children: "AgentKindSchema" }),
			" enum lives in the app, ",
			createVNode(_components.code, { children: "kolu-common" }),
			", not the leaf) plus one stateless ",
			createVNode(_components.code, { children: "resolve" }),
			":"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// remoteUrl added in 0c — the gh adapter ignores it; the server's dispatcher"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// reads it to pick the forge. The leaf still names no forge."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PrGitContext"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "repoRoot"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "branch"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "remoteUrl"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PrProvider"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: " kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// e.g. \"github\" — set by the adapter, not a closed union here"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  resolve"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "git"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PrGitContext"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "log"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Logger"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "PrResult"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The generic watcher ",
			createVNode(_components.code, { children: "subscribePr(provider, onChange, log)" }),
			" keeps everything ",
			createVNode(_components.code, { children: "subscribeGitHubPr" }),
			" owns today — branch-change dedup via ",
			createVNode(_components.code, { children: "prResultEqual" }),
			", synchronous ",
			createVNode(_components.code, { children: "pending" }),
			" emit so stale info never lingers, the 30s poll, the emit-guard, and a stale-resolve guard (an async resolve whose ",
			createVNode(_components.code, { children: "{repoRoot, branch}" }),
			" is no longer current is dropped before emit) — and takes ",
			createVNode(_components.strong, { children: ["one injected ", createVNode(_components.code, { children: "PrProvider" })] }),
			", exactly as ",
			createVNode(_components.code, { children: "startAgentProvider" }),
			" takes one ",
			createVNode(_components.code, { children: "AgentProvider" }),
			". The watcher itself stays forge-blind in every phase: the dispatch lives ",
			createVNode(_components.em, { children: "in the provider it’s handed" }),
			" (below), never in the loop."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Forge detection is a server concern, not the kernel’s — and it lands in 0c, GitHub-only." }),
			" Which adapter resolves a given remote (",
			createVNode(_components.code, { children: "detectForge(remoteUrl)" }),
			", the ",
			createVNode(_components.code, { children: "ForgeKind" }),
			"→",
			createVNode(_components.code, { children: "PrProvider" }),
			" registry) is a ",
			createVNode(_components.em, { children: "server" }),
			" job: only the server imports more than one adapter, so only the server can hold the registry. The leaf contributes the forge-neutral ",
			createVNode(_components.em, { children: "grammar" }),
			" (",
			createVNode(_components.code, { children: "parseRemoteHost" }),
			") and never the mapping. The dispatch is implemented as a ",
			createVNode(_components.code, { children: "PrProvider" }),
			" whose ",
			createVNode(_components.code, { children: "resolve" }),
			" consults ",
			createVNode(_components.code, { children: "PR_REGISTRY[detectForge(git.remoteUrl)]" }),
			" — so ",
			createVNode(_components.code, { children: "subscribePr" }),
			" still takes one provider and the watcher never learns the registry exists. 0c lands this GitHub-only: ",
			createVNode(_components.code, { children: "detectForge" }),
			" maps every host → ",
			createVNode(_components.code, { children: "github" }),
			" (sync and pure — no network probe; ",
			createVNode(_components.code, { children: "gh" }),
			" is the fallback prober, GHE included, and post-0a it degrades to a silent ",
			createVNode(_components.code, { children: "absent" }),
			" on hosts it doesn’t know). An earlier cut deferred this to phase 1 as “a registry with one entry is premature coupling.” The deliberate reversal: pre-building the seam GitHub-only costs one no-op indirection now and buys a phase-1 contributor diff that ",
			createVNode(_components.em, { children: "adds a sibling package and one registry line" }),
			" instead of restitching the server, the git layer, and the gh adapter. When a real ",
			createVNode(_components.code, { children: "forgejo" }),
			" adapter is wanted, it’s one ",
			createVNode(_components.code, { children: "case" }),
			" arm in ",
			createVNode(_components.code, { children: "detectForge" }),
			"’s host switch. ",
			createVNode(_components.strong, { children: "0d revisits the default itself." }),
			" 0c’s “every host → ",
			createVNode(_components.code, { children: "github" }),
			", let ",
			createVNode(_components.code, { children: "gh" }),
			" be the fallback prober” leans on an ",
			createVNode(_components.em, { children: "unfounded" }),
			" assertion — that an arbitrary clone URL is GitHub — and on ",
			createVNode(_components.code, { children: "gh" }),
			"’s brittle, unversioned refusal stderr to walk it back. 0d inverts it: ",
			createVNode(_components.strong, { children: [
				"only ",
				createVNode(_components.code, { children: "github.com" }),
				" → ",
				createVNode(_components.code, { children: "github" }),
				"; every other remote → ",
				createVNode(_components.code, { children: "unsupported" })
			] }),
			" (a non-gh arm returning ",
			createVNode(_components.code, { children: "{ kind: \"unsupported\" }" }),
			"), so a non-GitHub remote never reaches ",
			createVNode(_components.code, { children: "gh" }),
			" and the log noise / popover (juspay/kolu#1627) can no longer be expressed. The honest trade, accepted: a ",
			createVNode(_components.strong, { children: "GitHub Enterprise" }),
			" remote — an arbitrary corporate host ",
			createVNode(_components.code, { children: "gh" }),
			" may be authed for, indistinguishable from any unknown host by URL — loses its PR pill, reopened by the per-host config / real adapter work (#1240). Phase 1 then adds ",
			createVNode(_components.code, { children: "case \"codeberg.org\": return \"forgejo\"" }),
			" (and ",
			createVNode(_components.code, { children: "$KOLU_FORGEJO_HOSTS" }),
			") ",
			createVNode(_components.em, { children: "above" }),
			" the ",
			createVNode(_components.code, { children: "unsupported" }),
			" default."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-phases-in-detail",
			children: "The phases in detail"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "0a--stop-the-lying-warn-shipped-",
			children: [
				"0a — stop the lying WARN ",
				createVNode($$Pill, {
					variant: "done",
					children: "shipped"
				}),
				" ",
				createVNode($$PrLink, { pr: 1256 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "classifyGhError" }),
			": stderr containing ",
			createVNode(_components.code, { children: "\"point to a known github host\"" }),
			" → ",
			createVNode(_components.code, { children: "{ kind: \"absent\" }" }),
			", slotted above the ",
			createVNode(_components.code, { children: "\"gh auth login\"" }),
			" substring check that currently steals it (the refusal message mentions ",
			createVNode(_components.code, { children: "gh auth login" }),
			", hence the misclassification). Match the specific “known GitHub host” sentence, ",
			createVNode(_components.strong, { children: "not" }),
			" the bare ",
			createVNode(_components.code, { children: "\"none of the git remotes\"" }),
			" prefix — gh’s ",
			createVNode(_components.code, { children: "remoteResolver" }),
			" emits a second message with that same prefix (“…correspond to the GH_HOST environment variable…”) for a misconfigured ",
			createVNode(_components.code, { children: "GH_HOST" }),
			" that matches no remote, which is a real config failure the user should still see (",
			createVNode(_components.code, { children: "unavailable" }),
			"). Known false-negative: the same refusal fires for a GitHub Enterprise remote the user hasn’t run ",
			createVNode(_components.code, { children: "gh auth login --hostname <ghe>" }),
			" for (gh’s known-host set = its authenticated hosts + the default host + github.com), where ",
			createVNode(_components.code, { children: "not-authenticated" }),
			" was the correct call — indistinguishable on stderr — and remote-URL detection can’t tell a GHE host from any other unknown host without configuration, so the gap stays until per-host config lands (open question below). Plus two table-test rows pinning both strings. ",
			createVNode(_components.strong, { children: "Verify:" }),
			" unit tests; a terminal in a Forgejo-remote repo shows no warning icon and logs nothing above debug."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "0b--extract-anyforge-shipped-",
			children: [
				"0b — extract anyforge ",
				createVNode($$Pill, {
					variant: "done",
					children: "shipped"
				}),
				" ",
				createVNode($$PrLink, { pr: 1257 })
			]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Create ",
				createVNode(_components.code, { children: "packages/integrations/anyforge/" }),
				"; ",
				createVNode(_components.strong, { children: "move" }),
				" (not copy) the ",
				createVNode(_components.strong, { children: "neutral" }),
				" schemas + helpers out of ",
				createVNode(_components.code, { children: "kolu-github/src/schemas.ts" }),
				", renaming on the way (",
				createVNode(_components.code, { children: "GitHubPrInfo" }),
				"→",
				createVNode(_components.code, { children: "PrInfo" }),
				", ",
				createVNode(_components.code, { children: "GitHubCheckStatus" }),
				"→",
				createVNode(_components.code, { children: "CheckStatus" }),
				", ",
				createVNode(_components.code, { children: "GitHubCheck" }),
				"→",
				createVNode(_components.code, { children: "CheckRun" }),
				", ",
				createVNode(_components.code, { children: "GitHubPrState" }),
				"→",
				createVNode(_components.code, { children: "PrState" }),
				") — the rename and the move are one mechanical commit. The leaf gets only the ",
				createVNode(_components.em, { children: "generic" }),
				" ",
				createVNode(_components.code, { children: "PrResult<S>" }),
				" over ",
				createVNode(_components.code, { children: "{ provider: string; code: string }" }),
				". The ",
				createVNode(_components.code, { children: "Gh*" }),
				" unavailable codes ",
				createVNode(_components.strong, { children: ["stay in ", createVNode(_components.code, { children: "kolu-github" })] }),
				" (on a browser-safe ",
				createVNode(_components.code, { children: "kolu-github/schemas" }),
				" arm, like ",
				createVNode(_components.code, { children: "kolu-claude-code" }),
				"’s); the ",
				createVNode(_components.strong, { children: "closed" }),
				" ",
				createVNode(_components.code, { children: "PrUnavailableSource" }),
				" union + the wire ",
				createVNode(_components.code, { children: "PrResultSchema" }),
				" compose in ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "kolu-common" }) }),
				", next to ",
				createVNode(_components.code, { children: "AgentInfoSchema" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Move the poll loop as ",
				createVNode(_components.code, { children: "subscribePr(provider, onChange, log)" }),
				" taking one injected ",
				createVNode(_components.code, { children: "PrProvider" }),
				"; ",
				createVNode(_components.strong, { children: "delete" }),
				" ",
				createVNode(_components.code, { children: "subscribeGitHubPr" }),
				" and the ",
				createVNode(_components.code, { children: "GitHubPrWatcher" }),
				" alias rather than shimming (private monorepo, one test file to update). ",
				createVNode(_components.code, { children: "PrProvider.kind" }),
				" is ",
				createVNode(_components.code, { children: "string" }),
				" — ",
				createVNode(_components.strong, { children: [
					"no ",
					createVNode(_components.code, { children: "ForgeKind" }),
					" union in the leaf"
				] }),
				" (the ",
				createVNode(_components.code, { children: "anyagent" }),
				" precedent: ",
				createVNode(_components.code, { children: "AgentProvider.kind: string" }),
				", concrete enum in ",
				createVNode(_components.code, { children: "kolu-common" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "kolu-github" }),
				" shrinks to the gh adapter: ",
				createVNode(_components.code, { children: "getGhBin" }),
				"/",
				createVNode(_components.code, { children: "resolveGitHubPr" }),
				", ",
				createVNode(_components.code, { children: "classifyGhError" }),
				", ",
				createVNode(_components.code, { children: "deriveCheckStatus" }),
				"/",
				createVNode(_components.code, { children: "extractChecks" }),
				", exporting ",
				createVNode(_components.code, { children: "githubPrProvider: PrProvider" }),
				" (",
				createVNode(_components.code, { children: "kind: \"github\"" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "startGitHubPrProvider" }),
				" became ",
				createVNode(_components.code, { children: "startPrProvider" }),
				" (",
				createVNode($$Cite, {
					file: "packages/server/src/terminalBackend/providers.ts",
					lines: "251-292"
				}),
				"), which ",
				createVNode(_components.strong, { children: ["injects ", createVNode(_components.code, { children: "githubPrProvider" })] }),
				" into ",
				createVNode(_components.code, { children: "subscribePr" }),
				" and feeds it ",
				createVNode(_components.code, { children: "{repoRoot, branch}" }),
				" off the git channel. No registry, no detection — there is one forge, so there is nothing to dispatch. ",
				createVNode(_components.code, { children: "onEvent" }),
				" stays synchronous."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Re-point imports: the neutral helpers (",
				createVNode(_components.code, { children: "prValue" }),
				", ",
				createVNode(_components.code, { children: "prLabel" }),
				", ",
				createVNode(_components.code, { children: "PrInfo" }),
				", …) → ",
				createVNode(_components.code, { children: "anyforge/schemas" }),
				"; the closed-union helpers (",
				createVNode(_components.code, { children: "PrUnavailableSource" }),
				", ",
				createVNode(_components.code, { children: "reasonForSource" }),
				", ",
				createVNode(_components.code, { children: "prUnavailableReason/Source" }),
				") → ",
				createVNode(_components.code, { children: "kolu-common/surface" }),
				"; the gh codes (",
				createVNode(_components.code, { children: "GhUnavailableCode" }),
				") → ",
				createVNode(_components.code, { children: "kolu-github/schemas" }),
				". README package table gains the anyforge row."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Explicitly ",
					createVNode(_components.em, { children: "not" }),
					" in 0b"
				] }),
				": ",
				createVNode(_components.code, { children: "GitInfo.remoteUrl" }),
				", ",
				createVNode(_components.code, { children: "detectForge" }),
				", the provider registry — those land in 0c. 0b’s kernel ships GitHub-only with zero forge knowledge and an injected single provider."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Verify:" }),
			" every existing unit + e2e test green; no new env vars. One behavior change, surfaced by the review gauntlet and worth a changelog line: the stale-resolve guard (a latent bug carried by the old ",
			createVNode(_components.code, { children: "subscribeGitHubPr" }),
			" — switching branches mid-lookup could briefly show the old branch’s PR — is now fixed in the moved loop)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "0c--pre-stage-the-forge-seams-github-only-shipped-",
			children: [
				"0c — pre-stage the forge seams (GitHub-only) ",
				createVNode($$Pill, {
					variant: "done",
					children: "shipped"
				}),
				" ",
				createVNode($$PrLink, { pr: 1283 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Everything a second forge crosses ",
			createVNode(_components.em, { children: "outside its own package" }),
			", landed now so phase 1 adds and never edits. All GitHub-only, zero behavior change — every host still resolves through ",
			createVNode(_components.code, { children: "gh" }),
			"."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "kolu-git" }), " learns the remote."] }),
				" ",
				createVNode(_components.code, { children: "GitInfo.remoteUrl" }),
				" (best-effort ",
				createVNode(_components.code, { children: "git remote get-url origin" }),
				" → ",
				createVNode(_components.code, { children: "null" }),
				", ",
				createVNode(_components.strong, { children: "credentials stripped" }),
				" via ",
				createVNode(_components.code, { children: "stripRemoteCredentials" }),
				" before it’s persisted or published), ",
				createVNode(_components.code, { children: "gitInfoEqual" }),
				" extended so a ",
				createVNode(_components.code, { children: "git remote set-url" }),
				" re-triggers downstream, and a refcounted shared ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: ".git/config" }), " watcher"] }),
				" (",
				createVNode(_components.code, { children: "watchGitConfig" }),
				" over the ",
				createVNode(_components.em, { children: "common" }),
				" git dir, mirroring ",
				createVNode(_components.code, { children: "watchGitHead" }),
				") wired into ",
				createVNode(_components.code, { children: "subscribeGitInfo" }),
				"’s in-repo mode so a remote change re-resolves without a branch switch. The gh adapter reads none of it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The server gains the dispatch seam." }),
				" ",
				createVNode(_components.code, { children: "PrGitContext.remoteUrl" }),
				"; a ",
				createVNode(_components.code, { children: "ForgeKind" }),
				"→",
				createVNode(_components.code, { children: "PrProvider" }),
				" ",
				createVNode(_components.code, { children: "PR_REGISTRY" }),
				" (one entry: ",
				createVNode(_components.code, { children: "github" }),
				"); a sync/pure ",
				createVNode(_components.code, { children: "detectForge(remoteUrl)" }),
				" that switches on ",
				createVNode(_components.code, { children: "parseRemoteHost(remoteUrl)" }),
				" (every host → ",
				createVNode(_components.code, { children: "github" }),
				" today); and a ",
				createVNode(_components.strong, { children: ["dispatching ", createVNode(_components.code, { children: "PrProvider" })] }),
				" whose ",
				createVNode(_components.code, { children: "resolve" }),
				" consults the registry per call — handed to the otherwise-unchanged ",
				createVNode(_components.code, { children: "subscribePr" }),
				". ",
				createVNode(_components.code, { children: "ForgeKind" }),
				" lives here in the app, not the leaf (the ",
				createVNode(_components.code, { children: "AgentKindSchema" }),
				" precedent)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The leaf gains the neutral grammar + the helpers the gh adapter was hoarding." }),
				" ",
				createVNode(_components.code, { children: "parseRemoteHost" }),
				" (URL- and scp-shaped remotes → host) joins ",
				createVNode(_components.code, { children: "anyforge" }),
				". And the two genuinely forge-neutral pieces 0b left inside ",
				createVNode(_components.code, { children: "kolu-github" }),
				" move out: the check-status ",
				createVNode(_components.strong, { children: "fold" }),
				" (",
				createVNode(_components.code, { children: "foldCheckOutcomes" }),
				" — the ",
				createVNode(_components.code, { children: "fail" }),
				"-terminal/",
				createVNode(_components.code, { children: "pending" }),
				"-sticky rule, distinct from gh’s ",
				createVNode(_components.code, { children: "classifyCheck" }),
				" string-mapping, which stays) and the resolve-failure ",
				createVNode(_components.strong, { children: "log policy" }),
				" (",
				createVNode(_components.code, { children: "logPrResolveFailure(err, result, log, label)" }),
				"). ",
				createVNode(_components.code, { children: "kolu-github" }),
				" now adopts both — so it no longer owns anything a sibling forge would have to import ",
				createVNode(_components.em, { children: "from the GitHub adapter" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Verify:" }),
			" every existing unit + e2e test green; ",
			createVNode(_components.code, { children: "parseRemoteHost" }),
			", ",
			createVNode(_components.code, { children: "foldCheckOutcomes" }),
			", and the ",
			createVNode(_components.code, { children: "remoteUrl" }),
			" equality case get direct unit tests; no new env vars; the gh PR pill is byte-identical (",
			createVNode(_components.code, { children: "detectForge" }),
			" always picks ",
			createVNode(_components.code, { children: "github" }),
			")."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "1--the-forgejo-adapter-closes-1240",
			children: ["1 — the Forgejo adapter ", createVNode($$Pill, {
				variant: "todo",
				children: "closes #1240"
			})]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Detection/registry/",
					createVNode(_components.code, { children: "remoteUrl" }),
					" already exist (0c)"
				] }),
				" — so phase 1 ",
				createVNode(_components.em, { children: "adds" }),
				", it doesn’t restitch: a single ",
				createVNode(_components.code, { children: "PR_REGISTRY" }),
				" entry (",
				createVNode(_components.code, { children: "forgejo: forgejoPrProvider" }),
				") and one ",
				createVNode(_components.code, { children: "case" }),
				" arm in ",
				createVNode(_components.code, { children: "detectForge" }),
				" (",
				createVNode(_components.code, { children: "codeberg.org" }),
				" + ",
				createVNode(_components.code, { children: "$KOLU_FORGEJO_HOSTS" }),
				" → ",
				createVNode(_components.code, { children: "forgejo" }),
				"). ",
				createVNode(_components.code, { children: "kolu-github" }),
				" and ",
				createVNode(_components.code, { children: "kolu-git" }),
				" are untouched; the watcher and ",
				createVNode(_components.code, { children: "subscribePr" }),
				" never change."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "packages/integrations/forgejo/" }),
				" depending on ",
				createVNode(_components.code, { children: "anyforge" }),
				" + ",
				createVNode(_components.code, { children: "kolu-shared" }),
				" only — ",
				createVNode(_components.code, { children: "kolu-github" }),
				" appears nowhere in its tree."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Resolver over the Forgejo REST API (keep the draft’s endpoints: ",
				createVNode(_components.code, { children: "/repos/{owner}/{repo}/pulls" }),
				" + ",
				createVNode(_components.code, { children: "/commits/{sha}/status" }),
				"), fixed: zod-parse responses; a typed fetch error carrying ",
				createVNode(_components.code, { children: "status: number" }),
				" (classify by field, not substring); match head ",
				createVNode(_components.strong, { children: "repo" }),
				" + ref so fork branches with the same name don’t false-positive; query so merged/closed states are reachable; honor port/scheme from the remote where derivable."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "ForgejoUnavailableSchema" }),
				" lives ",
				createVNode(_components.strong, { children: ["in ", createVNode(_components.code, { children: "kolu-forgejo" })] }),
				" (its own browser-safe ",
				createVNode(_components.code, { children: "schemas" }),
				" arm, like ",
				createVNode(_components.code, { children: "kolu-github" }),
				"’s) and its arm joins the closed ",
				createVNode(_components.code, { children: "PrUnavailableSource" }),
				" union ",
				createVNode(_components.strong, { children: ["in ", createVNode(_components.code, { children: "kolu-common" })] }),
				" (per D1). The compiler then walks the plan to the client: ",
				createVNode(_components.code, { children: "reasonForSource" }),
				" and ",
				createVNode(_components.code, { children: "ProviderUnavailableContent" }),
				" each need their forgejo arm (keep the draft’s per-code popover copy: token setup, timeout, not-found)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Tokens: ",
				createVNode(_components.code, { children: "KOLU_FORGEJO_TOKEN" }),
				", injected as a parameter (not read from ",
				createVNode(_components.code, { children: "process.env" }),
				" inside the resolver), sent ",
				createVNode(_components.strong, { children: "only" }),
				" to explicitly configured hosts — safe precisely because detection has no auto-probe."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Detection: ",
				createVNode(_components.code, { children: "codeberg.org" }),
				" built in; self-hosted via ",
				createVNode(_components.code, { children: "KOLU_FORGEJO_HOSTS" }),
				" (comma-separated), documented in the README the same change."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Unit tests for remote parsing, state/check mapping, and error classification; changelog entry (keep the draft’s); ",
				createVNode(_components.strong, { children: "evidence" }),
				": PR pill screenshot against a real Codeberg repo."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Verify:" }), " e2e on a Codeberg public repo (no token) and a token-bearing private instance; GitHub repos regression-checked; unknown forges still silent."] }),
		"\n",
		createVNode(_components.h2, {
			id: "decisions-and-open-questions",
			children: "Decisions and open questions"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "#" }),
					"\n",
					createVNode(_components.th, { children: "Decision" }),
					"\n",
					createVNode(_components.th, { children: "Rationale" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "D0" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "The kernel enumerates no forge." }),
						" ",
						createVNode(_components.code, { children: "PrProvider.kind: string" }),
						"; no ",
						createVNode(_components.code, { children: "ForgeKind" }),
						" union and no forge mapping in ",
						createVNode(_components.code, { children: "anyforge" }),
						" — only the neutral grammar (",
						createVNode(_components.code, { children: "parseRemoteHost" }),
						") and the fold/log helpers."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The ",
						createVNode(_components.code, { children: "anyagent" }),
						" precedent, exactly: ",
						createVNode(_components.code, { children: "AgentProvider.kind" }),
						" is ",
						createVNode(_components.code, { children: "string" }),
						" and the leaf never names claude/codex/opencode; the closed ",
						createVNode(_components.code, { children: "AgentKindSchema" }),
						" enum lives in the app (",
						createVNode(_components.code, { children: "kolu-common" }),
						"). ",
						createVNode(_components.code, { children: "ForgeKind" }),
						", ",
						createVNode(_components.code, { children: "detectForge" }),
						", and ",
						createVNode(_components.code, { children: "PR_REGISTRY" }),
						" live ",
						createVNode(_components.strong, { children: "server-side" }),
						" (only the server imports >1 adapter), landing in 0c. The leaf knows ",
						createVNode(_components.em, { children: "that" }),
						" forges vary (it parses a host, folds checks), never ",
						createVNode(_components.em, { children: "which" }),
						" ones."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "D1" }),
					"\n",
					createVNode(_components.td, { children: [
						"Closed ",
						createVNode(_components.code, { children: "PrUnavailableSource" }),
						" union composed in ",
						createVNode(_components.strong, { children: "kolu-common" }),
						" (gh arm owned by ",
						createVNode(_components.code, { children: "kolu-github" }),
						"), exhaustive match in UI"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A new forge ",
						createVNode(_components.em, { children: "should" }),
						" be a compile error at every recovery-UX render site. But that closed union names forges, so it composes in the app — ",
						createVNode(_components.code, { children: "discriminatedUnion(\"provider\", [GhUnavailableSchema, …])" }),
						" — exactly where ",
						createVNode(_components.code, { children: "AgentInfoSchema = discriminatedUnion(\"kind\", [ClaudeCodeInfoSchema, …])" }),
						" lives, with each arm owned by its adapter package. The leaf carries only the ",
						createVNode(_components.em, { children: "generic" }),
						" ",
						createVNode(_components.code, { children: "PrResult<S>" }),
						" over ",
						createVNode(_components.code, { children: "{ provider: string; code: string }" }),
						"; the adapter produces ",
						createVNode(_components.code, { children: "PrResult<GhUnavailableSource>" }),
						" (a member of the closed union, assignable covariantly, no cast). (Corrects an earlier cut that put the closed union and the ",
						createVNode(_components.code, { children: "Gh*" }),
						" codes in the leaf.)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "D2" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "(revised by 0d)" }),
						" Only ",
						createVNode(_components.code, { children: "github.com" }),
						" → ",
						createVNode(_components.code, { children: "github" }),
						"; every other remote → ",
						createVNode(_components.code, { children: "unsupported" }),
						", no probe"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"0c’s original cut routed ",
						createVNode(_components.em, { children: "every" }),
						" host → ",
						createVNode(_components.code, { children: "github" }),
						", leaning on ",
						createVNode(_components.code, { children: "gh" }),
						" as the fallback prober (GHE included) and on its brittle, unversioned refusal stderr to walk non-GitHub hosts back to silent. 0d inverts the default: we refuse to claim an arbitrary clone URL is GitHub, so non-GitHub remotes never reach ",
						createVNode(_components.code, { children: "gh" }),
						" — killing the ",
						createVNode($$Issue, { n: 1627 }),
						" error-log noise and “gh: unknown error” popover at the source. Still sync + pure: no async-detection race, no egress. Accepted cost: a GitHub Enterprise remote loses its PR pill until per-host config / a real adapter lands (#1240)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "D3" }),
					"\n",
					createVNode(_components.td, { children: [
						"Provider = pure ",
						createVNode(_components.code, { children: "resolve(git)" }),
						"; injected, not constructed; ",
						createVNode(_components.strong, { children: "dispatch is itself a provider" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"0b injects one provider into ",
						createVNode(_components.code, { children: "subscribePr" }),
						" (mirrors ",
						createVNode(_components.code, { children: "startAgentProvider" }),
						"). 0c keeps that contract intact by making the ",
						createVNode(_components.em, { children: "dispatcher" }),
						" a ",
						createVNode(_components.code, { children: "PrProvider" }),
						" whose ",
						createVNode(_components.code, { children: "resolve" }),
						" consults ",
						createVNode(_components.code, { children: "PR_REGISTRY[detectForge(git.remoteUrl)]" }),
						" — so per-resolve forge selection needs no change to the watcher: no teardown/rebuild, no ",
						createVNode(_components.code, { children: "lastKey" }),
						", channel handler stays sync. If a forge ever needs push/webhooks, widen the contract then — not before."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "D4" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "fj" }), " CLI not used"] }),
					"\n",
					createVNode(_components.td, { children: [
						"The issue thread already found it rough; Forgejo’s REST API is one authenticated ",
						createVNode(_components.code, { children: "fetch" }),
						" and needs no binary on ",
						createVNode(_components.code, { children: "$PATH" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Open: per-host tokens (",
			createVNode(_components.code, { children: "KOLU_FORGEJO_TOKEN" }),
			" is one secret for all configured hosts — fine while hosts are explicit, revisit if auto-detection ever lands); whether ",
			createVNode(_components.code, { children: "KOLU_FORGEJO_HOSTS" }),
			" should graduate from env var to a settings-UI surface; GitLab (different API shape, separate adapter — the union and registry are ready for it)."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Multi-forge PR integration — the anyforge leaf",
	"description": "Phased plan for kolu#1240 — phase 0a ships the gh log-noise fix, phase 0b extracts the forge-neutral PR kernel (schemas · poll loop · PrProvider) into a new anyforge leaf, phase 0c pre-stages every cross-package seam a second forge crosses (remoteUrl · the server registry + detection · the lifted neutral helpers) GitHub-only and zero-behavior, so phase 1 — the Forgejo/Codeberg adapter — is a purely additive sibling package. Grounded in a structural critique of the ic4-y/kolu#1 draft.",
	"parents": ["feature"],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-06-30T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "phases-at-a-glance",
			"text": "Phases at a glance"
		},
		{
			"depth": 2,
			"slug": "what-the-draft-teaches",
			"text": "What the draft teaches"
		},
		{
			"depth": 2,
			"slug": "the-anyforge-leaf",
			"text": "The anyforge leaf"
		},
		{
			"depth": 2,
			"slug": "the-phases-in-detail",
			"text": "The phases in detail"
		},
		{
			"depth": 3,
			"slug": "0a--stop-the-lying-warn-shipped-",
			"text": "0a — stop the lying WARN shipped "
		},
		{
			"depth": 3,
			"slug": "0b--extract-anyforge-shipped-",
			"text": "0b — extract anyforge shipped "
		},
		{
			"depth": 3,
			"slug": "0c--pre-stage-the-forge-seams-github-only-shipped-",
			"text": "0c — pre-stage the forge seams (GitHub-only) shipped "
		},
		{
			"depth": 3,
			"slug": "1--the-forgejo-adapter-closes-1240",
			"text": "1 — the Forgejo adapter closes #1240"
		},
		{
			"depth": 2,
			"slug": "decisions-and-open-questions",
			"text": "Decisions and open questions"
		}
	];
}
var url = "src/content/atlas/anyforge.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/anyforge.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/anyforge.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
