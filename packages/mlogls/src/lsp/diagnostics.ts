import { Diagnostic, Range, DiagnosticSeverity } from "vscode-languageserver";
import { getDiagnosingContext } from "../analysis/suppression";
import {
  validateLabelUsage,
  validateVariableUsage,
} from "../analysis/validation";
import { maxInstructionCount } from "../constants";
import { MlogDocument } from "../document";
import { InstructionNode } from "../parser/nodes";
import { DiagnosticCode } from "./protocol";

export function getDocumentDiagnostics(doc: MlogDocument): Diagnostic[] {
  const context = getDiagnosingContext(doc.unit, doc.parserDiagnostics);

  let instructionCount = 0;
  let tooManyInstructionsRange: { start: number; end: number } | undefined;

  for (let i = 0; i < doc.nodes.length; i++) {
    const node = doc.nodes[i];
    node.provideDiagnostics(doc.unit, context, i);

    if (node instanceof InstructionNode) {
      instructionCount++;

      if (instructionCount > maxInstructionCount) {
        if (tooManyInstructionsRange === undefined) {
          tooManyInstructionsRange = { start: i, end: i };
        } else {
          tooManyInstructionsRange.end = i;
        }
      }
    }
  }

  if (tooManyInstructionsRange) {
    const { start, end } = tooManyInstructionsRange;

    context.addDiagnostic(start, {
      range: Range.create(doc.nodes[start].start, doc.nodes[end].end),
      message: `Exceeded maximum instruction count of ${maxInstructionCount}`,
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.tooManyInstructions,
    });
  }

  validateLabelUsage(doc.unit, context);
  validateVariableUsage(doc.unit, context);
  context.reportUnusedItems(doc.nodes);

  const diagnostics: Diagnostic[] = [];

  for (const diagnostic of context.diagnostics) {
    diagnostics.push({
      ...diagnostic,
      source: "mlog",
    });
  }

  return diagnostics;
}
