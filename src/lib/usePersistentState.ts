import { useEffect, useState } from "react";

/**
 * useState that mirrors to localStorage, so each calculator reopens with the
 * tech's last-used values — a core "faster than paper" requirement.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage full / unavailable — ignore */
    }
  }, [key, state]);

  return [state, setState] as const;
}
