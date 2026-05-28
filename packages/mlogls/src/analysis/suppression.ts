import {
  DiagnosticRelatedInformation,
  DiagnosticSeverity,
  Range,
} from "vscode-languageserver";
import {
  DiagnosingContext,
  DiagnosticSuppressionInfo,
} from "../diagnosing_context";
import { CommentLine, SyntaxNode } from "../parser/nodes";
import { ParserDiagnostic } from "../parser/tokenize";
import {
  DiagnosticDirective,
  DiagnosticDirectiveItem,
  DiagnosticDirectiveScope,
} from "../parser/tokens";
import { DiagnosticCode } from "../protocol";
import { getLogicalScopes, LogicalScope } from "./logical_scope";
import { MlogDocument } from "../document";

type IndexedDiagnostic = [index: number, diagnostic: ParserDiagnostic];

function getDiagnosticSuppressionMapping(
  uri: string,
  nodes: SyntaxNode[],
  root: LogicalScope
): [
  DiagnosticSuppressionInfo[],
  IndexedDiagnostic[],
  Set<DiagnosticDirectiveItem>,
] {
  const diagnostics: IndexedDiagnostic[] = [];

  const rootInfo: DiagnosticSuppressionInfo = {
    disabledCodes: new Map(),
    enabledCodes: new Map(),
  };

  const suppressionMapping = new Array<DiagnosticSuppressionInfo>(
    nodes.length
  ).fill(rootInfo);
  const redudantItems = new Set<DiagnosticDirectiveItem>();

  traverse(root, rootInfo, true);

  function traverse(
    block: LogicalScope,
    parent: DiagnosticSuppressionInfo,
    isRoot = false
  ): void {
    if (block.start === block.end) return;
    // skip the label of the block, as directives on it are handled by the parent block
    let start = block.start + (isRoot ? 0 : 1);
    let currentInfo = parent;

    for (const child of block.children) {
      // handle directives before and between the children
      // include the child's label in the range of the parent block,
      // so that -next-line directives on the label are handled correctly
      currentInfo = handleNodes(currentInfo, start, child.start + 1);
      start = child.end;
      traverse(child, currentInfo);
    }

    // handle directives after the children
    handleNodes(currentInfo, start, block.end);
  }

  function handleNodes(
    parent: DiagnosticSuppressionInfo,
    start: number,
    end: number
  ): DiagnosticSuppressionInfo {
    if (start === end) return parent;

    let currentInfo: DiagnosticSuppressionInfo = {
      disabledCodes: new Map(parent.disabledCodes),
      enabledCodes: new Map(parent.enabledCodes),
    };

    /**
     * Keeps track of whether we are still inside the range of a previously
     * found next-line directive, so that we can correctly inherit its
     * suppression rules. This is needed to handle cases where a next-line
     * directive is followed by another directive on the next line.
     */
    let previousNextLineInfo: DiagnosticSuppressionInfo | null = null;

    for (let i = start; i < end; i++) {
      const node = nodes[i];
      if (!previousNextLineInfo) {
        suppressionMapping[i] = currentInfo;
      }
      const parentInfo = previousNextLineInfo ?? currentInfo;
      previousNextLineInfo = null;

      if (node instanceof CommentLine) {
        const directive = node.diagnosticDirective;
        if (!directive) continue;
        switch (directive.scope) {
          case DiagnosticDirectiveScope.currentLine:
            diagnostics.push([
              i,
              {
                range: node,
                code: DiagnosticCode.invalidDiagnosticDirective,
                message:
                  "This kind of diagnostic directive must be placed at the end of a line of code, not on a separate line.",
                severity: DiagnosticSeverity.Error,
              },
            ]);
            break;
          case DiagnosticDirectiveScope.nextLine: {
            // find all lines that are affected by this directive
            let j = i + 1;
            while (
              j < nodes.length &&
              nodes[j].start.line === node.start.line + 1
            ) {
              j++;
            }

            if (j === i + 1) {
              diagnostics.push([
                i,
                {
                  range: node,
                  code: DiagnosticCode.invalidDiagnosticDirective,
                  message:
                    "Diagnostic directives that apply to the next line must be placed directly before a line of code.",
                  severity: DiagnosticSeverity.Error,
                },
              ]);
              break;
            }

            const innerInfo: DiagnosticSuppressionInfo = {
              disabledCodes: new Map(parentInfo.disabledCodes),
              enabledCodes: new Map(parentInfo.enabledCodes),
            };

            handleDirectiveItems(directive, innerInfo, i);
            for (let k = i + 1; k < j; k++) {
              suppressionMapping[k] = innerInfo;
            }

            // only the last syntax node covered by this directive can
            // have a comment with another directive, so we can skip to it directly
            // we also set preserveInfo to avoid the automatic override that happens
            // at the start of each iteration
            i = j - 2;
            previousNextLineInfo = innerInfo;

            break;
          }
          case DiagnosticDirectiveScope.scope:
            currentInfo = {
              disabledCodes: new Map(parentInfo.disabledCodes),
              enabledCodes: new Map(parentInfo.enabledCodes),
            };

            handleDirectiveItems(directive, currentInfo, i);
        }
      } else {
        const comment = node.trailingComment;
        const directive = comment?.diagnosticDirective;
        if (!directive) continue;

        switch (directive.scope) {
          case DiagnosticDirectiveScope.currentLine: {
            const innerInfo: DiagnosticSuppressionInfo = {
              disabledCodes: new Map(parentInfo.disabledCodes),
              enabledCodes: new Map(parentInfo.enabledCodes),
            };
            handleDirectiveItems(directive, innerInfo, i);
            suppressionMapping[i] = innerInfo;

            break;
          }
          case DiagnosticDirectiveScope.nextLine:
            diagnostics.push([
              i,
              {
                range: Range.create(comment.start, comment.end),
                code: DiagnosticCode.invalidDiagnosticDirective,
                message:
                  "Diagnostic directives that apply to the next line must be placed directly before a line of code, not at the end of a line.",
                severity: DiagnosticSeverity.Error,
              },
            ]);
            break;
          case DiagnosticDirectiveScope.scope:
            diagnostics.push([
              i,
              {
                range: Range.create(comment.start, comment.end),
                code: DiagnosticCode.invalidDiagnosticDirective,
                message:
                  "This kind of diagnostic directive cannot be used at the end of a line of code. It must be placed on a separate line before the code it applies to.",
                severity: DiagnosticSeverity.Error,
              },
            ]);
        }
      }
    }

    return currentInfo;
  }

  function handleDirectiveItems(
    directive: DiagnosticDirective,
    region: DiagnosticSuppressionInfo,
    nodeIndex: number
  ) {
    if (directive.items.length === 0) {
      const node = nodes[nodeIndex];
      const comment = node.trailingComment!;

      diagnostics.push([
        nodeIndex,
        {
          message:
            "Diagnostic directives must specify at least one diagnostic code.",
          range: Range.create(comment.start, comment.end),
          code: DiagnosticCode.invalidDiagnosticDirective,
          severity: DiagnosticSeverity.Error,
        },
      ]);
      return;
    }

    for (const item of directive.items) {
      if (!item.code) {
        diagnostics.push([
          nodeIndex,
          {
            message: item.codeExists
              ? "This diagnostic code cannot be disabled."
              : "Invalid diagnostic code.",
            range: Range.create(item.startPosition, item.endPosition),
            code: DiagnosticCode.invalidDiagnosticDirective,
            severity: DiagnosticSeverity.Error,
          },
        ]);
        continue;
      }
      if (directive.isDisable && region.disabledCodes.has(item.code)) {
        redudantItems.add(item);

        const existingItem = region.disabledCodes.get(item.code)!;
        diagnostics.push([
          nodeIndex,
          {
            message: `Diagnostic code '${item.code}' is already disabled.`,
            range: Range.create(item.startPosition, item.endPosition),
            code: DiagnosticCode.unnecessaryDiagnosticDirective,
            severity: DiagnosticSeverity.Error,
            relatedInformation: [
              {
                message: "The diagnostic code is already disabled here",
                location: {
                  uri,
                  range: Range.create(
                    existingItem.startPosition,
                    existingItem.endPosition
                  ),
                },
              },
            ],
          },
        ]);
        continue;
      }

      if (!directive.isDisable && !region.disabledCodes.has(item.code)) {
        redudantItems.add(item);

        // the rule may be enabled by a diagnostic item
        // or it might just be enabled by default
        const existingItem = region.enabledCodes.get(item.code);
        const relatedInformation: DiagnosticRelatedInformation[] = [];
        if (existingItem) {
          relatedInformation.push({
            message: "The diagnostic code is already enabled here",
            location: {
              uri,
              range: Range.create(
                existingItem.startPosition,
                existingItem.endPosition
              ),
            },
          });
        }

        diagnostics.push([
          nodeIndex,
          {
            message: `Diagnostic code '${item.code}' is already enabled.`,
            range: Range.create(item.startPosition, item.endPosition),
            code: DiagnosticCode.unnecessaryDiagnosticDirective,
            severity: DiagnosticSeverity.Error,
            relatedInformation,
          },
        ]);
        continue;
      }

      if (directive.isDisable) {
        region.disabledCodes.set(item.code, item);
        region.enabledCodes.delete(item.code);
      } else {
        region.disabledCodes.delete(item.code);
        region.enabledCodes.set(item.code, item);
      }
    }
  }

  return [suppressionMapping, diagnostics, redudantItems];
}

export function getDiagnosingContext(doc: MlogDocument): DiagnosingContext {
  const root = getLogicalScopes(doc.nodes);
  const [suppressionMapping, indexedDiagnostics, redundantItems] =
    getDiagnosticSuppressionMapping(doc.uri, doc.nodes, root);
  const potentiallyUnusedItems = new Set<DiagnosticDirectiveItem>();

  for (const node of doc.nodes) {
    const comment = node.trailingComment;
    const directive = comment?.diagnosticDirective;

    // only directives that disable diagnostic codes are relevant
    // since enabling directives only generates a warning when the codes
    // already enabled
    if (!directive || !directive.isDisable) continue;

    for (const item of directive.items) {
      if (!item.code) continue;
      if (redundantItems.has(item)) continue;
      potentiallyUnusedItems.add(item);
    }
  }

  const context = new DiagnosingContext(
    [...doc.parserDiagnostics],
    suppressionMapping,
    potentiallyUnusedItems
  );

  for (const [index, diagnostic] of indexedDiagnostics) {
    context.addDiagnostic(index, diagnostic);
  }

  return context;
}
