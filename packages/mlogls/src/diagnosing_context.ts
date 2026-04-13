import { DiagnosticSeverity, Range } from "vscode-languageserver";
import { ParserDiagnostic } from "./parser/tokenize";
import { DiagnosticDirectiveItem } from "./parser/tokens";
import { DiagnosticCode } from "./protocol";
import { SyntaxNode } from "./parser/nodes";

export interface DiagnosticSuppressionInfo {
  /**
   * A map of disabled diagnostic codes and diagnostic directive items that
   * disable them.
   */
  readonly disabledCodes: Map<DiagnosticCode, DiagnosticDirectiveItem>;
  /**
   * A map of manually enabled diagnostic codes and diagnostic directive items
   * that enable them. Used only to report diagnostic directive items that have
   * no effect.
   */
  readonly enabledCodes: Map<DiagnosticCode, DiagnosticDirectiveItem>;
}

export class DiagnosingContext {
  locallyDisabledCodes = new Set<DiagnosticCode>();

  constructor(
    public diagnostics: ParserDiagnostic[],
    /** Maps syntax node indexes to diagnostic suppression info */
    public suppressionMapping: DiagnosticSuppressionInfo[],
    public unusedItems: Set<DiagnosticDirectiveItem>
  ) {}

  isDisabled(index: number, code: DiagnosticCode) {
    if (this.locallyDisabledCodes.has(code)) return true;

    const info = this.suppressionMapping[index];
    return !!info?.disabledCodes.get(code);
  }

  enable(code: DiagnosticCode) {
    this.locallyDisabledCodes.delete(code);
  }

  disable(code: DiagnosticCode) {
    this.locallyDisabledCodes.add(code);
  }

  addDiagnostic(index: number, diagnostic: ParserDiagnostic) {
    if (this.locallyDisabledCodes.has(diagnostic.code)) return;
    const info = this.suppressionMapping[index];

    if (info?.disabledCodes.has(diagnostic.code)) {
      const item = info.disabledCodes.get(diagnostic.code)!;
      this.unusedItems.delete(item);
      return;
    }

    this.diagnostics.push(diagnostic);
  }

  reportUnusedItems(nodes: SyntaxNode[]) {
    // iterate backwards to handle cases where a comment
    // suppresses a unnecessary-diagnostic-directive on the next line
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];

      const comment = node.trailingComment;
      if (!comment) continue;

      const directive = comment.diagnosticDirective;
      if (!directive) continue;

      for (const item of directive.items) {
        if (this.unusedItems.has(item)) {
          this.addDiagnostic(i, {
            code: DiagnosticCode.unnecessaryDiagnosticDirective,
            message: `This diagnostic directive has no effect and can be removed.`,
            severity: DiagnosticSeverity.Warning,
            range: Range.create(
              item.startPosition.line,
              item.startPosition.character,
              item.endPosition.line,
              item.endPosition.character
            ),
          });
        }
      }
    }
  }
}
