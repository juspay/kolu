import { type Accessor, createContext, useContext } from "solid-js";

export const PanelShown = createContext<Accessor<boolean>>();
export function usePanelShown(): Accessor<boolean> {
  const shown = useContext(PanelShown);
  if (!shown) throw new Error("Panel view requires PanelShown");
  return shown;
}
