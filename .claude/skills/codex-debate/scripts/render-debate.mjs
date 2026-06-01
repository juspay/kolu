#!/usr/bin/env node
//
// render-debate.mjs — turn a codex<->claude debate transcript (the JSON the
// debate.workflow.js returns) into a single self-contained HTML file for the
// user to review. Deterministic: no network, no LLM, no external assets.
//
// Usage: node render-debate.mjs <transcript.json> <out.html>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: render-debate.mjs <transcript.json> <out.html>");
  process.exit(2);
}

const data = JSON.parse(readFileSync(inPath, "utf8"));
const {
  status = "unknown",
  rounds = 0,
  base = "?",
  finalVerdict = null,
  filesChanged = [],
  transcript = [],
} = data;

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const STATUS_LABEL = {
  consensus: "Consensus reached",
  deadlock: "Deadlock — needs you",
  "max-rounds": "Round cap hit",
  "in-progress": "Debate in progress…",
};

const sevRank = { blocking: 0, major: 1, minor: 2, nit: 3 };

function badge(kind, text) {
  return `<span class="badge badge-${esc(kind)}">${esc(text)}</span>`;
}

function findingsTable(findings) {
  if (!findings || findings.length === 0)
    return '<p class="muted">No findings.</p>';
  const rows = [...findings]
    .sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))
    .map(
      (f) => `<tr class="status-${esc(f.status)}">
      <td class="mono">${esc(f.id)}</td>
      <td>${badge("sev-" + f.severity, f.severity)}</td>
      <td>${badge("st-" + f.status, f.status)}</td>
      <td class="mono">${esc(f.location)}</td>
      <td>${esc(f.issue)}</td>
      <td class="muted">${esc(f.suggestion)}</td>
    </tr>`,
    )
    .join("\n");
  return `<table class="findings">
    <thead><tr><th>ID</th><th>Severity</th><th>Status</th><th>Location</th><th>Issue</th><th>Suggestion</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function actionsTable(actions) {
  if (!actions || actions.length === 0)
    return '<p class="muted">No actions recorded.</p>';
  const rows = actions
    .map(
      (act) => `<tr>
      <td class="mono">${esc(act.findingId)}</td>
      <td>${badge("disp-" + act.disposition, act.disposition)}</td>
      <td>${esc(act.detail)}</td>
    </tr>`,
    )
    .join("\n");
  return `<table class="actions">
    <thead><tr><th>Finding</th><th>Disposition</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function fileList(files) {
  if (!files || files.length === 0) return "";
  return `<ul class="files">${files.map((f) => `<li class="mono">${esc(f)}</li>`).join("")}</ul>`;
}

function roundCard(entry) {
  const v = entry.codex || {};
  const c = entry.claude;
  const codexBadge = v.approved
    ? badge("ok", "approved")
    : badge("no", "changes requested");
  const rebuttal = v.responseToRebuttal
    ? `<div class="sub"><h4>Response to Claude's rebuttal</h4><p>${esc(v.responseToRebuttal)}</p></div>`
    : "";
  const claudePanel = c
    ? `<div class="panel claude">
        <div class="panel-head"><span class="who">Claude</span>${c.done ? badge("ok", "done") : badge("no", "more to do")}</div>
        <p class="summary">${esc(c.summary)}</p>
        ${actionsTable(c.actions)}
        ${c.filesChanged && c.filesChanged.length ? `<div class="sub"><h4>Files changed this round</h4>${fileList(c.filesChanged)}</div>` : ""}
      </div>`
    : `<div class="panel claude empty"><div class="panel-head"><span class="who">Claude</span>${badge("muted", "no response")}</div><p class="muted">Debate ended on codex's verdict; Claude did not respond this round.</p></div>`;
  return `<section class="round">
    <h2>Round ${esc(entry.round)}</h2>
    <div class="panel codex">
      <div class="panel-head"><span class="who">Codex</span>${codexBadge}</div>
      <p class="summary">${esc(v.summary)}</p>
      ${findingsTable(v.findings)}
      ${rebuttal}
    </div>
    ${claudePanel}
  </section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex &#8644; Claude debate &mdash; ${esc(base)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         margin: 0; padding: 2rem; max-width: 1100px; margin-inline: auto;
         color: #1c2024; background: #fafafa; }
  @media (prefers-color-scheme: dark) { body { color: #e6e6e6; background: #16181c; } }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 1.75rem 0 .75rem; border-bottom: 2px solid #8884; padding-bottom: .3rem; }
  h4 { font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin: .9rem 0 .35rem; }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: .85em; }
  .muted { opacity: .65; }
  .meta { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; align-items: center; margin: .75rem 0 1.5rem;
          padding: .75rem 1rem; border: 1px solid #8883; border-radius: 10px; background: #fff2; }
  .meta b { font-weight: 600; }
  .panel { border: 1px solid #8883; border-radius: 10px; padding: .9rem 1.1rem; margin: .6rem 0; }
  .panel.codex { background: #4f7cff10; border-color: #4f7cff55; }
  .panel.claude { background: #d6883510; border-color: #d6883555; }
  .panel.empty { opacity: .7; }
  .panel-head { display: flex; align-items: center; gap: .6rem; margin-bottom: .4rem; }
  .who { font-weight: 700; letter-spacing: .02em; }
  .panel.codex .who { color: #3b62d9; }
  .panel.claude .who { color: #b9701f; }
  .summary { margin: .3rem 0 .75rem; }
  table { border-collapse: collapse; width: 100%; margin: .4rem 0; font-size: .9rem; }
  th, td { text-align: left; padding: .4rem .55rem; border-bottom: 1px solid #8882; vertical-align: top; }
  th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; }
  tr.status-resolved { opacity: .55; }
  .badge { display: inline-block; padding: .08rem .5rem; border-radius: 999px; font-size: .72rem;
           font-weight: 700; letter-spacing: .02em; text-transform: uppercase; white-space: nowrap; }
  .badge-ok, .badge-st-resolved, .badge-disp-fixed { background: #1f9d5522; color: #1f9d55; }
  .badge-no, .badge-disp-disputed { background: #e5484d22; color: #e5484d; }
  .badge-muted, .badge-disp-partial, .badge-st-open { background: #8883; color: inherit; }
  .badge-sev-blocking { background: #e5484d; color: #fff; }
  .badge-sev-major { background: #e5484d22; color: #e5484d; }
  .badge-sev-minor { background: #f5a62322; color: #d8870b; }
  .badge-sev-nit { background: #8883; color: inherit; }
  .badge-consensus { background: #1f9d55; color: #fff; }
  .badge-deadlock { background: #e5484d; color: #fff; }
  .badge-max-rounds { background: #f5a623; color: #1c2024; }
  .badge-in-progress { background: #4f7cff; color: #fff; }
  .files { margin: .3rem 0; padding-left: 1.2rem; }
  .sub { margin-top: .5rem; }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #8883; }
</style>
</head>
<body>
  <h1>Codex &#8644; Claude review debate</h1>
  <div class="meta">
    <span>${badge(status, STATUS_LABEL[status] || status)}</span>
    <span><b>${esc(rounds)}</b> round(s)</span>
    <span>base <span class="mono">${esc(base)}</span></span>
    <span><b>${esc(filesChanged.length)}</b> file(s) changed</span>
  </div>
  ${filesChanged.length ? `<h4>Files changed across the debate</h4>${fileList(filesChanged)}` : ""}
  ${transcript.map(roundCard).join("\n")}
  ${
    finalVerdict
      ? `<footer><h4>Final codex verdict</h4><p>${finalVerdict.approved ? badge("ok", "approved") : badge("no", "not approved")} ${esc(finalVerdict.summary)}</p></footer>`
      : ""
  }
</body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(outPath);
