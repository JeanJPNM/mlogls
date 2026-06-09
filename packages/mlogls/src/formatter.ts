import { getLogicalScopes, LogicalScope } from "./analysis/logical_scope";
import { MlogDocument } from "./document";
import { CommentLine, SyntaxNode } from "./parser/nodes";

export interface FormatOptions {
  doc: MlogDocument;
  tabSize: number;
  insertSpaces: boolean;
  insertFinalNewline?: boolean;
}

export function formatCode({
  doc,
  tabSize,
  insertSpaces,
  insertFinalNewline = true,
}: FormatOptions): string {
  const { nodes } = doc;
  const identationUnit = insertSpaces ? " ".repeat(tabSize) : "\t";

  const rootBlock = getLogicalScopes(doc.nodes);

  let result = "";
  let lineNumber = 0;
  let i = 0;

  for (const { start, end, level, extraLine } of indentationBlocks(
    rootBlock,
    nodes
  )) {
    for (; i < end; i++) {
      const node = nodes[i];
      const pos = node.start;

      let minLines = 1;
      let maxLines = 3;

      if (i === 0) {
        // no need to force at least one line before the first instruction
        minLines--;
        maxLines--;
      } else if (i === start && extraLine) {
        // make sure that non-indented lines have
        // at least one line empty line
        // separating them from the previous block
        minLines++;
      }

      result += "\n".repeat(clamp(pos.line - lineNumber, minLines, maxLines));

      if (level > 0) {
        result += identationUnit.repeat(level);
      }

      result += node.line.tokens.map((token) => token.content).join(" ");

      lineNumber = pos.line;
    }
  }

  if (insertFinalNewline) {
    result += "\n";
  }

  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
interface IndentationBlock {
  level: number;
  start: number;
  end: number;
  extraLine: boolean;
}

function* indentationBlocks(
  scope: LogicalScope,
  nodes: SyntaxNode[]
): Generator<IndentationBlock> {
  const { children } = scope;
  if (children.length === 0) {
    yield {
      // the root block does not have a label to skip
      start: scope.level === 0 ? scope.start : scope.start + 1,
      end: scope.end,
      extraLine: false,
      level: scope.level,
    };
    return;
  }

  let start = scope.start;

  for (const child of children) {
    let headerStart = child.start;
    const headerEnd = child.start + 1;
    let currentLine = nodes[headerStart].start.line;

    // include comments that are right above the label
    // in the "header" block
    while (headerStart > start) {
      const previous = nodes[headerStart - 1];
      if (
        !(previous instanceof CommentLine) ||
        previous.start.line !== currentLine - 1
      )
        break;
      headerStart--;
      currentLine--;
    }

    // instructions that preceed the label
    if (start !== headerStart) {
      // the extra line only affects the comments between labels
      // not the instructions that come before them,
      // because at that point, the index of the instruction
      // will be greater than `start`, which means that
      // the extra line will not be added
      yield { start, end: headerStart, level: scope.level, extraLine: true };
    }

    yield {
      start: headerStart,
      end: headerEnd,
      level: scope.level,
      extraLine: true,
    };
    yield* indentationBlocks(child, nodes);
    start = child.end;
  }

  if (start !== scope.end) {
    yield { start, end: scope.end, level: scope.level, extraLine: true };
  }
}
