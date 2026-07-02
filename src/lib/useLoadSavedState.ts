import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * When a calculator is opened from a saved job entry, the saved state is
 * passed via router location state as `loadCalc`. This applies it once.
 */
export function useLoadSavedState<T>(apply: (state: T) => void) {
  const location = useLocation();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const loaded = (location.state as { loadCalc?: T } | null)?.loadCalc;
    if (loaded !== undefined) {
      apply(loaded);
      done.current = true;
    }
  }, [location.state, apply]);
}
