import { Position, Range } from "vscode-languageserver";
import { MlogDocument } from "../document";
import { findRange, findRangeIndex } from "../util/range_search";

export function containsPosition(range: Range, position: Position) {
  return (
    range.start.line === position.line &&
    range.start.character <= position.character &&
    position.character <= range.end.character
  );
}

export function getSelectedSyntaxNodeIndex(
  doc: MlogDocument,
  position: Position
) {
  return findRangeIndex(doc.nodes, position);
}

export function getSelectedSyntaxNode(doc: MlogDocument, position: Position) {
  return findRange(doc.nodes, position);
}

export function* getPartiallySelectedSyntaxNodes(
  doc: MlogDocument,
  start: Position,
  end: Position
) {
  for (const node of doc.nodes) {
    if (node.start.line < start.line) continue;
    if (node.start.line > end.line) break;

    if (node.end.character < start.character) continue;
    if (node.start.character > end.character) break;

    yield node;
  }
}
