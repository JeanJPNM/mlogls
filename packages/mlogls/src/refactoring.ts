import { Position, Range, TextEdit } from "vscode-languageserver";
import {
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  SyntaxNode,
} from "./parser/nodes";
import { MlogDocument } from "./document";

export function convertToLabeledJumps(doc: MlogDocument): TextEdit[] {
  const { nodes } = doc;

  const existentLabels = new Set<string>();
  const reusableLabels = new Map<number, string>();

  {
    let instructionIndex = 0;
    for (const node of nodes) {
      if (node instanceof LabelDeclaration) {
        existentLabels.add(node.name);

        if (!reusableLabels.has(instructionIndex)) {
          reusableLabels.set(instructionIndex, node.name);
        }
      }

      if (node instanceof InstructionNode) {
        instructionIndex++;
      }
    }
  }

  const referencedIndexes = new Map<number, JumpInstruction[]>();
  for (const node of nodes) {
    if (!(node instanceof JumpInstruction)) continue;

    const { destination } = node.data;
    if (!destination?.isNumber()) continue;

    // convert negative indexes to 0
    const index = Math.max(destination.value, 0);

    if (referencedIndexes.has(index)) {
      referencedIndexes.get(index)!.push(node);
    } else {
      referencedIndexes.set(index, [node]);
    }
  }

  const edits: TextEdit[] = [];

  let labelCounter = 0;

  const sortedEntries = Array.from(referencedIndexes.entries()).sort(
    (a, b) => a[0] - b[0]
  );

  let currentEntry = 0;
  let currentPosition = 0;

  for (
    let i = 0;
    i < nodes.length && currentEntry < sortedEntries.length;
    i++
  ) {
    const node = nodes[i];

    if (!(node instanceof InstructionNode)) continue;

    const [jumpIndex, jumps] = sortedEntries[currentEntry];

    if (jumpIndex === currentPosition) {
      currentEntry++;
      let label = reusableLabels.get(jumpIndex);

      if (label === undefined) {
        do {
          label = `label_${labelCounter++}`;
        } while (existentLabels.has(label));

        const position = getStartOfInstructionLine(doc, node);
        edits.push(TextEdit.insert(position, `${label}:\n`));
      }

      for (const jump of jumps) {
        const { destination } = jump.data;
        edits.push(TextEdit.replace(destination!, label));
      }
    }

    currentPosition++;
  }

  return edits;
}

export function convertToNumberedJumps(doc: MlogDocument): TextEdit[] {
  const { nodes } = doc;

  const labelIndexes = new Map<
    string,
    { node: LabelDeclaration; index: number }
  >();
  const referencedLabels = new Set<string>();

  let index = 0;
  for (const node of nodes) {
    if (node instanceof LabelDeclaration) {
      labelIndexes.set(node.name, { node, index });
    }

    if (node instanceof InstructionNode) {
      index++;
    }
  }

  const edits: TextEdit[] = [];

  for (const node of nodes) {
    if (!(node instanceof JumpInstruction)) continue;

    const { destination } = node.data;
    if (!destination?.isIdentifier()) continue;
    const label = destination.content;
    const index = labelIndexes.get(label)?.index;

    if (index !== undefined) {
      referencedLabels.add(label);

      edits.push(TextEdit.replace(destination, `${index}`));
    }
  }

  for (const label of referencedLabels) {
    const { node } = labelIndexes.get(label)!;
    const start = getStartOfInstructionLine(doc, node);
    const end = getEndOfInstructionLine(doc, node);

    edits.push(TextEdit.del(Range.create(start, end)));
  }

  return edits;
}

function getStartOfInstructionLine(doc: MlogDocument, node: SyntaxNode) {
  const { start } = node;
  const line = doc.getText(
    Range.create(start.line, 0, start.line, start.character)
  );

  let spaceCount = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] !== " " && line[i] !== "\t") break;

    spaceCount++;
  }

  return Position.create(start.line, start.character - spaceCount);
}

function getEndOfInstructionLine(doc: MlogDocument, node: SyntaxNode) {
  const { end } = node;

  const lineSegment = doc.getText(
    Range.create(end.line, end.character, end.line + 1, 0)
  );

  // only true if the line segment
  // doesn't have anything but whitespace
  // before the line ends
  let endsWithNewLine = false;

  // amount of whitespace characters
  // in the line segment
  // excluding new lines
  let spaceCount = 0;

  for (let i = 0; i < lineSegment.length; i++) {
    if (lineSegment[i] === "\n" || lineSegment[i] === "\r") {
      endsWithNewLine = true;
      break;
    }

    if (lineSegment[i] !== " " && lineSegment[i] !== "\t") {
      break;
    }
    spaceCount++;
  }

  if (endsWithNewLine) {
    return Position.create(end.line + 1, 0);
  }

  return Position.create(end.line, end.character + spaceCount);
}
