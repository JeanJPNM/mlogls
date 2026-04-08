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
import { MlogDocument } from "./document";
import { DiagnosticCode } from "./protocol";
import { buildingLinkNames, ignoreToken, maxLabelCount } from "./constants";
import {
  DiagnosticDirective,
  DiagnosticDirectiveItem,
  DiagnosticDirectiveScope,
  ParserPosition,
  TextToken,
} from "./parser/tokens";
import { NameSymbol, SymbolFlags, SymbolTable } from "./symbol";
import { getSpellingSuggestionForName } from "./util/spelling";
import {
  DiagnosingContext,
  DiagnosticSuppressionInfo,
} from "./diagnosing_context";
import { ParserDiagnostic } from "./parser/tokenize";

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

  return table;
}

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
  let lineStart = new ParserPosition(-1, 0);

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

export function isBuildingLink(name: string) {
  const match = buildingNamePattern.exec(name);
  if (!match) return false;

  const linkName = match[1];
  return buildingLinkNames.has(linkName);
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

type IndexedDiagnostic = [index: number, diagnostic: ParserDiagnostic];

function getDiagnosticSuppressionMapping(
  uri: string,
  nodes: SyntaxNode[],
  root: LabelBlock
): [DiagnosticSuppressionInfo[], IndexedDiagnostic[]] {
  const diagnostics: IndexedDiagnostic[] = [];

  const rootInfo: DiagnosticSuppressionInfo = {
    disabledCodes: new Map(),
  };

  const suppressionMapping = new Array(nodes.length).fill(rootInfo);

  traverse(root, rootInfo);

  function traverse(
    block: LabelBlock,
    parent: DiagnosticSuppressionInfo
  ): void {
    if (block.start === block.end) return;

    const start = block.start;
    const end = block.children[0]?.start ?? block.end;

    let currentInfo: DiagnosticSuppressionInfo = {
      disabledCodes: new Map(parent.disabledCodes),
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
            };

            handleDirectiveItems(directive, currentInfo, i);
        }
      } else if (node instanceof InstructionNode) {
        const comment = node.trailingComment;
        const directive = comment?.diagnosticDirective;
        if (!directive) continue;

        switch (directive.scope) {
          case DiagnosticDirectiveScope.currentLine: {
            const innerInfo: DiagnosticSuppressionInfo = {
              disabledCodes: new Map(parentInfo.disabledCodes),
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

    for (const child of block.children) {
      traverse(child, currentInfo);
    }
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
        const existingItem = region.disabledCodes.get(item.code)!;
        diagnostics.push([
          nodeIndex,
          {
            message: `Diagnostic code '${item.code}' is already enabled.`,
            range: Range.create(item.startPosition, item.endPosition),
            code: DiagnosticCode.unnecessaryDiagnosticDirective,
            severity: DiagnosticSeverity.Error,
            relatedInformation: [
              {
                message: "The diagnostic code is already enabled here",
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

      if (directive.isDisable) {
        region.disabledCodes.set(item.code, item);
      } else {
        region.disabledCodes.delete(item.code);
      }
    }
  }

  return [suppressionMapping, diagnostics];
}

export function getDiagnosingContext(doc: MlogDocument): DiagnosingContext {
  const root = getLabelBlocks(doc.nodes);
  const [suppressionMapping, indexedDiagnostics] =
    getDiagnosticSuppressionMapping(doc.uri, doc.nodes, root);
  const directiveItems = new Set<DiagnosticDirectiveItem>();

  for (const node of doc.nodes) {
    if (node instanceof CommentLine) {
      const directive = node.diagnosticDirective;
      if (!directive) continue;

      for (const item of directive.items) {
        if (!item.code) continue;
        directiveItems.add(item);
      }
    } else if (node instanceof InstructionNode) {
      const directive = node.trailingComment?.diagnosticDirective;
      if (!directive) continue;

      for (const item of directive.items) {
        if (!item.code) continue;
        directiveItems.add(item);
      }
    }
  }

  const context = new DiagnosingContext(
    [...doc.parserDiagnostics],
    suppressionMapping,
    directiveItems
  );

  for (const [index, diagnostic] of indexedDiagnostics) {
    context.addDiagnostic(index, diagnostic);
  }

  return context;
}
