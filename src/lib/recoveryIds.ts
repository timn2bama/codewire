/** Deterministic JSON used for cross-tab comparisons and recovery identities. */
export function canonicalSerialize(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (typeof item === "object" && item !== null) {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(canonicalize(value)) ?? "undefined";
}

function stableHash(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function canonicalFingerprint(value: unknown): string {
  const serialized = canonicalSerialize(value);
  return `${serialized.length}:${stableHash(serialized)}`;
}

/**
 * Produce an idempotent copy ID. If the exact copy already exists, return it
 * instead of producing another duplicate after an interrupted recovery.
 */
export function recoveredRecord<T extends { id: string }>(
  source: T,
  usedIds: Set<string>,
  existingById: Map<string, T>,
): { record: T; alreadyPresent: boolean } {
  const base = `${source.id}-recovered-${stableHash(canonicalSerialize(source))}`;
  let suffix = 1;
  while (true) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    const record = { ...source, id };
    if (!usedIds.has(id)) return { record, alreadyPresent: false };
    const existing = existingById.get(id);
    if (
      existing &&
      canonicalSerialize(existing) === canonicalSerialize(record)
    ) {
      return { record: existing, alreadyPresent: true };
    }
    suffix += 1;
  }
}
