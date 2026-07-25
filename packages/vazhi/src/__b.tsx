import { EventEmitter } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { type Forward, targetKey } from "@kolu/port-forward";
import { render } from "ink";
import { Screen } from "./Screen.tsx";
const NOW = 1_700_000_000_000;
const mk = (n: number): Forward[] => Array.from({ length: n }, (_, i) => ({
  key: targetKey({ kind: "remote", host: `pu-dev-${i}`, port: 5173 + i }),
  target: { kind: "remote" as const, host: `pu-dev-${i}`, port: 5173 + i },
  localPort: 4000 + i, createdAt: NOW - i * 60_000 }));
class T extends EventEmitter { isTTY = true; columns = 120; rows = 40; bytes = 0;
  write(s: string) { this.bytes += s.length; return true; } end() {} }
class I extends EventEmitter { isTTY = true; setRawMode() { return this; }
  setEncoding() { return this; } read() { return null; } resume() { return this; }
  pause() { return this; } ref() {} unref() {} }
for (const n of [1, 5, 20]) {
  const rows = mk(n); const times: number[] = []; const stdout = new T();
  const el = (now: number) => (<Screen forwards={rows.slice()} hostname="pureintent"
    mode={{ kind: "table" }} now={now} onInputChange={() => {}} onInputSubmit={() => {}}
    selectedKey={rows[0]?.key} size={{ columns: 120, rows: 40 }} status={undefined} />);
  const inst = render(el(NOW), { stdout: stdout as never, stdin: new I() as never,
    patchConsole: false, exitOnCtrlC: false,
    onRender: ({ renderTime }: { renderTime: number }) => times.push(renderTime) });
  for (let i = 0; i < 30; i++) { inst.rerender(el(NOW + i)); await sleep(40); }
  times.length = 0; const N = 150; const before = stdout.bytes;
  const c0 = process.cpuUsage();
  for (let i = 0; i < N; i++) { inst.rerender(el(NOW + 1000 + i)); await sleep(40); }
  const cu = process.cpuUsage(c0);
  process.stderr.write(`n=${n}: renders=${times.length}/${N} | ink render phase avg ${(times.reduce((a,b)=>a+b,0)/times.length).toFixed(3)} ms | cpu ${((cu.user + cu.system)/1000/N).toFixed(3)} ms/tick | stdout ${((stdout.bytes-before)/N).toFixed(1)} B/tick\n`);
  inst.unmount();
}
process.exit(0);
