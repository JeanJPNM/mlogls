import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver";
import { ignoreToken, maxLabelCount } from "../constants";
import { DiagnosingContext } from "../diagnosing_context";
import { MlogDocument } from "../document";
import {
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
} from "../parser/nodes";
import { DiagnosticCode } from "../protocol";
import { getSpellingSuggestionForName } from "../util/spelling";
import { ParameterType, ParameterUsage } from "../parser/descriptors";

export function validateLabelUsage(
  doc: MlogDocument,
  context: DiagnosingContext
) {
  let instructionCount = 0;
  let labelCount = 0;
  const nodes = doc.nodes;
  const labels = new Map<string, LabelDeclaration>();
  const unusedLabels = new Map<string, number>();

  for (const node of nodes) {
    if (node instanceof InstructionNode) {
      instructionCount++;
    }
  }

  let labelAddress = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node instanceof InstructionNode) {
      labelAddress++;
    }
    if (!(node instanceof LabelDeclaration)) continue;
    labelCount++;

    if (labelCount > maxLabelCount) {
      context.addDiagnostic(i, {
        range: node.nameToken,
        message: `Exceeded maximum label count of ${maxLabelCount}`,
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.tooManyLabels,
      });
    }

    if (labelAddress === instructionCount) {
      context.addDiagnostic(i, {
        range: node.nameToken,
        message: `The label '${node.name}' does not precede any instruction`,
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.labelWithoutInstruction,
      });
    }

    if (!labels.has(node.name)) {
      labels.set(node.name, node);
      unusedLabels.set(node.name, i);
      continue;
    }

    const original = labels.get(node.name)!;

    context.addDiagnostic(i, {
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

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!(node instanceof JumpInstruction)) continue;
    const { destination } = node.data;
    if (!destination) continue;

    if (destination.isNumber()) {
      context.addDiagnostic(i, {
        range: destination,
        message: "Prefer using labels instead of jump addresses",
        severity: DiagnosticSeverity.Hint,
        code: DiagnosticCode.preferJumpLabels,
      });

      const address = destination.value;
      if (address < 0 || address >= instructionCount) {
        context.addDiagnostic(i, {
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

    let message = `Label '${label}' is not declared`;

    const suggestion = getSpellingSuggestionForName(label, labels.keys());

    if (suggestion) message += `. Did you mean '${suggestion}'?`;

    if (!labels.has(label)) {
      context.addDiagnostic(i, {
        range: destination,
        message,
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.undefinedLabel,
      });
    }
  }

  for (const [label, index] of unusedLabels) {
    const node = labels.get(label)!;

    context.addDiagnostic(index, {
      range: node.nameToken,
      message: `Label '${label}' is declared but never used`,
      severity: DiagnosticSeverity.Warning,
      code: DiagnosticCode.unusedLabel,
      tags: [DiagnosticTag.Unnecessary],
    });
  }
}

export function validateVariableUsage(
  doc: MlogDocument,
  context: DiagnosingContext
) {
  const { symbolTable, nodes } = doc;

  const unusedVariables = new Set<string>();

  for (const symbol of symbolTable.localValues()) {
    if (symbol.isBuildingLink) continue;

    unusedVariables.add(symbol.name);
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type !== ParameterType.variable ||
        param.usage === ParameterUsage.write
      )
        continue;

      if (!param.token.isIdentifier()) continue;

      const name = param.token.content;
      if (param.usage === ParameterUsage.ignored && name === ignoreToken)
        continue;
      unusedVariables.delete(name);

      if (symbolTable.has(name)) continue;

      let message = `Variable '${name}' is never declared`;

      const suggestion = getSpellingSuggestionForName(name, symbolTable.keys());

      if (suggestion) message += `. Did you mean '${suggestion}'?`;

      context.addDiagnostic(i, {
        range: param.token,
        message,
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.undefinedVariable,
      });
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type !== ParameterType.variable ||
        param.usage !== ParameterUsage.write
      )
        continue;

      if (param.token.content === ignoreToken) continue;
      if (!unusedVariables.has(param.token.content)) continue;

      context.addDiagnostic(i, {
        range: param.token,
        message: `Variable '${param.token.content}' is declared but never used`,
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.unusedVariable,
        tags: [DiagnosticTag.Unnecessary],
      });
    }
  }
}
