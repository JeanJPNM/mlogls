import { Range } from "vscode-languageserver";
import { ParameterType, ParameterUsage } from "./parser/descriptors";
import {
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  SyntaxNode,
} from "./parser/nodes";
import { TextToken } from "./parser/tokenize";

export function findVariableUsageLocations(
  variable: string,
  nodes: SyntaxNode[]
) {
  const locations: Range[] = [];
  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type === ParameterType.variable &&
        param.token.content === variable
      ) {
        locations.push(param.token);
      }
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
