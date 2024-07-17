import { Range } from "vscode-languageserver";
import { ParameterType, ParameterUsage } from "./parser/descriptors";
import {
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  SyntaxNode,
} from "./parser/nodes";
import { TextToken } from "./parser/tokenize";

export class DeclarationContext {
  variables = new Set<string>();
  labels = new Set<string>();

  addVariable(token: TextToken | undefined) {
    if (token?.type !== "identifier") return;
    this.variables.add(token.content);
  }

  addLabel(name: string) {
    this.labels.add(name);
  }
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
  nodes: SyntaxNode
) {
  const locations: Range[] = [];
  if (nodes instanceof InstructionNode) {
    for (const param of nodes.parameters) {
      if (
        param.type === ParameterType.variable &&
        param.usage === ParameterUsage.write &&
        param.token.content === variable
      ) {
        locations.push(param.token);
      }
    }
  }

  return locations;
}

export function findLabelReferences(label: string, nodes: SyntaxNode[]) {
  const locations: Range[] = [];
  for (const node of nodes) {
    if (node instanceof LabelDeclaration && node.name === label) {
      const { nameToken } = node;

      locations.push(
        Range.create(
          nameToken.start.line,
          nameToken.start.character,
          nameToken.end.line,
          nameToken.end.character - 1 // ignore the trailing ':'
        )
      );
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

    const { nameToken } = node;

    location = Range.create(
      nameToken.start.line,
      nameToken.start.character,
      nameToken.end.line,
      nameToken.end.character - 1 // ignore the trailing ':'
    );
    break;
  }
  return location;
}
