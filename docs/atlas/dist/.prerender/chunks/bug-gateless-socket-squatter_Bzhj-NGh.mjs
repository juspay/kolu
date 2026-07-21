import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/squatter-recovery-flow.svg?raw
var squatter_recovery_flow_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 940 560\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"13\">\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#64748b\"/>\n    </marker>\n    <style>\n      .box  { fill:#f8fafc; stroke:#94a3b8; stroke-width:1.5; rx:8; }\n      .dec  { fill:#eff6ff; stroke:#3b82f6; stroke-width:1.5; }\n      .new  { fill:#ecfdf5; stroke:#10b981; stroke-width:2; }\n      .kill { fill:#fef2f2; stroke:#ef4444; stroke-width:2; }\n      .lbl  { fill:#0f172a; }\n      .mut  { fill:#475569; font-size:11px; }\n      .edge { stroke:#64748b; stroke-width:1.4; fill:none; marker-end:url(#arr); }\n      .elabel { fill:#334155; font-size:11px; }\n      @media (prefers-color-scheme: dark) {\n        .box { fill:#1e293b; stroke:#64748b; } .dec { fill:#1e293b; stroke:#60a5fa; }\n        .new { fill:#064e3b; stroke:#34d399; } .kill { fill:#4c1d1d; stroke:#f87171; }\n        .lbl { fill:#e2e8f0; } .mut { fill:#94a3b8; } .elabel { fill:#cbd5e1; }\n        svg { background:transparent; }\n      }\n    </style>\n  </defs>\n\n  <!-- entry -->\n  <rect class=\"box\" x=\"360\" y=\"14\" width=\"220\" height=\"40\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"33\" text-anchor=\"middle\">boot policy: ensure() /</text>\n  <text class=\"lbl\" x=\"470\" y=\"48\" text-anchor=\"middle\">adoptSurvivor()</text>\n\n  <!-- gate holder? -->\n  <rect class=\"dec\" x=\"345\" y=\"90\" width=\"250\" height=\"46\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"110\" text-anchor=\"middle\">liveServingHolder(gate):</text>\n  <text class=\"lbl\" x=\"470\" y=\"126\" text-anchor=\"middle\">gate names a live serving pid?</text>\n  <line class=\"edge\" x1=\"470\" y1=\"54\" x2=\"470\" y2=\"90\"/>\n\n  <!-- yes: recycle by gate (unchanged) -->\n  <rect class=\"box\" x=\"705\" y=\"93\" width=\"210\" height=\"40\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"810\" y=\"112\" text-anchor=\"middle\">recycle the gate holder</text>\n  <text class=\"mut\" x=\"810\" y=\"127\" text-anchor=\"middle\">killLiveHolder → spawn (today)</text>\n  <line class=\"edge\" x1=\"595\" y1=\"113\" x2=\"705\" y2=\"113\"/>\n  <text class=\"elabel\" x=\"648\" y=\"106\" text-anchor=\"middle\">yes</text>\n\n  <!-- socket accepting? (NEW) -->\n  <rect class=\"dec\" x=\"345\" y=\"170\" width=\"250\" height=\"46\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"190\" text-anchor=\"middle\">socket ACCEPTING anyway?</text>\n  <text class=\"mut\" x=\"470\" y=\"206\" text-anchor=\"middle\">gate-less squatter check (NEW)</text>\n  <line class=\"edge\" x1=\"470\" y1=\"136\" x2=\"470\" y2=\"170\"/>\n  <text class=\"elabel\" x=\"440\" y=\"156\" text-anchor=\"middle\">no gate holder</text>\n\n  <!-- no: spawn fresh (unchanged) -->\n  <rect class=\"box\" x=\"705\" y=\"173\" width=\"210\" height=\"40\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"810\" y=\"192\" text-anchor=\"middle\">spawn fresh daemon</text>\n  <text class=\"mut\" x=\"810\" y=\"207\" text-anchor=\"middle\">no squatter — today's path</text>\n  <line class=\"edge\" x1=\"595\" y1=\"193\" x2=\"705\" y2=\"193\"/>\n  <text class=\"elabel\" x=\"650\" y=\"186\" text-anchor=\"middle\">dead / absent</text>\n\n  <!-- OS lookup + handshake (NEW) -->\n  <rect class=\"new\" x=\"325\" y=\"250\" width=\"290\" height=\"58\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"271\" text-anchor=\"middle\" font-weight=\"600\">IDENTIFY: socketHolderPid(path)</text>\n  <text class=\"lbl\" x=\"470\" y=\"288\" text-anchor=\"middle\" font-weight=\"600\">VERIFY: kaval handshake on the socket</text>\n  <text class=\"mut\" x=\"470\" y=\"303\" text-anchor=\"middle\">OS: /proc/net/unix · lsof  +  system.version</text>\n  <line class=\"edge\" x1=\"470\" y1=\"216\" x2=\"470\" y2=\"250\"/>\n  <text class=\"elabel\" x=\"500\" y=\"238\" text-anchor=\"middle\">yes — held</text>\n\n  <!-- foreign branch -->\n  <rect class=\"kill\" x=\"655\" y=\"252\" width=\"260\" height=\"54\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"785\" y=\"273\" text-anchor=\"middle\" font-weight=\"600\">FOREIGN → fail LOUD</text>\n  <text class=\"mut\" x=\"785\" y=\"289\" text-anchor=\"middle\">socket does not speak kaval:</text>\n  <text class=\"mut\" x=\"785\" y=\"302\" text-anchor=\"middle\">typed error names pid+command · NEVER kill</text>\n  <line class=\"edge\" x1=\"615\" y1=\"279\" x2=\"655\" y2=\"279\"/>\n  <text class=\"elabel\" x=\"635\" y=\"272\" text-anchor=\"middle\">no</text>\n\n  <!-- dual-attest identity gate -->\n  <rect class=\"new\" x=\"325\" y=\"342\" width=\"290\" height=\"58\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"363\" text-anchor=\"middle\" font-weight=\"600\">DUAL-ATTEST identity</text>\n  <text class=\"mut\" x=\"470\" y=\"379\" text-anchor=\"middle\">handshake self-reported pid == OS holder pid</text>\n  <text class=\"mut\" x=\"470\" y=\"393\" text-anchor=\"middle\">re-verify holder UNCHANGED right before kill</text>\n  <line class=\"edge\" x1=\"470\" y1=\"308\" x2=\"470\" y2=\"342\"/>\n  <text class=\"elabel\" x=\"530\" y=\"330\" text-anchor=\"middle\">speaks kaval (any version)</text>\n\n  <!-- recycle verified orphan -->\n  <rect class=\"kill\" x=\"330\" y=\"434\" width=\"280\" height=\"46\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"454\" text-anchor=\"middle\" font-weight=\"600\">RECYCLE the verified orphan</text>\n  <text class=\"mut\" x=\"470\" y=\"470\" text-anchor=\"middle\">SIGTERM · waitForPidGone (reused)</text>\n  <line class=\"edge\" x1=\"470\" y1=\"400\" x2=\"470\" y2=\"434\"/>\n\n  <!-- spawn fresh at primary -->\n  <rect class=\"new\" x=\"330\" y=\"510\" width=\"280\" height=\"40\" rx=\"8\"/>\n  <text class=\"lbl\" x=\"470\" y=\"529\" text-anchor=\"middle\" font-weight=\"600\">bind FRESH — durable</text>\n  <text class=\"mut\" x=\"470\" y=\"544\" text-anchor=\"middle\">holder gone → no later close() can unlink (F1)</text>\n  <line class=\"edge\" x1=\"470\" y1=\"480\" x2=\"470\" y2=\"510\"/>\n\n  <!-- identity mismatch escape from dual-attest -->\n  <line class=\"edge\" x1=\"615\" y1=\"371\" x2=\"700\" y2=\"371\" stroke-dasharray=\"4 3\"/>\n  <text class=\"elabel\" x=\"800\" y=\"360\" text-anchor=\"middle\">mismatch / holder moved →</text>\n  <text class=\"elabel\" x=\"800\" y=\"375\" text-anchor=\"middle\">abort kill, fail loud</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/bug-gateless-socket-squatter.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
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
		createVNode($$PrLink, { pr: 1887 }),
		"\n",
		createVNode(_components.p, { children: [
			"srid’s ruling, verbatim: ",
			createVNode(_components.em, { children: "“I want the bug to be fixed. WHY is a stray process\nbreaking kolu?”" }),
			" The field incident was closed by hand-killing pid 25494 on\n",
			createVNode(_components.code, { children: "sincereintent" }),
			" after it had wedged the box for ",
			createVNode(_components.strong, { children: "8 days" }),
			" — but a hand-reap is\ncheating. The product must converge on its own. This note is the plan of record\nfor making it do so."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-wedge",
			children: "The wedge"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The single-instance gate (",
			createVNode(_components.code, { children: "kaval.pid" }),
			") and the rendezvous socket\n(",
			createVNode(_components.code, { children: "pty-host.sock" }),
			") are two separate files. Normally they move together: the daemon\nholding the socket is the one the gate names. The bug is the state where they\n",
			createVNode(_components.strong, { children: "come apart" }),
			" — the gate file is gone (or names a different / dead pid) but a\nlive orphan kaval ",
			createVNode(_components.strong, { children: "still holds the socket" }),
			". That state is representable, it\nhappens in the field, and ",
			createVNode(_components.strong, { children: "no supervisor arm handles it." })
		] }),
		"\n",
		createVNode(_components.p, { children: "Trace it against the code at HEAD:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"A fresh kolu-server boots and runs its convergence probe. The orphan’s socket\nis accepting, so the probe reads its ",
				createVNode(_components.code, { children: "system.version" }),
				", sees an ",
				createVNode(_components.strong, { children: "older" }),
				"\npty-host contract, and ",
				createVNode(_components.code, { children: "decide" }),
				" returns ",
				createVNode(_components.code, { children: "recycle" }),
				" — routing the boot to the\nendpoint’s ",
				createVNode(_components.code, { children: "adoptOrEnsure" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "adoptOrEnsure" }),
				" → ",
				createVNode(_components.code, { children: "adoptSurvivor" }),
				" calls ",
				createVNode(_components.code, { children: "liveServingHolder" }),
				", which is\n",
				createVNode(_components.strong, { children: "gate-pid-only" }),
				": it reads ",
				createVNode(_components.code, { children: "gatePid(gatePath)" }),
				", finds the gate absent, and\nreturns ",
				createVNode(_components.code, { children: "undefined" }),
				". The recycle arm (",
				createVNode(_components.code, { children: "killLiveHolder" }),
				") only ever fires against\na ",
				createVNode(_components.strong, { children: "gate-recorded" }),
				" pid, so it never targets the orphan."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"With no gate holder, the boot falls to ",
				createVNode(_components.code, { children: "spawnConnectHold" }),
				". It spawns a fresh\nkaval — which acquires the now-absent gate, then tries to bind the socket, is\nrefused ",
				createVNode(_components.code, { children: "already-served" }),
				" by the live orphan, releases the gate and ",
				createVNode(_components.strong, { children: "exits" }),
				".\nThe gate is empty again."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "spawnConnectHold" }),
				" meanwhile sees the socket accepting (the orphan), dials it,\nhandshakes the ",
				createVNode(_components.strong, { children: "orphan" }),
				", gets the contract skew, and reports ",
				createVNode(_components.code, { children: "incompatible" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The client shows the incompatible card. “Update & restart” re-runs the same\nboot. ",
				createVNode(_components.code, { children: "liveServingHolder" }),
				" reads the empty gate, returns ",
				createVNode(_components.code, { children: "undefined" }),
				", and the\nloop repeats — ",
				createVNode(_components.strong, { children: "forever" }),
				". The socket is also non-durable (F1): if the orphan\never does ",
				createVNode(_components.code, { children: "close()" }),
				", it unlinks whatever socket path a successor managed to\nbind.",
				createVNode($$Footnote, { children: [
					"F1 is the file-ops half of the same wound — a successor that\nbriefly binds by clearing a stale-looking inode can later have its socket path\nunlinked by the original squatter’s clean ",
					createVNode(_components.code, { children: "close()" }),
					". The fix dissolves F1 by\n",
					createVNode(_components.em, { children: "removal" }),
					": the orphan is gone before the successor binds, so there is no later\n",
					createVNode(_components.code, { children: "close()" }),
					" to unlink anything."
				] })
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			children: createVNode(_components.p, { children: [
				"The safety mechanism that protects everyone else is exactly what wedges here.\n",
				createVNode(_components.code, { children: "liveServingHolder" }),
				" refuses to kill a live pid it can’t prove is the daemon\n(a stale gate over an OS-reused pid must not cost a stranger its life). Being\ngate-only, it has no way to prove the ",
				createVNode(_components.em, { children: "socket’s" }),
				" holder — so it correctly\nrefuses, and correctly never recovers. The gap is not a bug in that check; it is\na ",
				createVNode(_components.strong, { children: "missing identity source" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-fix--the-supervisor-owns-its-own-socket-namespace",
			children: "The fix — the supervisor owns its own socket namespace"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Supervision of one’s own verified daemons is the supervisor’s job. When the gate\ngap opens but the socket is still held, the supervisor should ",
			createVNode(_components.strong, { children: "identify the\nholder itself" }),
			" and recycle it — using identity, not bookkeeping, as the safety\nline."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: squatter_recovery_flow_default,
			wide: true,
			caption: "The recovery arm (green/red) grafts onto the existing boot policy. It fires ONLY when the gate names no live serving holder yet the socket is still accepting — the exact gate-less-squatter state. Every other path is unchanged."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The arm fires ",
			createVNode(_components.strong, { children: "only" }),
			" in the gate-less-squatter state and does three things:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "IDENTIFY" }),
				" — ask the OS which pid listens on ",
				createVNode(_components.em, { children: "this exact socket path" }),
				". A\ndependency-free platform leaf: on Linux, the bound listener is the one row in\n",
				createVNode(_components.code, { children: "/proc/net/unix" }),
				" carrying the path (state ",
				createVNode(_components.code, { children: "01" }),
				", the ",
				createVNode(_components.code, { children: "SO_ACCEPTCON" }),
				" flag), and its\ninode maps to a pid via ",
				createVNode(_components.code, { children: "/proc/<pid>/fd/* → socket:[inode]" }),
				"; on darwin, ",
				createVNode(_components.code, { children: "lsof" }),
				"\nagainst the path.",
				createVNode($$Footnote, { children: [
					"The field case ran on ",
					createVNode(_components.code, { children: "sincereintent" }),
					" (darwin), so the\n",
					createVNode(_components.code, { children: "lsof" }),
					" path is production-load-bearing, not a nicety — it is verified on a real mac\nin acceptance, not assumed. The Linux ",
					createVNode(_components.code, { children: "/proc" }),
					" parse is already grounded empirically\n(exact column layout + inode→pid mapping)."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "VERIFY IDENTITY by handshake" }),
				" — dial the socket and run the existing kaval\nversion exchange (the very handshake that already detects skew), then act on\nwhat it proves:",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "skewed" }),
						" daemon → the wedge (the 25494 case): a daemon of this estate we\ncannot serve through. Its disposition is the ONE thing that follows the boot\npolicy — the SAME recycle-vs-refuse split the endpoint already makes for a\n",
						createVNode(_components.em, { children: "gate-recorded" }),
						" skew:",
						"\n",
						createVNode(_components.ul, { children: [
							"\n",
							createVNode(_components.li, { children: [
								"under the ",
								createVNode(_components.strong, { children: "kaval / always-recycle" }),
								" policy → ",
								createVNode(_components.strong, { children: "RECYCLE it" }),
								" — SIGTERM the\nidentified pid, ",
								createVNode(_components.code, { children: "waitForPidGone" }),
								", then bind fresh (the wait/ceiling machinery\nis ",
								createVNode(_components.code, { children: "killLiveHolder" }),
								"’s, reused verbatim; the ",
								createVNode(_components.em, { children: "only" }),
								" new thing is the identity\nsource)."
							] }),
							"\n",
							createVNode(_components.li, { children: [
								"under the ",
								createVNode(_components.strong, { children: "padi binder / refuse" }),
								" policy (",
								createVNode(_components.code, { children: "adoptOrSpawnOrRefuse" }),
								") → ",
								createVNode(_components.strong, { children: [
									"leave\nit standing and report ",
									createVNode(_components.code, { children: "incompatible" }),
									", never SIGTERM it"
								] }),
								" — a client must not\nkill a running padi even a skewed gate-less one (",
								createVNode(_components.a, {
									href: "https://github.com/juspay/kolu/pull/1313",
									children: "#1313"
								}),
								").",
								createVNode($$Footnote, { children: [
									"Caught\nby the architecture-first-principles gate (C4 depends-on): the first cut\nhardcoded skew→kill in the shared recovery, so a gate-less skewed ",
									createVNode(_components.em, { children: "padi" }),
									" would\nhave been SIGTERM’d under the very policy whose contract is “never kill a\nrunning padi”. The skew disposition now threads the caller’s policy, exactly\nas the gate-recorded path already did."
								] })
							] }),
							"\n"
						] }),
						"\n"
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "compatible" }),
						" kaval → ",
						createVNode(_components.strong, { children: "left for the ordinary connect to adopt" }),
						", exactly as\ntoday — its live PTYs are preserved, not killed. A compatible gate-less holder\nnever wedged; recycling it would be a PTY-loss regression, so recovery is a\nno-op there.",
						createVNode($$Footnote, { children: [
							"This is a build-time refinement of the approved design’s\nliteral “recycle any verified orphan”: grounding showed that today a\n",
							createVNode(_components.em, { children: "compatible" }),
							" gate-less holder is already connected-to (adopted) by the spawn\npath, so only the ",
							createVNode(_components.em, { children: "skewed" }),
							" holder ever wedged. Recycling a compatible orphan\nwould kill PTYs that survive today — a regression the skew-only recycle avoids.\nThe identity/safety model is unchanged; only the compatible-holder disposition\nis adopt-not-recycle."
						] })
					] }),
					"\n",
					createVNode(_components.li, { children: [
						"does ",
						createVNode(_components.strong, { children: "not" }),
						" speak kaval → a genuinely foreign process (or a non-conforming\nspeaker), and we ",
						createVNode(_components.strong, { children: "fail loud" }),
						" (a typed ",
						createVNode(_components.code, { children: "SocketSquatterForeignError" }),
						" naming its\npid + command) and ",
						createVNode(_components.strong, { children: "never touch it" }),
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
			"We also never recover a socket held by ",
			createVNode(_components.strong, { children: "our own process" }),
			": the supervisor spawns\nits daemon as a separate process, so a holder equal to ",
			createVNode(_components.code, { children: "process.pid" }),
			" is never a\nreal squatter — filtering it out is both correct and a self-kill guard."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This makes the existing ",
			createVNode(_components.code, { children: "incompatible → renewDaemon" }),
			" flow ",
			createVNode(_components.strong, { children: "self-heal" }),
			": a fresh\npadi boots → socket held gate-less → handshake → old kaval → recycle → bind the\nnew contract → converge. It is srid’s “stop the old kaval, start the new kaval”,\nextended from gate-recorded daemons to verified orphans."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-identity-model-the-load-bearing-decision",
			children: "The identity model (the load-bearing decision)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The orchestration teardown law — ",
			createVNode(_components.em, { children: "agents kill only the pids they recorded" }),
			" — does\n",
			createVNode(_components.strong, { children: "not" }),
			" govern the product’s own supervisor. A supervisor recycling a daemon it has\njust proven, over the wire, to be its own kind is doing its job, not violating a\nbookkeeping rule. The safety line is ",
			createVNode(_components.strong, { children: "IDENTITY" }),
			", made of three independent\nattestations that must agree before any signal is sent:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Attestation" }),
					"\n",
					createVNode(_components.th, { children: "Source" }),
					"\n",
					createVNode(_components.th, { children: "Guarantees" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "The socket speaks kaval" }),
					"\n",
					createVNode(_components.td, { children: [
						"the version handshake succeeds (compatible ",
						createVNode(_components.strong, { children: "or" }),
						" skewed)"
					] }),
					"\n",
					createVNode(_components.td, { children: "it is our daemon, not a stranger" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"A specific pid holds ",
						createVNode(_components.em, { children: "this" }),
						" socket"
					] }),
					"\n",
					createVNode(_components.td, { children: "the OS socket-holder lookup" }),
					"\n",
					createVNode(_components.td, { children: "we know exactly whom to signal" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "That pid is the one that answered" }),
					"\n",
					createVNode(_components.td, { children: [
						"handshake ",
						createVNode(_components.strong, { children: "self-reports its pid" }),
						createVNode($$Footnote, { children: [
							"kaval’s ",
							createVNode(_components.code, { children: "system.version" }),
							" returns ",
							createVNode(_components.code, { children: "{ contractVersion, pid, startedAt, identity?, lifetime? }" }),
							" — the daemon’s own ",
							createVNode(_components.code, { children: "process.pid" }),
							". ",
							createVNode(_components.code, { children: "pid" }),
							" is a ",
							createVNode(_components.strong, { children: "required" }),
							" wire field, present since the first standalone kaval (",
							createVNode(_components.a, {
								href: "https://github.com/juspay/kolu/pull/1301",
								children: "#1301"
							}),
							") — so it holds for ",
							createVNode(_components.em, { children: "every" }),
							" real orphan, including a 25494-era 5.0-contract skew. The recycle target is thus a pid the daemon named ",
							createVNode(_components.em, { children: "over the very socket we are recycling" }),
							", cross-checked against the OS’s independent view. No new wire field is added (the field already exists); the added ",
							createVNode(_components.em, { children: "exported-type" }),
							" surface is an additive ",
							createVNode(_components.code, { children: "pid?" }),
							" on ",
							createVNode(_components.code, { children: "DaemonContractSkewError" }),
							" — see “Exported-API additions”."
						] })
					] }),
					"\n",
					createVNode(_components.td, { children: "the process answering IS the process holding the socket" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Only when all three agree — and are ",
			createVNode(_components.strong, { children: "re-confirmed unchanged immediately before the\nSIGTERM" }),
			" — is the orphan recycled. Any disagreement (foreign process, pid the OS\ndoesn’t corroborate, holder that moved between identify and kill) ",
			createVNode(_components.strong, { children: "aborts the kill\nand fails loud" }),
			". We never kill anything that didn’t handshake as kaval, and we\nnever touch another daemon’s socket namespace."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The pid-absent arm is FOREIGN, by construction — not a weaker fallback." }),
			" Because\n",
			createVNode(_components.code, { children: "pid" }),
			" is a required field of the ",
			createVNode(_components.code, { children: "system.version" }),
			" schema, a response that omits it\n(a hypothetical pre-",
			createVNode(_components.code, { children: "#1301" }),
			" daemon, or any non-conforming speaker that merely\naccepts the socket) ",
			createVNode(_components.strong, { children: "fails oRPC output validation" }),
			" — the read throws, which is\nexactly the “did not answer the handshake” path that classifies the holder as\n",
			createVNode(_components.strong, { children: "foreign" }),
			": a loud typed error naming pid + command, and ",
			createVNode(_components.strong, { children: "never a kill" }),
			". So the\nidentity model never ",
			createVNode(_components.em, { children: "degrades" }),
			" to a two-attestation kill when attestation 3 is\nmissing — a missing self-reported pid is itself the proof the holder is not a\nconforming kaval of this estate, and the fail-fast / no-fallbacks rule holds\n(a degrade-to-2 path would have been the very fallback this codebase forbids). This\nis stated and ",
			createVNode(_components.strong, { children: "pinned" }),
			", not left as emergent behaviour."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "where-it-lives-structure",
			children: "Where it lives (structure)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The recovery arm grafts onto the ",
			createVNode(_components.strong, { children: "endpoint spine" }),
			"\n(",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			"), beside the machinery it reuses — the endpoint\nalready owns ",
			createVNode(_components.code, { children: "killLiveHolder" }),
			", ",
			createVNode(_components.code, { children: "waitForPidGone" }),
			", ",
			createVNode(_components.code, { children: "spawnConnectHold" }),
			", and the\ngate read. It is a Node-only module (it already imports ",
			createVNode(_components.code, { children: "gatePid" }),
			" / ",
			createVNode(_components.code, { children: "isHolderLive" }),
			"\nand dials ",
			createVNode(_components.code, { children: "node:net" }),
			"), so a new sibling leaf is a clean fit:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "socketHolder.ts" }) }),
				" — a new leaf next to ",
				createVNode(_components.code, { children: "waitForPidGone.ts" }),
				": ",
				createVNode(_components.code, { children: "socketHolders(socketPath) → SocketHolder[]" }),
				" (each ",
				createVNode(_components.code, { children: "{ pid, command }" }),
				"), platform-dispatched (",
				createVNode(_components.code, { children: "/proc" }),
				" on linux, ",
				createVNode(_components.code, { children: "lsof" }),
				"\non darwin), fail-fast on an unsupported platform. It returns ",
				createVNode(_components.em, { children: "every" }),
				" pid the OS reports\nholding the path — a ",
				createVNode(_components.strong, { children: "list" }),
				", not a single pid: linux’s ",
				createVNode(_components.code, { children: "/proc/net/unix" }),
				" names the bound\nlistener exactly, but darwin’s ",
				createVNode(_components.code, { children: "lsof" }),
				" can report the listener ",
				createVNode(_components.em, { children: "plus" }),
				" connected clients, so\nthe caller’s handshake-reported pid selects the true listener from the set (the recovery\nkills only a pid the OS corroborates AND the daemon named over the socket). It hides a\n",
				createVNode(_components.em, { children: "bounded" }),
				" OS-lookup volatility — a ",
				createVNode(_components.strong, { children: "leaf" }),
				", not electricity (no transport / reconnect /\npersistence lifecycle of its own), so it belongs in the package that uses it, not a new\n",
				createVNode(_components.code, { children: "@kolu/*" }),
				" receptacle."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "the recovery arm" }),
				" — a private helper in ",
				createVNode(_components.code, { children: "endpoint.ts" }),
				", run by ",
				createVNode(_components.code, { children: "recoverOrSpawn" }),
				"\nat exactly the boot points where ",
				createVNode(_components.strong, { children: "no live gate holder was found yet the endpoint\nis about to spawn" }),
				": ",
				createVNode(_components.code, { children: "ensure" }),
				"’s else branch and ",
				createVNode(_components.code, { children: "adoptSurvivor" }),
				"’s no-survivor branch\n(hence, via ",
				createVNode(_components.code, { children: "converge" }),
				" and the renew flow, every wedge path). It is deliberately\n",
				createVNode(_components.strong, { children: "not" }),
				" on the ",
				createVNode(_components.code, { children: "recycle" }),
				" path — that has already reaped its holder and freed the\nsocket, so re-probing there would only re-handshake a daemon we just replaced (and,\nagainst an in-process test daemon, mis-fire).",
				createVNode($$Footnote, { children: [
					"The first cut placed the arm\nat the top of ",
					createVNode(_components.code, { children: "spawnConnectHold" }),
					" for “uniform coverage”, but ",
					createVNode(_components.code, { children: "recycle" }),
					" calls\n",
					createVNode(_components.code, { children: "spawnConnectHold" }),
					" too — so the arm ran an extra handshake on every recycle. Scoping\nit to the no-gate-holder branches covers the same wedge paths (a wedge is ",
					createVNode(_components.em, { children: "always" }),
					" a\nno-gate-holder boot) without touching the recycle path."
				] }),
				" “Speaks kaval?”\nreuses the existing ",
				createVNode(_components.code, { children: "connectSurvivor" }),
				" three-way verdict (",
				createVNode(_components.code, { children: "adopted" }),
				" / ",
				createVNode(_components.code, { children: "skew" }),
				" /\n",
				createVNode(_components.code, { children: "unreachable" }),
				"), so the handshake logic is not re-implemented."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "exported-api-additions-named-honestly-for-the-consumer-gates",
			children: "Exported-API additions (named honestly for the consumer gates)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The recycle only ever fires on a ",
			createVNode(_components.strong, { children: "skew" }),
			", and a skew ",
			createVNode(_components.em, { children: "throws" }),
			" ",
			createVNode(_components.code, { children: "DaemonContractSkewError" }),
			"\nbefore a ",
			createVNode(_components.code, { children: "DaemonConnection" }),
			" is ever built — so the pid the kill cross-checks rides on the\n",
			createVNode(_components.strong, { children: "error" }),
			", not the connection. The surface additions to ",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			"\nare therefore:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "pid?: number" }),
				" on ",
				createVNode(_components.code, { children: "DaemonContractSkewError" }),
				" — the skewed daemon’s self-reported pid, so\nthe gate-less-squatter recovery has its third identity attestation (",
				createVNode(_components.strong, { children: "additive, optional" }),
				");"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "SocketSquatterForeignError" }),
				" / ",
				createVNode(_components.code, { children: "isSocketSquatterForeignError" }),
				" and ",
				createVNode(_components.code, { children: "socketHolders" }),
				" /\n",
				createVNode(_components.code, { children: "SocketHolder" }),
				" — genuinely new exports."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.code, { children: "pid" }),
			" on the ",
			createVNode(_components.em, { children: "connection" }),
			" (",
			createVNode(_components.code, { children: "DaemonConnection" }),
			") was ",
			createVNode(_components.strong, { children: "not" }),
			" added: a compatible holder is\nadopted, never killed, so nothing would ever read it — a dead field is worse than none.",
			createVNode($$Footnote, { children: [
				"Caught\nby the architecture-first-principles gate (C2 consumer-ergonomics): the first cut added ",
				createVNode(_components.code, { children: "pid" }),
				"\nto ",
				createVNode(_components.code, { children: "DaemonConnection" }),
				" too, but the recovery reads the pid only off the ",
				createVNode(_components.em, { children: "skew error" }),
				" (the kill\npath), and the adopt path disposes the connection without touching it — a field with zero\nreaders and a doc comment that lied about who read it. Deleted."
			] }),
			" The ",
			createVNode(_components.code, { children: "DaemonContractSkewError.pid" }),
			"\nchange is ",
			createVNode(_components.strong, { children: "additive-optional" }),
			", so no existing consumer breaks — verified, not asserted: the\ndrishti and odu ",
			createVNode(_components.strong, { children: "consumer greps" }),
			" found neither repo depends on\n",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			", so the additive change has zero cross-repo impact.\n",
			createVNode(_components.code, { children: "ref-surface-supervisor.mdx" }),
			" is updated in the same PR. The one genuinely new ",
			createVNode(_components.em, { children: "capability" }),
			" is\nthe OS socket-holder lookup."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "design-philosophy",
			children: "Design philosophy"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fail fast — no fallbacks." }),
				" The foreign-holder arm and every identity\ndisagreement ",
				createVNode(_components.strong, { children: "crash loud" }),
				" (a typed error naming the pid + command); there is no\ndegrade-to-spawn-anyway path that could stomp a stranger. An unsupported platform\nthrows rather than silently skipping recovery."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Volatility boundary." }),
				" The OS socket-holder lookup is a bounded platform leaf,\nco-located with ",
				createVNode(_components.code, { children: "waitForPidGone" }),
				" (its twin — pid lifecycle via the OS). It is not\nextracted into a package: it hides an algorithm, not electricity."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reuse the source of truth." }),
				" The recycle wait/ceiling is ",
				createVNode(_components.code, { children: "killLiveHolder" }),
				"’s; the\n“speaks kaval?” verdict is ",
				createVNode(_components.code, { children: "connectSurvivor" }),
				"’s; the self-reported pid is the\nexisting ",
				createVNode(_components.code, { children: "system.version" }),
				" field. The one genuinely new capability is the OS lookup."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "acceptance--the-pins",
			children: "Acceptance — the pins"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each pin is ",
			createVNode(_components.strong, { children: "red on today’s code" }),
			" before the fix and green after."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Pin" }),
					"\n",
					createVNode(_components.th, { children: "Manufacture" }),
					"\n",
					createVNode(_components.th, { children: "Today" }),
					"\n",
					createVNode(_components.th, { children: "After" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "The squatter" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"spawn a real kaval, ",
						createVNode(_components.strong, { children: "delete its gate file" }),
						", boot/recycle"
					] }),
					"\n",
					createVNode(_components.td, { children: "wedged: fresh cannot bind; card loops" }),
					"\n",
					createVNode(_components.td, { children: [
						"holder identified → handshaked → recycled; fresh binds; ",
						createVNode(_components.strong, { children: "durable" }),
						" (old holder gone)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Foreign holder" }) }),
					"\n",
					createVNode(_components.td, { children: "a plain non-kaval net server bound at the path" }),
					"\n",
					createVNode(_components.td, { children: "(falls through / opaque)" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "not killed" }), "; loud typed error naming pid + command"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Pid-absent speaker" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"a socket that accepts but whose ",
						createVNode(_components.code, { children: "system.version" }),
						" omits ",
						createVNode(_components.code, { children: "pid" }),
						" (fails schema)"
					] }),
					"\n",
					createVNode(_components.td, { children: "(falls through / opaque)" }),
					"\n",
					createVNode(_components.td, { children: [
						"classified ",
						createVNode(_components.strong, { children: "foreign" }),
						" → ",
						createVNode(_components.strong, { children: "not killed" }),
						"; loud typed error"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Compatible holder" }) }),
					"\n",
					createVNode(_components.td, { children: "a gate-less holder that speaks a compatible contract" }),
					"\n",
					createVNode(_components.td, { children: "(connected/adopted)" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "adopted, not killed" }), " — PTYs preserved (no regression)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Gate-present unchanged" }) }),
					"\n",
					createVNode(_components.td, { children: "the existing killLiveHolder / adopt suites" }),
					"\n",
					createVNode(_components.td, { children: "green" }),
					"\n",
					createVNode(_components.td, { children: "green" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Version-agnostic" }) }),
					"\n",
					createVNode(_components.td, { children: "an OLD-contract kaval (handshake succeeds, version skews)" }),
					"\n",
					createVNode(_components.td, { children: "wedged (this IS 25494)" }),
					"\n",
					createVNode(_components.td, { children: "identified as kaval → recycled" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The end-to-end proof, on a pu box (or ",
			createVNode(_components.code, { children: "sincereintent" }),
			" if offered): manufacture the\ngate-less squatter, then drive the ",
			createVNode(_components.strong, { children: "real UI flow" }),
			" — the incompatible card’s\n“Update & restart” — and watch it converge ",
			createVNode(_components.strong, { children: "one click, no manual reaping" }),
			". The\npoint is not that a test passes; it is that ",
			createVNode(_components.strong, { children: "the product heals itself" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-adversaries-this-must-survive-for-the-lens-gate",
			children: "The adversaries this must survive (for the lens gate)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "pid-reuse between lookup and kill" }),
				" — the identified pid could exit and the OS\nreuse it before the SIGTERM. Mitigation: the kill target is the handshake’s\nself-reported pid, cross-checked against the OS holder, and ",
				createVNode(_components.strong, { children: "re-confirmed as the\ncurrent holder immediately before the signal" }),
				"; a moved holder aborts the kill. The\nfinal re-confirm→",
				createVNode(_components.code, { children: "SIGTERM" }),
				" window is ",
				createVNode(_components.strong, { children: "irreducible" }),
				" — there is no atomic\ncheck-and-kill syscall — so it is bounded, not closed: a ",
				createVNode(_components.strong, { children: [
					"code comment at the kill\nsite cites the ",
					createVNode(_components.code, { children: "killLiveHolder" }),
					" precedent"
				] }),
				" (",
				createVNode(_components.code, { children: "endpoint.ts:415-419" }),
				", which already\nlives with the identical race on a gate pid) so a future reader sees the window is a\n",
				createVNode(_components.em, { children: "considered" }),
				" bound, not an oversight. It is strictly smaller here (three attestations\nagreeing vs. one)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "TOCTOU on the socket" }), " — the squatter may close between “accepting” and the\nhandshake, or between handshake and kill. Every transition re-checks; a vanished\nholder simply falls through to the ordinary fresh spawn."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "the foreign-process arm" }),
				" — a non-kaval must be ",
				createVNode(_components.em, { children: "impossible" }),
				" to kill. It is\ngated behind a ",
				createVNode(_components.strong, { children: "successful kaval handshake" }),
				", never behind the OS lookup alone."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "platform lookup differences" }),
				" — linux (",
				createVNode(_components.code, { children: "/proc" }),
				") is grounded; darwin (",
				createVNode(_components.code, { children: "lsof" }),
				",\nthe field platform) is verified on a real mac in acceptance, never assumed."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Bug — a gate-less socket squatter wedges kolu forever",
	"description": "A kaval orphan whose gate file is gone but which still holds the rendezvous socket wedges kolu permanently: recycle only ever kills gate-recorded pids, so the squatter survives every recycle and the incompatible card's renew loops forever (field case: sincereintent 25494, 8 days). The fix gives the supervisor identity over its OWN socket: OS socket-holder lookup + kaval handshake → recycle the verified orphan; a non-kaval process is never killed.",
	"parents": [
		"bug",
		"pty-daemon",
		"surface"
	],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-17T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-wedge",
			"text": "The wedge"
		},
		{
			"depth": 2,
			"slug": "the-fix--the-supervisor-owns-its-own-socket-namespace",
			"text": "The fix — the supervisor owns its own socket namespace"
		},
		{
			"depth": 3,
			"slug": "the-identity-model-the-load-bearing-decision",
			"text": "The identity model (the load-bearing decision)"
		},
		{
			"depth": 2,
			"slug": "where-it-lives-structure",
			"text": "Where it lives (structure)"
		},
		{
			"depth": 3,
			"slug": "exported-api-additions-named-honestly-for-the-consumer-gates",
			"text": "Exported-API additions (named honestly for the consumer gates)"
		},
		{
			"depth": 2,
			"slug": "design-philosophy",
			"text": "Design philosophy"
		},
		{
			"depth": 2,
			"slug": "acceptance--the-pins",
			"text": "Acceptance — the pins"
		},
		{
			"depth": 2,
			"slug": "the-adversaries-this-must-survive-for-the-lens-gate",
			"text": "The adversaries this must survive (for the lens gate)"
		}
	];
}
var url = "src/content/atlas/bug-gateless-socket-squatter.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-gateless-socket-squatter.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-gateless-socket-squatter.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
