import { app, appLifetimeSub } from "../wire";

const sub = appLifetimeSub(app.cells.processStartedAt);

export function serverStartedAt(): number | null {
  const t = sub.value()?.server;
  return t ? t : null;
}
