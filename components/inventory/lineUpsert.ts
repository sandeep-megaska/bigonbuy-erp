import type { VariantSearchResult } from "./VariantTypeahead";

type QtyLineBase = {
  id: string;
  variant_id: string;
  qty: string;
  variant: VariantSearchResult | null;
  condition?: string | null;
};

type CountedLineBase = {
  id: string;
  variant_id: string;
  counted_qty: string;
  variant: VariantSearchResult | null;
};

const createLineId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function upsertQtyLine<T extends QtyLineBase>(lines: T[], variant: VariantSearchResult, step = 1): T[] {
  const index = lines.findIndex((line) => line.variant_id === variant.variant_id);

  if (index >= 0) {
    return lines.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const currentQty = Number(line.qty);
      const nextQty = Number.isFinite(currentQty) ? currentQty + step : step;
      return {
        ...line,
        variant_id: variant.variant_id,
        variant,
        qty: String(nextQty),
      } as T;
    });
  }

  const nextLine = {
    id: createLineId(),
    variant_id: variant.variant_id,
    qty: String(step),
    variant,
  } as T;

  if (lines.length > 0 && "condition" in lines[0]) {
    (nextLine as QtyLineBase).condition = "";
  }

  return [...lines, nextLine];
}

export function upsertCountedLine<T extends CountedLineBase>(
  lines: T[],
  variant: VariantSearchResult,
  step = 1
): T[] {
  const index = lines.findIndex((line) => line.variant_id === variant.variant_id);

  if (index >= 0) {
    return lines.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const currentQty = Number(line.counted_qty);
      const nextQty = Number.isFinite(currentQty) ? currentQty + step : step;
      return {
        ...line,
        variant_id: variant.variant_id,
        variant,
        counted_qty: String(nextQty),
      } as T;
    });
  }

  const nextLine = {
    id: createLineId(),
    variant_id: variant.variant_id,
    counted_qty: String(step),
    variant,
  } as T;

  return [...lines, nextLine];
}
