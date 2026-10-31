/**
 * Pure utilities for client-side equipment filtering of the YMove review queue.
 * All functions are free of side effects to allow straightforward unit testing.
 */

export function filterQueueByEquipment<T extends { equipment: string }>(
  items: T[],
  equipment: string,
): T[] {
  if (!equipment) return items
  return items.filter(item => item.equipment === equipment)
}

export function getEquipmentCountMap<T extends { equipment: string }>(
  items: T[],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of items) {
    result[item.equipment] = (result[item.equipment] ?? 0) + 1
  }
  return result
}

export function getSortedEquipmentOptions<T extends { equipment: string }>(
  items: T[],
): Array<{ value: string; count: number }> {
  const counts = getEquipmentCountMap(items)
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }))
}
