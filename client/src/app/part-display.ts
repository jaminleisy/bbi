/** Preferred part-type display order; anything else sorts alphabetically after. */
export const PART_TYPE_ORDER = [
  'case', 'psu', 'gpu', 'mobo', 'cpu', 'cpuCooler', 'storage', 'ram', 'misc'
] as const;

export function partTypeRank(type: string | null | undefined): number {
  const t = (type ?? '').trim().toLowerCase();
  if (!t) return Number.MAX_SAFE_INTEGER;
  const idx = PART_TYPE_ORDER.findIndex(x => x.toLowerCase() === t);
  return idx >= 0 ? idx : PART_TYPE_ORDER.length;
}

export function comparePartTypes(a: string | null | undefined, b: string | null | undefined): number {
  const ra = partTypeRank(a);
  const rb = partTypeRank(b);
  if (ra !== rb) return ra - rb;
  return (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });
}

export function sortByPartType<T extends { type: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => comparePartTypes(a.type, b.type));
}

export function sortTypeNames(types: readonly string[]): string[] {
  return [...types].sort(comparePartTypes);
}

/** Friendly label for a part type key (e.g. cpuCooler → Cooler). */
export function partTypeLabel(type: string | null | undefined): string {
  const t = (type ?? '').trim();
  if (t.toLowerCase() === 'cpucooler') return 'Cooler';
  return t;
}

/** Format a part model number, appending color in parentheses when present. */
export function partModelText(
  part: { modelNumber?: string | null; color?: string | null },
  empty = '—'
): string {
  const model = part.modelNumber?.trim() || '';
  const color = part.color?.trim() || '';
  if (!model && !color) return empty;
  if (!color) return model || empty;
  if (!model) return `(${color})`;
  return `${model} (${color})`;
}

/** Manufacturer + model (+ color), for compact part labels. */
export function partDisplayLabel(
  part: {
    manufacturer?: string | null;
    modelNumber?: string | null;
    color?: string | null;
  },
  empty = '—'
): string {
  const mfr = part.manufacturer?.trim() || '';
  const model = partModelText(part, '');
  const label = [mfr, model].filter(Boolean).join(' ');
  return label || empty;
}

/** Used inventory that still needs testing. */
export function isUsedUntested(part: {
  condition?: string | null;
  testedDate?: string | null;
}): boolean {
  return part.condition === 'Used' && !part.testedDate;
}

/** Possibly or confirmed scam (scam = 1 or 2). */
export function isScamPart(part: { scam?: number | null }): boolean {
  const s = part.scam ?? 0;
  return s === 1 || s === 2;
}

/** Open order URL in a new tab. Returns false when missing. */
export function openPartOrderUrl(part: { orderUrl?: string | null }): boolean {
  const url = part.orderUrl?.trim();
  if (!url) return false;
  window.open(url, '_blank', 'noopener');
  return true;
}

/** Identity for collapsing duplicate assignments: type + manufacturer + model. */
export function partIdentityKey(p: {
  type: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
}): string {
  return [
    (p.type ?? '').trim().toLowerCase(),
    (p.manufacturer ?? '').trim().toLowerCase(),
    (p.modelNumber ?? '').trim().toLowerCase()
  ].join('\0');
}

export interface GroupedPart<T> {
  count: number;
  parts: T[];
  /** Representative row (first in group) for labels / actions. */
  sample: T;
}

/**
 * Collapse parts that share type, manufacturer, and model number into one
 * display group with a quantity (order preserved by first occurrence, then type sort).
 */
export function groupIdenticalParts<T extends {
  type: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
}>(parts: readonly T[]): GroupedPart<T>[] {
  const map = new Map<string, T[]>();
  const order: string[] = [];
  for (const p of parts) {
    const k = partIdentityKey(p);
    if (!map.has(k)) {
      map.set(k, []);
      order.push(k);
    }
    map.get(k)!.push(p);
  }
  const groups = order.map(k => {
    const list = map.get(k)!;
    return { count: list.length, parts: list, sample: list[0] };
  });
  return groups.sort((a, b) => {
    const tc = comparePartTypes(a.sample.type, b.sample.type);
    if (tc !== 0) return tc;
    const mc = (a.sample.manufacturer ?? '').localeCompare(
      b.sample.manufacturer ?? '', undefined, { sensitivity: 'base' });
    if (mc !== 0) return mc;
    return (a.sample.modelNumber ?? '').localeCompare(
      b.sample.modelNumber ?? '', undefined, { sensitivity: 'base' });
  });
}

/** Format quantity prefix like "3X" (empty when count is 1). */
export function partQtyLabel(count: number): string {
  return count > 1 ? `${count}X` : '';
}
