import { Position, Range, TextEdit } from "vscode-languageserver";
import { JumpInstruction, LabelDeclaration, SyntaxNode } from "./parser/nodes";
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

      if (node.isInstruction) {
        instructionIndex++;
      }
    }
  }

  const referencedIndexes = new Map<number, JumpInstruction[]>();
  for (const node of nodes) {
    if (!(node instanceof JumpInstruction)) continue;

    const { destination } = node.data;
    if (destination?.type !== "number") continue;

    const index = Number(destination.content);

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

    if (!node.isInstruction) continue;

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
        const range = Range.create(
          doc.positionAt(destination!.start),
          doc.positionAt(destination!.end)
        );
        edits.push(TextEdit.replace(range, label));
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

    if (node.isInstruction) {
      index++;
    }
  }

  const edits: TextEdit[] = [];

  for (const node of nodes) {
    if (!(node instanceof JumpInstruction)) continue;

    const { destination } = node.data;
    if (destination?.type !== "identifier") continue;
    const label = destination.content;
    const index = labelIndexes.get(label)?.index;

    if (index !== undefined) {
      referencedLabels.add(label);

      const range = Range.create(
        doc.positionAt(destination.start),
        doc.positionAt(destination.end)
      );

      edits.push(TextEdit.replace(range, `${index}`));
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
  const startPosition = doc.positionAt(node.start);
  const line = doc.getText(
    Range.create(
      startPosition.line,
      0,
      startPosition.line,
      startPosition.character
    )
  );

  let spaceCount = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] !== " " && line[i] !== "\t") break;

    spaceCount++;
  }

  return Position.create(
    startPosition.line,
    startPosition.character - spaceCount
  );
}

function getEndOfInstructionLine(doc: MlogDocument, node: SyntaxNode) {
  const endPosition = doc.positionAt(node.end);

  const lineSegment = doc.getText(
    Range.create(
      endPosition.line,
      endPosition.character,
      endPosition.line + 1,
      0
    )
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
    return Position.create(endPosition.line + 1, 0);
  }

  return Position.create(endPosition.line, endPosition.character + spaceCount);
}
