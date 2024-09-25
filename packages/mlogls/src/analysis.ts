import {
  CompletionItem,
  DiagnosticSeverity,
  DiagnosticTag,
  Range,
} from "vscode-languageserver";
import { ParameterType, ParameterUsage } from "./parser/descriptors";
import {
  CommentLine,
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  SyntaxNode,
} from "./parser/nodes";
import { ParserDiagnostic } from "./parser/tokenize";
import { MlogDocument } from "./document";
import { DiagnosticCode } from "./protocol";
import { buildingLinkNames, counterVar, maxLabelCount } from "./constants";
import { ParserPosition, TextToken } from "./parser/tokens";

export interface TokenSemanticData {
  token: TextToken;
  type: number;
  modifiers?: number;
}

export interface CompletionContext {
  getVariableCompletions(): CompletionItem[];
  getLabelCompletions(): CompletionItem[];
}

export interface LabelBlock {
  /**
   * The indentation of the label of this node. If this is the root node, this
   * value is -1.
   */
  labelIndentation: number;
  /**
   * The index of the label of this indentation node, unless `this` is the root
   * node.
   */
  start: number;
  end: number;
  level: number;
  children: LabelBlock[];
}

export const buildingNamePattern = /([a-z]+)(\d+)/;

/**
 * Returns a set of label names that are accessible in the logical scope of the
 * node at the provided index.
 *
 * Only top-level labels and all labels part of the top-level block that
 * contains the index are returned.
 */
export function findLabelsInScope(
  nodes: SyntaxNode[],
  currentNodeIndex: number
) {
  const labels = new Set<string>();
  const root = getLabelBlocks(nodes);

  let parent: LabelBlock | undefined = root;
  while (parent) {
    const block: LabelBlock = parent;
    parent = undefined;

    for (const child of block.children) {
      const label = nodes[child.start] as LabelDeclaration;
      labels.add(label.name);

      if (child.start > currentNodeIndex || child.end < currentNodeIndex) {
        continue;
      }

      parent = child;
    }
  }

  return labels;
}

export function declaredVariables(nodes: SyntaxNode[]) {
  const variables = new Set<string>();

  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type !== ParameterType.variable ||
        param.usage !== ParameterUsage.write ||
        !param.token.isIdentifier() ||
        param.token.content === counterVar
      )
        continue;
      variables.add(param.token.content);
    }
  }

  return variables;
}

export function findVariableUsageLocations(
  variable: string,
  nodes: SyntaxNode[]
) {
  const locations: Range[] = [];
  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type !== ParameterType.variable &&
        param.type !== ParameterType.readonlyGlobal &&
        param.type !== ParameterType.buildingLink
      )
        continue;
      if (param.token.content !== variable) continue;
      locations.push(param.token);
    }
  }

  return locations;
}

export function findVariableWriteLocations(
  variable: string,
  nodes: SyntaxNode[]
) {
  const locations: Range[] = [];

  for (const node of nodes) {
    if (node instanceof InstructionNode) {
      for (const param of node.parameters) {
        if (
          param.type === ParameterType.variable &&
          param.usage === ParameterUsage.write &&
          param.token.content === variable
        ) {
          locations.push(param.token);
        }
      }
    }
  }

  return locations;
}

export function findLabelReferences(label: string, nodes: SyntaxNode[]) {
  const locations: Range[] = [];
  for (const node of nodes) {
    if (node instanceof LabelDeclaration && node.name === label) {
      locations.push(labelDeclarationNameRange(node.nameToken));
      continue;
    }

    if (!(node instanceof JumpInstruction)) continue;

    for (const param of node.parameters) {
      if (param.type === ParameterType.label && param.token.content === label) {
        locations.push(param.token);
      }
    }
  }

  return locations;
}

export function findLabelDefinition(label: string, nodes: SyntaxNode[]) {
  let location: Range | undefined;

  for (const node of nodes) {
    if (!(node instanceof LabelDeclaration)) continue;
    if (node.name !== label) continue;

    location = labelDeclarationNameRange(node.nameToken);
    break;
  }
  return location;
}

export function labelDeclarationNameRange(textToken: TextToken) {
  return Range.create(
    textToken.start.line,
    textToken.start.character,
    textToken.end.line,
    textToken.end.character - 1 // ignore the trailing ':'
  );
}

export function validateLabelUsage(
  doc: MlogDocument,
  diagnostics: ParserDiagnostic[]
) {
  let instructionCount = 0;
  let labelCount = 0;
  const nodes = doc.nodes;
  const labels = new Map<string, LabelDeclaration>();
  const unusedLabels = new Set<string>();

  for (const node of nodes) {
    if (node instanceof InstructionNode) {
      instructionCount++;
    }
    if (!(node instanceof LabelDeclaration)) continue;
    labelCount++;

    if (labelCount > maxLabelCount) {
      diagnostics.push({
        range: node.nameToken,
        message: `Exceeded maximum label count of ${maxLabelCount}`,
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.tooManyLabels,
      });
    }

    if (!labels.has(node.name)) {
      labels.set(node.name, node);
      unusedLabels.add(node.name);
      continue;
    }

    const original = labels.get(node.name)!;

    diagnostics.push({
      range: node.nameToken,
      message: `Redeclaration of label '${node.name}'`,
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.labelRedeclaration,
      relatedInformation: [
        {
          message: "The label is already declared here",
          location: {
            uri: doc.uri,
            range: original.nameToken,
          },
        },
      ],
    });
  }

  for (const node of nodes) {
    if (!(node instanceof JumpInstruction)) continue;
    const { destination } = node.data;
    if (!destination) continue;

    if (destination.isNumber()) {
      diagnostics.push({
        range: destination,
        message: "Prefer using labels instead of jump addresses",
        severity: DiagnosticSeverity.Hint,
        code: DiagnosticCode.preferJumpLabels,
      });

      const address = Number(destination.content);
      if (address < 0 || address >= instructionCount) {
        diagnostics.push({
          range: destination,
          message: `Jump address '${address}' is out of range`,
          severity: DiagnosticSeverity.Error,
          code: DiagnosticCode.outOfRangeValue,
        });
      }
      continue;
    }

    if (!destination.isIdentifier()) continue;

    const label = destination.content;
    unusedLabels.delete(label);

    if (!labels.has(label)) {
      diagnostics.push({
        range: destination,
        message: `Label '${label}' is not declared`,
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.undefinedLabel,
      });
    }
  }

  for (const label of unusedLabels) {
    const node = labels.get(label)!;

    diagnostics.push({
      range: node.nameToken,
      message: `Label '${label}' is declared but never used`,
      severity: DiagnosticSeverity.Warning,
      code: DiagnosticCode.unusedLabel,
      tags: [DiagnosticTag.Unnecessary],
    });
  }
}

export function getLabelBlocks(nodes: SyntaxNode[]) {
  const root: LabelBlock = {
    labelIndentation: -1, // makes sure the root is always a parent
    start: 0,
    end: nodes.length,
    level: 0,
    children: [],
  };

  /**
   * Used to track the indentation of the current token line, handles cases
   * where the ; separator is used to put multiple instructions on the same text
   * line
   */
  let lineStart: ParserPosition = {
    line: -1,
    character: 0,
  };

  let current = root;
  const parents: LabelBlock[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (lineStart.line !== node.start.line) {
      lineStart = node.start;
    }

    if (node instanceof CommentLine) {
      // only add the comment to the current block
      // if it's indentation is greater than the block's label
      if (
        node.start.character > current.labelIndentation &&
        // only add this comment if no previous comment
        // has been skipped
        current.end === i
      ) {
        current.end = i + 1;
      }
      continue;
    }

    if (node instanceof LabelDeclaration) {
      // if this label is less indented than the current block
      // we walk up the tree to find the most fitting parent
      //
      // no need to check if there are parents left
      // because the root has a labelIndentation of -1
      while (node.start.character < current.labelIndentation) {
        const parent = parents.pop()!;

        // expand the parent to include comments
        // that are outside the current block
        let j = current.end;
        while (j < i) {
          const n = nodes[j];
          if (!(n instanceof CommentLine)) break;
          if (n.start.character <= parent.labelIndentation) break;
          j++;
        }

        parent.end = j;
        current = parent;
      }

      // either child or sibling
      const isChild = node.start.character > current.labelIndentation;
      const block: LabelBlock = {
        labelIndentation: lineStart.character,
        start: i,
        end: i + 1,
        level: isChild ? current.level + 1 : current.level,
        children: [],
      };

      if (isChild) {
        current.children.push(block);
        parents.push(current);
      } else {
        parents[parents.length - 1].children.push(block);
      }

      current = block;
      continue;
    }

    // the node is an instruction, so
    // we add it to the current block
    current.end = i + 1;
  }

  // update the end of the blocks that haven't been popped
  while (current.level > 0) {
    const parent = parents.pop()!;

    // expand the parent to include comments
    // that are outside the current block
    let i = current.end;

    while (i < nodes.length) {
      const n = nodes[i];
      if (!(n instanceof CommentLine)) break;
      if (n.start.character <= parent.labelIndentation) break;
      i++;
    }

    parent.end = i;
    current = parent;
  }

  root.end = nodes.length;

  return root;
}

export function usedBuildingLinks(nodes: SyntaxNode[]) {
  const links = new Map<string, number>();

  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (param.type !== ParameterType.buildingLink) continue;
      const match = buildingNamePattern.exec(param.token.content);
      if (!match) continue;

      const linkName = match[1];
      const linkNumber = Number(match[2]);

      if (!buildingLinkNames.has(linkName)) continue;

      links.set(linkName, Math.max(links.get(linkName) || 0, linkNumber));
    }
  }

  return links;
}

export function isBuildingLink(name: string) {
  const match = buildingNamePattern.exec(name);
  if (!match) return false;

  const linkName = match[1];
  return buildingLinkNames.has(linkName);
}

export function validateUnusedVariables(
  nodes: SyntaxNode[],
  diagnostics: ParserDiagnostic[]
) {
  const variables = declaredVariables(nodes);
  const unusedVariables = new Set<string>(variables);

  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type !== ParameterType.variable ||
        param.usage !== ParameterUsage.read
      )
        continue;
      unusedVariables.delete(param.token.content);
    }
  }

  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type !== ParameterType.variable ||
        param.usage !== ParameterUsage.write
      )
        continue;

      if (param.token.content === "_") continue;
      if (!unusedVariables.has(param.token.content)) continue;

      diagnostics.push({
        range: param.token,
        message: `Variable '${param.token.content}' is declared but never used`,
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.unusedVariable,
        tags: [DiagnosticTag.Unnecessary],
      });
    }
  }
}
