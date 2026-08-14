export interface CollectionWindow<Item, Summary> {
  sample: Item[];
  total: number;
  truncated: boolean;
  summary: Summary;
}

export function createCollectionWindow<Item, Summary>(
  items: readonly Item[],
  limit: number,
  summarize: (allItems: readonly Item[]) => Summary,
): CollectionWindow<Item, Summary> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("limit must be a positive integer");
  }

  return {
    sample: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit,
    summary: summarize(items),
  };
}
