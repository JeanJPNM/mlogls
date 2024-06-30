import { MlogDocument } from "./document";
import { CommentLine, LabelDeclaration } from "./parser/nodes";

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

  const identationBlocks = getIdentationBlocks(doc);

  let result = "";
  let lineNumber = 0;
  let i = 0;

  for (const { start, end, indent } of identationBlocks) {
    for (; i < end; i++) {
      const node = nodes[i];
      const pos = node.start;

      let minLines = 1;
      let maxLines = 3;

      if (i === 0) {
        // no need to force at least one line before the first instruction
        minLines--;
        maxLines--;
      } else if (i === start && !indent) {
        // make sure that non-indented lines have
        // at least one line empty line
        // separating them from the previous block
        minLines++;
      }

      result += "\n".repeat(clamp(pos.line - lineNumber, minLines, maxLines));

      if (indent) {
        result += identationUnit;
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

interface IdentationBlock {
  indent: boolean;
  start: number;
  end: number;
}

function getIdentationBlocks(doc: MlogDocument) {
  const nodes = doc.nodes;

  const labelIndexes: number[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node instanceof LabelDeclaration) {
      labelIndexes.push(i);
    }
  }

  const flatBlocks: { start: number; end: number }[] = [];

  for (const index of labelIndexes) {
    let start = index;
    const end = index + 1;
    for (let i = index - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!(node instanceof CommentLine)) break;

      if (node.start.character !== 0) continue;

      start = i;
    }

    flatBlocks.push({ start, end });
  }

  // preserve identation of
  // non-indented comment lines at the end of the file
  if (nodes[nodes.length - 1] instanceof CommentLine) {
    const end = nodes.length;
    let start = end;
    for (let i = start - 1; i >= 0; i--) {
      const node = nodes[i];
      if (!(node instanceof CommentLine)) break;

      if (node.start.character !== 0) continue;

      start = i;
    }

    if (start !== end) flatBlocks.push({ start, end });
  }

  const blocks: IdentationBlock[] = [];

  let previousEnd = 0;
  for (const { start, end } of flatBlocks) {
    // block of non-label header stuff
    if (previousEnd < start) {
      blocks.push({
        start: previousEnd,
        end: start,
        indent: previousEnd !== 0,
      });
    }

    blocks.push({
      start,
      end,
      indent: false,
    });

    previousEnd = end;
  }

  if (previousEnd !== nodes.length) {
    blocks.push({
      start: previousEnd,
      end: nodes.length,
      indent: previousEnd !== 0,
    });
  }

  return blocks;
}
