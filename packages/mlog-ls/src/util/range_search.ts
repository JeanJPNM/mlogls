import { Position, Range } from "vscode-languageserver";

/**
 * Performs binary search to find a range that contains the provided position.
 */
export function findRangeIndex(ranges: Range[], position: Position): number {
  let start = 0;
  let end = ranges.length;

  while (start < end) {
    const mid = start + ((end - start) >> 1);
    const range = ranges[mid];

    if (range.start.line > position.line) {
      end = mid;
    } else if (range.end.line < position.line) {
      start = mid + 1;
    } else if (range.start.character > position.character) {
      end = mid;
    } else if (range.end.character < position.character) {
      start = mid + 1;
    } else {
      return mid;
    }
  }

  return -1;
}

export function findRange<T extends Range>(
  ranges: T[],
  position: Position
): T | undefined {
  const index = findRangeIndex(ranges, position);
  if (index === -1) return;
  return ranges[index];
}
