import { getLabelBlocks, LabelBlock } from "./analysis";
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

  const rootBlock = getLabelBlocks(doc.nodes);

  let result = "";
  let lineNumber = 0;
  let i = 0;

  //  TODO: fix comments that are meant to be right above labels
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
  block: LabelBlock,
  nodes: SyntaxNode[]
): Generator<IndentationBlock> {
  const { children } = block;
  if (children.length === 0) {
    yield {
      // the root block does not have a label to skip
      start: block.level === 0 ? block.start : block.start + 1,
      end: block.end,
      extraLine: false,
      level: block.level,
    };
    return;
  }

  let start = block.start;

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
      yield { start, end: headerStart, level: block.level, extraLine: false };
    }

    yield {
      start: headerStart,
      end: headerEnd,
      level: block.level,
      extraLine: true,
    };
    yield* indentationBlocks(child, nodes);
    start = child.end;
  }

  if (start !== block.end) {
    yield { start, end: block.end, level: block.level, extraLine: true };
  }
}
