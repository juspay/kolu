import { type Accessor, createSignal } from "solid-js";
import type { Camera } from "../useViewState";

export interface HostCamera {
  panX: Accessor<number>;
  panY: Accessor<number>;
  zoom: Accessor<number>;
  setPanX: (v: number) => void;
  setPanY: (v: number) => void;
  setZoom: (v: number) => void;
  snapshot: () => Camera;
  positioned: Accessor<boolean>;
}

export function createCamera(): HostCamera {
  const [panX, setPanX] = createSignal(0);
  const [panY, setPanY] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [positioned, setPositioned] = createSignal(false);

  return {
    panX,
    panY,
    zoom,
    setPanX: (v: number) => {
      setPanX(v);
      setPositioned(true);
    },
    setPanY: (v: number) => {
      setPanY(v);
      setPositioned(true);
    },
    setZoom: (v: number) => {
      setZoom(v);
      setPositioned(true);
    },
    snapshot: () => ({ panX: panX(), panY: panY(), zoom: zoom() }),
    positioned,
  };
}
