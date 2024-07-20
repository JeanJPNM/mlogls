import {
  CompletionItem,
  DiagnosticSeverity,
  DiagnosticTag,
  Range,
} from "vscode-languageserver";
import { ParameterType, ParameterUsage } from "./parser/descriptors";
import {
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  SyntaxNode,
} from "./parser/nodes";
import { ParserDiagnostic, TextToken } from "./parser/tokenize";
import { MlogDocument } from "./document";
import { DiagnosticCode } from "./protocol";

export interface TokenSemanticData {
  token: TextToken;
  type: number;
  modifiers?: number;
}

export interface CompletionContext {
  getVariableCompletions(): CompletionItem[];
  getLabelCompletions(): CompletionItem[];
}

export function findLabels(nodes: SyntaxNode[]) {
  const labels = new Set<string>();
  for (const node of nodes) {
    if (!(node instanceof LabelDeclaration)) continue;
    labels.add(node.name);
  }

  return labels;
}

export function declaredVariables(nodes: SyntaxNode[]) {
  const variables = new Set<string>();

  for (const node of nodes) {
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type === ParameterType.variable &&
        param.usage === ParameterUsage.write
      ) {
        variables.add(param.token.content);
      }
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

export function validateLabelUsage(
  doc: MlogDocument,
  diagnostics: ParserDiagnostic[]
) {
  let instructionCount = 0;
  const nodes = doc.nodes;
  const labels = new Map<string, LabelDeclaration>();
  const unusedLabels = new Set<string>();

  for (const node of nodes) {
    if (node instanceof InstructionNode) {
      instructionCount++;
    }
    if (!(node instanceof LabelDeclaration)) continue;

    if (!labels.has(node.name)) {
      labels.set(node.name, node);
      unusedLabels.add(node.name);
      continue;
    }

    const original = labels.get(node.name)!;

    diagnostics.push({
      start: node.nameToken.start,
      end: node.nameToken.end,
      message: `Label '${node.name}' is already defined`,
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

    if (destination.isNumber) {
      const address = Number(destination.content);
      if (address < 0 || address >= instructionCount) {
        diagnostics.push({
          start: destination.start,
          end: destination.end,
          message: `Jump address '${address}' is out of range`,
          severity: DiagnosticSeverity.Error,
          code: DiagnosticCode.outOfRangeValue,
        });
      }
      continue;
    }

    if (destination.type !== "identifier") continue;

    const label = destination.content;
    unusedLabels.delete(label);

    if (!labels.has(label)) {
      diagnostics.push({
        start: destination.start,
        end: destination.end,
        message: `Label '${label}' is not defined`,
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.undefinedLabel,
      });
    }
  }

  for (const label of unusedLabels) {
    const node = labels.get(label)!;

    diagnostics.push({
      start: node.nameToken.start,
      end: node.nameToken.end,
      message: `Label '${label}' is declared but never used`,
      severity: DiagnosticSeverity.Warning,
      code: DiagnosticCode.unusedLabel,
      tags: [DiagnosticTag.Unnecessary],
    });
  }
}
