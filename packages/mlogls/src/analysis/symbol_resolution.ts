import { Range } from "vscode-languageserver";
import { buildingLinkNames, ignoreToken } from "../constants";
import { ParameterType, ParameterUsage } from "../parser/descriptors";
import {
  CommentLine,
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  SyntaxNode,
} from "../parser/nodes";
import { NameSymbol, SymbolFlags, SymbolTable } from "../symbol";
import { TextToken } from "../parser/tokens";

export const buildingNamePattern = /^([a-z]+)(\d+)$/;

export function getSymbolTable(nodes: SyntaxNode[]) {
  const table = new SymbolTable();

  for (const name of buildingLinkNames) {
    table.insert(new NameSymbol(`${name}1`, SymbolFlags.buildingLink));
  }

  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (param.type !== ParameterType.variable) continue;
      if (!param.token.isIdentifier()) continue;

      const name = param.token.content;
      if (table.has(name)) continue;

      if (isBuildingLink(name)) {
        // register building links from [number] to 1
        const match = buildingNamePattern.exec(name);
        const baseName = match![1];
        let number = Number(match![2]);

        while (number > 0) {
          const name = `${baseName}${number}`;
          if (table.has(name)) break;

          table.insert(new NameSymbol(name, SymbolFlags.buildingLink));
          number--;
        }
        continue;
      }

      if (param.usage === ParameterUsage.write && name !== ignoreToken) {
        table.insert(new NameSymbol(name, SymbolFlags.writeable));
      }
    }
  }

  const annotatedVariables = new Set<string>();
  for (const node of nodes) {
    if (!(node instanceof CommentLine)) continue;
    if (!node.docAnnotation) continue;

    const { variableName, kind } = node.docAnnotation;

    // ensure a variable annotated with @local
    // isn't declared by @external later on
    if (annotatedVariables.has(variableName)) continue;
    annotatedVariables.add(variableName);

    if (kind !== "external" || table.has(variableName)) continue;

    table.insert(new NameSymbol(variableName, SymbolFlags.writeable));
  }

  return table;
}

export function getLabelNames(nodes: SyntaxNode[]): Set<string> {
  const labels = new Set<string>();

  for (const node of nodes) {
    if (!(node instanceof LabelDeclaration)) continue;

    labels.add(node.name);
  }

  return labels;
}

export function findVariableUsageLocations(
  variable: string,
  nodes: SyntaxNode[]
) {
  const locations: Range[] = [];
  for (const node of nodes) {
    if (node instanceof CommentLine && node.docAnnotation) {
      const { variableName, variableStart, annotationEnd } = node.docAnnotation;
      if (variableName !== variable) continue;

      const base = node.trailingComment.start.character;
      locations.push(
        Range.create(
          node.start.line,
          base + variableStart,
          node.end.line,
          base + annotationEnd
        )
      );
    }

    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (param.type !== ParameterType.variable) continue;
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

    if (node instanceof CommentLine && node.docAnnotation) {
      const { kind, variableName, variableStart, annotationEnd } =
        node.docAnnotation;
      if (variableName !== variable) continue;
      if (kind !== "external") continue;

      const base = node.trailingComment.start.character;
      locations.push(
        Range.create(
          node.start.line,
          base + variableStart,
          node.end.line,
          base + annotationEnd
        )
      );
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

export function isBuildingLink(name: string) {
  const match = buildingNamePattern.exec(name);
  if (!match) return false;

  const linkName = match[1];
  return buildingLinkNames.has(linkName);
}
