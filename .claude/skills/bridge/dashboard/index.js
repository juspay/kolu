// Departure-board renderer for window.BOARD (from $PWD/bridge-data.js —
// see SKILL.md; the ../ climb is fixed by the skill's known depth and the
// browser normalizes it before the request, so the preview route's wire-level
// traversal guard is never involved). Each lane renders as a card with a
// PROGRESS RAIL of stations: filled ✓ = done, pulsing beacon = running,
// colored = waiting/blocked, hollow = queued. Narrow-first (Code-tab preview
// panel); detail lives in hover titles. Data refresh re-inserts the data
// script (fetch() is CORS-blocked in the sandboxed preview BY DESIGN);
// the entrance animation runs on first paint only, so the 30s reload never
// re-plays it.
const DATA_SRC = "../../../../bridge-data.js";

const $ = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

/** A lane's headline state: the station the eye should read first. */
const headline = (nodes) => {
  const pick =
    nodes.find((n) => n.state === "block") ??
    nodes.find((n) => n.state === "run") ??
    nodes.find((n) => n.state === "wait") ??
    (nodes.every((n) => n.state === "done") ? nodes[nodes.length - 1] : null);
  return pick ?? nodes.find((n) => (n.state ?? "q") === "q") ?? nodes[0];
};

/** Classify a link by where it goes, so its badge tells you before you click:
 *  ❯ = a terminal in kolu · ▤ = a file/note in the Code tab · ↗ = external. */
const linkKind = (href) => {
  if (!href) return null;
  const h = href.replace(/^https?:\/\/[^#]*#/, "#");
  if (h.startsWith("#/t/")) return h.includes("/code?") ? "note" : "term";
  if (h.startsWith("#/")) return "app";
  return "ext";
};
const ICON = { term: "❯", note: "▤", app: "◇", ext: "↗" };
const badge = (el, href) => {
  const k = linkKind(href);
  if (!k) return el;
  el.classList.add(`lk-${k}`);
  el.prepend($("span", "lkicon", ICON[k]));
  return el;
};

const station = (n) => {
  const el = $(n.href ? "a" : "span", `station p-${n.state ?? "q"}`);
  if (n.href) el.href = n.href;
  if (n.title) el.title = n.title;
  el.appendChild($("span", "dot"));
  const lbl = $("span", "slabel", n.label);
  if (n.href) badge(lbl, n.href);
  el.appendChild(lbl);
  return el;
};

/** A track card: the campaign's macro rail; any node carrying `lane`
 *  (a live agent working that step) expands IN PLACE — its detailed
 *  pipeline nests under the macro rail, visually tied to its station. */
const trackCard = (item) => {
  // headline: prefer the deepest live detail; else the macro rail's own
  const liveNode = item.nodes.find((n) => n.lane);
  const head = liveNode ? headline(liveNode.lane.nodes) : headline(item.nodes);
  const card = $("div", `card s-${head.state ?? "q"}`);

  const hd = $("div", "card-head");
  const name = $("span", "lane-name");
  if (item.href) {
    const a = $("a", null, item.name);
    a.href = item.href;
    a.title = "jump to this track's terminal in kolu";
    name.appendChild(badge(a, item.href));
  } else name.textContent = item.name;
  hd.appendChild(name);
  if (item.sub) hd.appendChild($("span", "lane-sub", item.sub));
  const now = $("span", `now s-${head.state ?? "q"}`);
  now.appendChild($("span", "caret", "▸ "));
  now.appendChild(document.createTextNode(head.label));
  if (head.title) now.title = head.title;
  hd.appendChild(now);
  card.appendChild(hd);

  const rail = $("div", "rail");
  item.nodes.forEach((n) => {
    const st = station(n);
    if (n.lane) st.classList.add("has-lane");
    rail.appendChild(st);
  });
  card.appendChild(rail);

  // nested live-lane detail under the macro rail
  item.nodes.forEach((n) => {
    if (!n.lane) return;
    const sub = $("div", "sub-lane");
    const shd = $("div", "sub-head");
    const t = $(
      n.lane.href ? "a" : "span",
      "sub-title",
      n.lane.name ?? n.label,
    );
    if (n.lane.href) {
      t.href = n.lane.href;
      t.title = "jump to this agent's terminal";
      badge(t, n.lane.href);
    }
    shd.appendChild(t);
    if (n.lane.sub) shd.appendChild($("span", "lane-sub", n.lane.sub));
    sub.appendChild(shd);
    const srail = $("div", "rail rail-sub");
    for (const x of n.lane.nodes) srail.appendChild(station(x));
    sub.appendChild(srail);
    card.appendChild(sub);
  });
  return card;
};

const pill = (n) => {
  const el = $(n.href ? "a" : "span", `pill s-${n.state ?? "q"}`, n.label);
  if (n.href) {
    el.href = n.href;
    badge(el, n.href);
  }
  if (n.title) el.title = n.title;
  return el;
};

// ── Red-alert sound ────────────────────────────────────────────────────────
// A single TNG red-alert chime fires when a `block` station FIRST appears
// (a new alert), never on the 30s data reload for an already-standing block:
// index.js is not reloaded (only the data script is re-inserted), so the
// module-level `seenBlocks`/`muted` survive every refresh. Unmuted by default;
// the toggle persists in localStorage when the sandbox allows it. Source chime:
// trekcore.com tng_red_alert3.mp3, kept beside this file (served by the same
// Code-tab preview route that serves index.js).
const alertAudio = new Audio("./red-alert.mp3");
alertAudio.preload = "auto";
let muted = false;
try {
  muted = localStorage.getItem("ob-muted") === "1";
} catch {} // sandboxed iframe (origin null) can throw on storage — default unmuted

// Browsers block audio until a user gesture; prime it on the first click so a
// later alert actually sounds. Harmless if it rejects (still-locked → no-op).
const unlockAudio = () => {
  alertAudio
    .play()
    .then(() => {
      alertAudio.pause();
      alertAudio.currentTime = 0;
    })
    .catch(() => {});
  document.removeEventListener("click", unlockAudio);
};
document.addEventListener("click", unlockAudio, { once: true });

const playChime = () => {
  try {
    alertAudio.currentTime = 0;
    alertAudio.play().catch(() => {});
  } catch {}
};

/** Stable keys for every `block` station anywhere in the tree — keyed by
 *  track name + label (NOT position) so a reorder doesn't read as a new alert. */
const collectBlockKeys = (d) => {
  const keys = new Set();
  const walk = (nodes, prefix) =>
    (nodes ?? []).forEach((n, i) => {
      const k = `${prefix}/${n.label ?? i}`;
      if (n.state === "block") keys.add(k);
      if (n.lane?.nodes) walk(n.lane.nodes, `${k}~lane`);
    });
  (d.tracks ?? []).forEach((t, i) => walk(t.nodes, `t:${t.name ?? i}`));
  (d.queue ?? []).forEach((n, i) => {
    if (n.state === "block") keys.add(`q/${n.label ?? i}`);
  });
  return keys;
};

let seenBlocks = null; // null until the first paint seeds it (no chime on open)
const alertOnNewBlocks = (d) => {
  const now = collectBlockKeys(d);
  if (seenBlocks === null) {
    seenBlocks = now; // seed silently — pre-existing alerts on load don't blare
    return;
  }
  let fresh = false;
  for (const k of now) if (!seenBlocks.has(k)) fresh = true;
  seenBlocks = now;
  if (fresh && !muted) playChime();
};

function mountMuteButton() {
  const mast = document.querySelector(".mast");
  if (!mast || document.getElementById("mute-btn")) return;
  const b = $("button", "mute-btn");
  b.id = "mute-btn";
  const paint = () => {
    b.textContent = muted ? "🔇 alert muted" : "🔊 alert sound";
    b.classList.toggle("is-muted", muted);
    b.title = muted
      ? "Red-alert chime is muted — click to unmute"
      : "A chime sounds when a new red alert appears — click to mute";
  };
  b.onclick = () => {
    muted = !muted;
    try {
      localStorage.setItem("ob-muted", muted ? "1" : "0");
    } catch {}
    paint();
    if (!muted) playChime(); // unmuting gives an audible confirmation
  };
  paint();
  mast.appendChild(b);
}

let painted = false;

function render(d) {
  const meta = document.getElementById("meta");
  meta.replaceChildren(
    $("span", "live-dot"),
    $(
      "span",
      null,
      `${d.project ? `${d.project} · ` : ""}${d.updated} · coordinator ${d.coordinator} · data reloads 30s · hover for detail`,
    ),
  );

  const root = document.getElementById("root");
  root.replaceChildren();
  root.className = painted ? "" : "boot";

  const section = (title) => {
    const s = $("section");
    s.appendChild($("h2", null, title));
    root.appendChild(s);
    return s;
  };

  const tracks = section("Tracks");
  d.tracks.forEach((l, i) => {
    const c = trackCard(l);
    c.style.animationDelay = `${i * 70}ms`;
    tracks.appendChild(c);
  });

  const q = section("Merge queue · srid");
  const qp = $("div", "pills");
  if (d.queue.length === 0) qp.appendChild($("span", "empty", "— empty —"));
  for (const n of d.queue) qp.appendChild(pill(n));
  q.appendChild(qp);

  const det = $("details", "shipped");
  det.appendChild($("summary", null, `Shipped today · ${d.shipped.length}`));
  const sp = $("div", "pills");
  for (const n of d.shipped) sp.appendChild(pill({ ...n, state: "done" }));
  det.appendChild(sp);
  root.appendChild(det);

  root.appendChild($("div", "strip", d.strip));
  painted = true;
}

const renderAll = () => {
  render(window.BOARD);
  mountMuteButton();
  alertOnNewBlocks(window.BOARD);
};
window.addEventListener("board-data", renderAll);
if (window.BOARD) renderAll();

function reloadData() {
  const old = document.getElementById("board-data");
  if (old) old.remove();
  const s = document.createElement("script");
  s.id = "board-data";
  s.src = `${DATA_SRC}?t=${Date.now()}`;
  s.onerror = () => {
    const meta = document.getElementById("meta");
    if (meta)
      meta.replaceChildren(
        $("span", "live-dot"),
        $(
          "span",
          null,
          "bridge-data.js not found at the project root — retrying in 30s",
        ),
      );
  };
  document.body.appendChild(s);
}

reloadData();
setInterval(reloadData, 30_000);
