import { useEffect, useState } from "react";

/**
 * Returns `value` when the current build still lists it, otherwise `fallback`.
 * Stored values are untrusted: they can be written by an older build, restored
 * from a saved calculation, or synced from another device.
 */
export function listedValue<T extends string | number>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

/**
 * useState that mirrors to localStorage, so each calculator reopens with the
 * tech's last-used values — a core "faster than paper" requirement.
 *
 * `revive` repairs a stored value before it is first used. Without it an
 * out-of-table value reaches the calculation, where it either throws during
 * render (leaving a blank page) or is silently read as zero.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  revive?: (raw: unknown) => T,
) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initial;
      const parsed = JSON.parse(raw) as unknown;
      return revive ? revive(parsed) : (parsed as T);
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
