import {
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  Command,
  Diagnostic,
  Range,
} from "vscode-languageserver";
import { MlogDocument } from "../document";
import {
  CommandCode,
  createCommandAction,
  DiagnosticCode,
  isDiagnosticCode,
} from "./protocol";
import {
  containsPosition,
  getPartiallySelectedSyntaxNodes,
  getSelectedSyntaxNode,
} from "./common";
import {
  JumpInstruction,
  LabelDeclaration,
  PackColorInstruction,
  SetInstruction,
} from "../parser/nodes";

export function getCodeActions(
  doc: MlogDocument,
  context: CodeActionContext,
  range: Range
) {
  const { start, end } = range;

  let hasIndexJump = false;
  let hasLabelJump = false;

  const actions: (CodeAction | Command)[] = [];

  const codes = new Map<DiagnosticCode, Diagnostic[]>();

  for (const diagnostic of context.diagnostics) {
    if (!isDiagnosticCode(diagnostic.code)) continue;

    if (!codes.has(diagnostic.code)) {
      codes.set(diagnostic.code, []);
    }

    codes.get(diagnostic.code)!.push(diagnostic);
  }

  for (const diagnostic of context.diagnostics) {
    if (
      diagnostic.code !== DiagnosticCode.unnecessaryDiagnosticDirective &&
      diagnostic.code !== DiagnosticCode.invalidDiagnosticDirective
    )
      continue;

    const node = getSelectedSyntaxNode(doc, diagnostic.range.start);
    if (!node?.trailingComment?.diagnosticDirective) continue;

    for (const item of node.trailingComment.diagnosticDirective.items) {
      const start = item.startPosition;
      const end = item.endPosition;

      if (
        start.character === diagnostic.range.start.character &&
        end.character === diagnostic.range.end.character
      ) {
        actions.push(
          createCommandAction({
            title: "Remove this diagnostic directive",
            command: CommandCode.removeDiagnosticDirective,
            arguments: [{ uri: doc.uri }, diagnostic.range.start],
            diagnostics: [diagnostic],
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
          })
        );
      }
    }
  }

  for (const node of getPartiallySelectedSyntaxNodes(doc, start, end)) {
    for (const diagnostic of context.diagnostics) {
      if (!containsPosition(node, diagnostic.range.start)) continue;

      node.provideCodeActions(doc.unit, diagnostic, actions);
    }

    for (const [code, diagnostics] of codes) {
      const selected = diagnostics.filter((diagnostic) =>
        containsPosition(node, diagnostic.range.start)
      );
      if (selected.length === 0) continue;

      actions.push(
        createCommandAction({
          title: `Disable '${code}' diagnostic for this line`,
          command: CommandCode.disableDiagnosticForLine,
          arguments: [{ uri: doc.uri }, node.start, code],
          diagnostics: selected,
          kind: CodeActionKind.QuickFix,
        })
      );
    }

    if (node instanceof JumpInstruction) {
      const { destination } = node.data;
      if (destination?.isIdentifier()) {
        hasLabelJump = true;
      } else if (destination?.isNumber()) {
        hasIndexJump = true;
      }
    } else if (node instanceof LabelDeclaration) {
      hasLabelJump = true;
    } else if (node instanceof PackColorInstruction) {
      const { red, green, blue, alpha } = node.data;
      if (!red) continue;
      if (green && !green.isNumber()) continue;
      if (blue && !blue.isNumber()) continue;
      if (alpha && !alpha.isNumber()) continue;

      actions.push(
        createCommandAction({
          title: "Convert to color literal",
          command: CommandCode.convertToColorLiteral,
          arguments: [{ uri: doc.uri }, node.start],
          kind: CodeActionKind.Refactor,
        })
      );
    } else if (node instanceof SetInstruction) {
      const { value } = node.data;
      if (!value?.isColorLiteral()) continue;

      actions.push(
        createCommandAction({
          title: "Convert to packcolor instruction",
          kind: CodeActionKind.Refactor,
          arguments: [{ uri: doc.uri }, node.start],
          command: CommandCode.convertToPackColor,
        })
      );
    }
  }

  for (const [code, diagnostics] of codes) {
    actions.push(
      createCommandAction({
        title: `Disable '${code}' diagnostic for this file`,
        command: CommandCode.disableDiagnosticForFile,
        arguments: [{ uri: doc.uri }, code],
        diagnostics,
        kind: CodeActionKind.QuickFix,
      })
    );
  }

  if (hasLabelJump) {
    actions.push(
      createCommandAction({
        title: "Use indexes for all jumps",
        kind: CodeActionKind.RefactorRewrite,
        command: CommandCode.useJumpIndexes,
        arguments: [{ uri: doc.uri }],
      })
    );
  }

  if (hasIndexJump) {
    actions.push(
      createCommandAction({
        title: "Use labels for all jumps",
        kind: CodeActionKind.RefactorRewrite,
        command: CommandCode.useJumpLabels,
        arguments: [{ uri: doc.uri }],
      })
    );
  }

  return actions;
}
