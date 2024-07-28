import {
  ColorInformation,
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  type Connection,
  Diagnostic,
  type InitializeResult,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  Position,
  TextEdit,
  Command,
  CodeAction,
  CodeActionKind,
  TextDocumentIdentifier,
  DocumentSymbol,
  SymbolKind,
  FoldingRange,
  DiagnosticSeverity,
} from "vscode-languageserver";
import { MlogDocument } from "./document";
import { DiagnosticCode, TokenModifiers, TokenTypes } from "./protocol";
import {
  buildingLinkNames,
  builtinGlobals,
  builtinGlobalsSet,
  colorData,
  colorsSet,
  keywords,
  maxInstructionCount,
} from "./constants";
import { ParserDiagnostic, parseColor } from "./parser/tokenize";
import { formatCode } from "./formatter";
import {
  CommentLine,
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  PackColorInstruction,
  SetInstruction,
  getInstructionNames,
} from "./parser/nodes";
import { convertToLabeledJumps, convertToNumberedJumps } from "./refactoring";
import {
  CompletionContext,
  declaredVariables,
  findLabelDefinition,
  findLabelReferences,
  findLabelsInScope,
  findVariableUsageLocations,
  findVariableWriteLocations,
  getLabelBlocks,
  LabelBlock,
  labelDeclarationNameRange,
  TokenSemanticData,
  usedBuildingLinks,
  validateLabelUsage,
  validateUnusedVariables,
} from "./analysis";
import { ParameterType, ParameterUsage } from "./parser/descriptors";
import { findRange, findRangeIndex } from "./util/range_search";

export interface LanguageServerOptions {
  connection: Connection;
}

enum Commands {
  useJumpLabels = "mlogls.useJumpLabels",
  useJumpIndexes = "mlogls.useJumpIndexes",
  convertToColorLiteral = "mlogls.convertToColorLiteral",
  convertToPackColor = "mlogls.convertToPackColor",
}

export function startServer(options: LanguageServerOptions) {
  const { connection } = options;

  const documents = new TextDocuments({
    create(uri, languageId, version, content) {
      return new MlogDocument(uri, languageId, version, content);
    },
    update(document, changes, version) {
      document.update(changes, version);
      return document;
    },
  });

  const commands = {
    convertToLabels(textDocument: TextDocumentIdentifier) {
      const doc = documents.get(textDocument.uri);
      if (!doc) return;

      connection.workspace.applyEdit({
        changes: {
          [textDocument.uri]: convertToLabeledJumps(doc),
        },
      });
    },
    convertToIndexes(textDocument: TextDocumentIdentifier) {
      const doc = documents.get(textDocument.uri);
      if (!doc) return;

      connection.workspace.applyEdit({
        changes: {
          [textDocument.uri]: convertToNumberedJumps(doc),
        },
      });
    },
    convertToColorLiteral(
      textDocument: TextDocumentIdentifier,
      start: Position
    ) {
      const doc = documents.get(textDocument.uri);
      if (!doc) return;
      const node = getSelectedSyntaxNode(doc, start);

      if (!(node instanceof PackColorInstruction)) return;

      if (!node.isConstant()) return;
      const { data } = node;
      const { result } = data;
      const color = node.getColor();

      const red = Math.round(color.red * 255);
      const green = Math.round(color.green * 255);
      const blue = Math.round(color.blue * 255);
      const alpha = Math.round(color.alpha * 255);

      if (!data.red) return;
      const last = data.alpha ?? data.blue ?? data.green ?? data.red;

      const c = (n: number) => n.toString(16).padStart(2, "0");
      const literal =
        alpha === 255
          ? `%${c(red)}${c(green)}${c(blue)}`
          : `%${c(red)}${c(green)}${c(blue)}${c(alpha)}`;

      const newText = `set ${result!.content} ${literal}`;
      connection.workspace.applyEdit({
        changes: {
          [textDocument.uri]: [
            // using last.end instead of node.end to preserve comments
            TextEdit.replace(Range.create(node.start, last.end), newText),
          ],
        },
      });
    },
    convertToPackColor(textDocument: TextDocumentIdentifier, start: Position) {
      const doc = documents.get(textDocument.uri);
      if (!doc) return;
      const node = getSelectedSyntaxNode(doc, start);

      if (!(node instanceof SetInstruction)) return;

      const { variable, value } = node.data;

      if (!value?.isColorLiteral()) return;

      const { red, green, blue, alpha } = parseColor(value.content.slice(1));

      const c = (value: number) => Math.round(value * 10 ** 3) / 10 ** 3;

      const newText = `packcolor ${variable!.content} ${c(red)} ${c(green)} ${c(
        blue
      )} ${c(alpha)}`;
      connection.workspace.applyEdit({
        changes: {
          [textDocument.uri]: [
            // using last.end instead of node.end to preserve comments
            TextEdit.replace(Range.create(node.start, value.end), newText),
          ],
        },
      });
    },
  };

  connection.onInitialize((params) => {
    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
          resolveProvider: false,
          completionItem: {
            labelDetailsSupport: true,
          },
        },
        colorProvider: true,
        semanticTokensProvider: {
          documentSelector: null,
          full: true,
          legend: {
            tokenTypes: TokenTypes.keys,
            tokenModifiers: TokenModifiers.keys,
          },
        },
        signatureHelpProvider: {
          triggerCharacters: [" "],
        },
        documentFormattingProvider: true,
        codeActionProvider: true,
        executeCommandProvider: {
          commands: Object.values(Commands),
        },
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: {
          prepareProvider: true,
        },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        hoverProvider: true,
      },
    };

    return result;
  });

  connection.languages.semanticTokens.on((params) => {
    const doc = documents.get(params.textDocument.uri);
    const lines = doc?.lines;
    const data: number[] = [];

    if (!lines || lines.length === 0) return { data };

    const tokens: TokenSemanticData[] = [];

    for (const node of doc.nodes) {
      node.provideTokenSemantics(tokens);
    }

    let previous = Position.create(0, 0);

    for (const { token, type, modifiers } of tokens) {
      const current = token.start;

      const deltaLine = current.line - previous.line;
      const deltaStart =
        deltaLine === 0
          ? current.character - previous.character
          : current.character;
      const length = token.end.character - token.start.character;

      const tokenModifiers = modifiers ?? 0;

      data.push(deltaLine);
      data.push(deltaStart);
      data.push(length);
      data.push(type);
      data.push(tokenModifiers);

      previous = current;
    }

    return { data };
  });

  connection.onDocumentColor((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const { nodes } = doc;
    const colors: ColorInformation[] = [];

    for (const node of nodes) {
      if (node instanceof PackColorInstruction) {
        if (!node.isConstant()) continue;
        const { data } = node;
        if (!data.red) continue;
        const { red, green, blue, alpha } = node.getColor();

        const last = data.alpha ?? data.blue ?? data.green ?? data.red;

        colors.push({
          color: { red, green, blue, alpha },
          range: Range.create(data.red.start, last.end),
        });

        continue;
      }

      for (const token of node.line.tokens) {
        if (token.isIdentifier() && colorsSet.has(token.content)) {
          // remove the leading @
          const name = token.content.slice(1);
          const color = parseColor(colorData[name]);

          colors.push({
            range: Range.create(token.start, token.end),
            color,
          });
        } else if (token.isColorLiteral()) {
          colors.push({
            range: Range.create(token.start, token.end),
            color: {
              red: token.red,
              green: token.green,
              blue: token.blue,
              alpha: token.alpha,
            },
          });
        } else if (token.isString()) {
          for (const tag of token.colorTags) {
            if (!tag.color) continue;

            const start = token.start.character + tag.nameStart;
            const end = token.start.character + tag.nameEnd;

            colors.push({
              range: Range.create(
                token.start.line,
                start,
                token.start.line,
                end
              ),
              color: tag.color,
            });
          }
        }
      }
    }
    return colors;
  });

  connection.onColorPresentation((params) => {
    const { color, range, textDocument } = params;

    const doc = documents.get(textDocument.uri);
    if (!doc) return [];

    const node = getSelectedSyntaxNode(doc, range.start);
    if (node instanceof PackColorInstruction) {
      const { red, green, blue, alpha } = color;
      // three digits of precision is enough, since each "step" has a value of 0,255
      const r = (value: number) => Math.round(value * 10 ** 3) / 10 ** 3;
      return [
        {
          label: `${r(red)} ${r(green)} ${r(blue)} ${r(alpha)}`,
        },
      ];
    }

    const token = node?.line.tokens.find((token) =>
      containsPosition(token, range.start)
    );

    const red = Math.round(color.red * 255);
    const green = Math.round(color.green * 255);
    const blue = Math.round(color.blue * 255);
    const alpha = Math.round(color.alpha * 255);

    const c = (n: number) => n.toString(16).padStart(2, "0");
    const prefix = token?.isString() ? "#" : "%";
    const label =
      alpha === 255
        ? `${prefix}${c(red)}${c(green)}${c(blue)}`
        : `${prefix}${c(red)}${c(green)}${c(blue)}${c(alpha)}`;

    return [{ label }];
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const { position } = params;

    const nodeIndex = getSelectedSyntaxNodeIndex(doc, position);
    const node = doc.nodes[nodeIndex];
    const line = node?.line;

    const selectedToken = line?.tokens.find((token) =>
      containsPosition(token, position)
    );

    const range = selectedToken
      ? Range.create(selectedToken.start, selectedToken.end)
      : Range.create(params.position, params.position);

    // show completions for instructions if:
    // - no token line is selected
    // - the cursor is contained within the first token of the selected token line
    if (!line || selectedToken === line.tokens[0]) {
      return {
        items: getInstructionNames().map((code) => ({
          label: code,
          kind: CompletionItemKind.Keyword,
        })),
        itemDefaults: {
          editRange: range,
        },
        isIncomplete: false,
      } satisfies CompletionList;
    }

    // provide completions for string color tags
    if (selectedToken?.isString()) {
      const offset = position.character - selectedToken.start.character;
      for (const tag of selectedToken.colorTags) {
        if (tag.nameStart > offset || tag.nameEnd < offset) continue;

        const completions = CompletionList.create();

        completions.itemDefaults = {
          editRange: Range.create(
            selectedToken.start.line,
            selectedToken.start.character + tag.nameStart,
            selectedToken.start.line,
            selectedToken.start.character + tag.nameEnd
          ),
        };

        for (const name in colorData) {
          completions.items.push({
            label: name,
            kind: CompletionItemKind.Color,
          });
        }

        return completions;
      }
    }

    const context: CompletionContext = {
      getVariableCompletions() {
        const completions: CompletionItem[] = [];
        for (const keyword of keywords) {
          completions.push({
            label: keyword,
            kind: CompletionItemKind.Keyword,
            sortText: `0${keyword}`,
          });
        }

        for (const global of builtinGlobals) {
          completions.push({
            label: global,
            kind: CompletionItemKind.Variable,
            sortText: `1${global}`,
          });
        }

        for (const variable of declaredVariables(doc.nodes)) {
          completions.push({
            label: variable,
            kind: CompletionItemKind.Variable,
            sortText: `0${variable}`,
          });
        }

        const usedLinks = usedBuildingLinks(doc.nodes);

        for (const name of buildingLinkNames) {
          const limit = usedLinks.get(name) ?? 1;

          for (let i = 1; i <= limit; i++) {
            completions.push({
              label: `${name}${i}`,
              kind: CompletionItemKind.Variable,
              sortText: `1${name}${i}`,
            });
          }
        }

        return completions;
      },
      getLabelCompletions() {
        return [...findLabelsInScope(doc.nodes, nodeIndex)].map((label) => ({
          label,
          kind: CompletionItemKind.Function,
        }));
      },
    };

    const completions = CompletionList.create(
      node.provideCompletionItems(context, position.character)
    );

    completions.itemDefaults = {
      editRange: range,
    };
    return completions;
  });

  connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const { position } = params;

    const node = getSelectedSyntaxNode(doc, params.position);
    if (!node) return;

    return node.provideSignatureHelp(position.character);
  });

  connection.onDocumentFormatting((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;
    if (doc.lines.length === 0) return;
    const { options } = params;

    const formattedCode = formatCode({
      doc,
      insertSpaces: options.insertSpaces,
      tabSize: options.tabSize,
      insertFinalNewline: options.insertFinalNewline,
    });

    return [
      TextEdit.replace(Range.create(0, 0, doc.lineCount, 0), formattedCode),
    ];
  });

  connection.onCodeAction((params) => {
    const { range, textDocument } = params;
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    const { start, end } = range;

    let hasIndexJump = false;
    let hasLabelJump = false;

    const actions: (CodeAction | Command)[] = [];

    for (const node of getPartiallySelectedSyntaxNodes(doc, start, end)) {
      for (const diagnostic of params.context.diagnostics) {
        if (!containsPosition(node, diagnostic.range.start)) continue;

        node.provideCodeActions(doc, diagnostic, actions);
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

        actions.push({
          title: "Convert to color literal",
          kind: CodeActionKind.Refactor,
          arguments: [params.textDocument, node.start],
          command: Commands.convertToColorLiteral,
        });
      } else if (node instanceof SetInstruction) {
        const { value } = node.data;
        if (!value?.isColorLiteral()) continue;

        actions.push({
          title: "Convert to packcolor instruction",
          kind: CodeActionKind.Refactor,
          arguments: [params.textDocument, node.start],
          command: Commands.convertToPackColor,
        });
      }
    }

    if (hasLabelJump) {
      actions.push({
        title: "Use indexes for all jumps",
        kind: CodeActionKind.RefactorRewrite,
        command: Commands.useJumpIndexes,
        arguments: [textDocument],
      });
    }

    if (hasIndexJump) {
      actions.push({
        title: "Use labels for all jumps",
        kind: CodeActionKind.RefactorRewrite,
        command: Commands.useJumpLabels,
        arguments: [textDocument],
      });
    }

    return actions;
  });

  connection.onExecuteCommand((params) => {
    const { command } = params;

    switch (command) {
      case Commands.useJumpLabels: {
        const [textDocument] = params.arguments ?? [];
        if (!TextDocumentIdentifier.is(textDocument)) return;

        commands.convertToLabels(textDocument);
        break;
      }

      case Commands.useJumpIndexes: {
        const [textDocument] = params.arguments ?? [];
        if (!TextDocumentIdentifier.is(textDocument)) return;

        commands.convertToIndexes(textDocument);
        break;
      }

      case Commands.convertToColorLiteral: {
        const [textDocument, start] = params.arguments ?? [];
        if (!TextDocumentIdentifier.is(textDocument) || !Position.is(start))
          return;
        commands.convertToColorLiteral(textDocument, start);
      }

      case Commands.convertToPackColor: {
        const [textDocument, start] = params.arguments ?? [];
        if (!TextDocumentIdentifier.is(textDocument) || !Position.is(start))
          return;
        commands.convertToPackColor(textDocument, start);
      }
    }
  });

  connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const { position } = params;
    const node = getSelectedSyntaxNode(doc, position);

    if (
      node instanceof LabelDeclaration &&
      containsPosition(node.nameToken, position)
    ) {
      return {
        uri: params.textDocument.uri,
        range: labelDeclarationNameRange(node.nameToken),
      };
    }

    if (!(node instanceof InstructionNode)) return;

    const selectedParameter = node.parameters.find((param) =>
      containsPosition(param.token, position)
    );

    if (!selectedParameter?.token.isIdentifier()) return;

    const name = selectedParameter.token.content;

    switch (selectedParameter.type) {
      case ParameterType.variable:
        return findVariableWriteLocations(name, doc.nodes).map((location) => ({
          uri: params.textDocument.uri,
          range: location,
        }));
      case ParameterType.label: {
        const location = findLabelDefinition(name, doc.nodes);
        if (!location) return;

        return {
          uri: params.textDocument.uri,
          range: location,
        };
      }
    }
  });

  connection.onReferences((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const { position } = params;

    const node = getSelectedSyntaxNode(doc, position);

    if (
      node instanceof LabelDeclaration &&
      containsPosition(node.nameToken, position)
    ) {
      const locations = findLabelReferences(node.name, doc.nodes);

      return locations.map((location) => ({
        uri: params.textDocument.uri,
        range: location,
      }));
    }

    if (!(node instanceof InstructionNode)) return;

    const selectedParameter = node.parameters.find((param) =>
      containsPosition(param.token, position)
    );

    if (!selectedParameter?.token.isIdentifier()) return;

    const name = selectedParameter.token.content;

    switch (selectedParameter.type) {
      case ParameterType.variable:
      case ParameterType.buildingLink:
      case ParameterType.readonlyGlobal:
        return findVariableUsageLocations(name, doc.nodes).map((location) => ({
          uri: params.textDocument.uri,
          range: location,
        }));
      case ParameterType.label:
        return findLabelReferences(name, doc.nodes).map((location) => ({
          uri: params.textDocument.uri,
          range: location,
        }));
    }
  });

  connection.onRenameRequest((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const { position, newName } = params;

    const node = getSelectedSyntaxNode(doc, position);

    if (
      node instanceof LabelDeclaration &&
      containsPosition(node.nameToken, position)
    ) {
      const locations = findLabelReferences(node.name, doc.nodes);

      return {
        changes: {
          [params.textDocument.uri]: locations.map((location) => ({
            range: location,
            newText: newName,
          })),
        },
      };
    }

    if (!(node instanceof InstructionNode)) return;

    const selectedParameter = node.parameters.find((param) =>
      containsPosition(param.token, position)
    );

    if (!selectedParameter?.token.isIdentifier()) return;

    const name = selectedParameter.token.content;

    switch (selectedParameter.type) {
      case ParameterType.variable:
        const locations = findVariableUsageLocations(name, doc.nodes);

        return {
          changes: {
            [params.textDocument.uri]: locations.map((location) => ({
              range: location,
              newText: newName,
            })),
          },
        };
      case ParameterType.label:
        const labelReferences = findLabelReferences(name, doc.nodes);

        return {
          changes: {
            [params.textDocument.uri]: labelReferences.map((location) => ({
              range: location,
              newText: newName,
            })),
          },
        };
    }
  });

  connection.onPrepareRename((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const { position } = params;

    const node = getSelectedSyntaxNode(doc, position);

    if (
      node instanceof LabelDeclaration &&
      containsPosition(node.nameToken, position)
    ) {
      return {
        range: labelDeclarationNameRange(node.nameToken),
        placeholder: node.name,
      };
    }

    if (!(node instanceof InstructionNode)) return;

    const selectedParameter = node.parameters.find((param) =>
      containsPosition(param.token, position)
    );

    if (!selectedParameter?.token.isIdentifier()) return;

    const name = selectedParameter.token.content;

    switch (selectedParameter.type) {
      case ParameterType.variable:
      case ParameterType.label:
        return {
          range: selectedParameter.token,
          placeholder: name,
        };
    }
  });

  connection.onDocumentSymbol((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const { nodes } = doc;
    const root = getLabelBlocks(nodes);
    const symbols: DocumentSymbol[] = [];

    const end = root.children[0]?.start ?? root.end;
    for (let i = 0; i < end; i++) {
      const node = nodes[i];
      if (!(node instanceof InstructionNode)) continue;

      for (const param of node.parameters) {
        if (
          param.type === ParameterType.variable &&
          param.usage === ParameterUsage.write
        ) {
          symbols.push({
            name: param.token.content,
            kind: SymbolKind.Variable,
            range: param.token,
            selectionRange: param.token,
          });
        }
      }
    }

    for (const child of root.children) {
      symbols.push(getBlockSymbols(child));
    }

    function getBlockSymbols(block: LabelBlock): DocumentSymbol {
      const label = nodes[block.start] as LabelDeclaration;
      const lastNode = nodes[block.end - 1];
      const end = block.children[0]?.start ?? block.end;
      const symbols: DocumentSymbol[] = [];
      for (let i = block.start; i < end; i++) {
        const node = nodes[i];
        if (!(node instanceof InstructionNode)) continue;

        for (const param of node.parameters) {
          if (
            param.type === ParameterType.variable &&
            param.usage === ParameterUsage.write
          ) {
            symbols.push({
              name: param.token.content,
              kind: SymbolKind.Variable,
              range: param.token,
              selectionRange: param.token,
            });
          }
        }
      }

      for (const child of block.children) {
        symbols.push(getBlockSymbols(child));
      }

      return {
        name: label.name,
        kind: SymbolKind.Function,
        range: Range.create(label.start, lastNode.end),
        selectionRange: labelDeclarationNameRange(label.nameToken),
        children: symbols,
      };
    }

    return symbols;
  });

  connection.onFoldingRanges((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const { nodes } = doc;

    const ranges: FoldingRange[] = [];

    const root = getLabelBlocks(doc.nodes);

    function traverse(block: LabelBlock) {
      ranges.push({
        startLine: nodes[block.start].start.line,
        endLine: nodes[block.end - 1].end.line,
      });

      for (const child of block.children) {
        traverse(child);
      }
    }

    for (const child of root.children) {
      traverse(child);
    }

    // this handles #region/#endregion folding

    // the comment token includes the leading #
    // so we need to add it to the regex
    const regionPattern = /^#\s*#?region\b/;
    const endRegionPattern = /^#\s*#?endregion\b/;
    const regionStack: CommentLine[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!(node instanceof CommentLine)) continue;

      const token = node.line.tokens[0];

      if (regionPattern.test(token.content)) {
        regionStack.push(node);
        continue;
      }

      if (endRegionPattern.test(token.content)) {
        const start = regionStack.pop();
        if (start === undefined) continue;
        // syntax nodes only span a single line
        ranges.push({
          startLine: start.start.line,
          endLine: node.start.line,
        });
      }
    }

    return ranges;
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);

    if (!doc) return;

    const { position } = params;

    const node = getSelectedSyntaxNode(doc, position);

    if (!node) return;

    return node.provideHover(params.position.character);
  });

  documents.onDidChangeContent((change) => {
    // TODO: add diagnostics for unused variables (script-wide)
    const doc = documents.get(change.document.uri);
    if (!doc) return;

    const parserDiagnostics: ParserDiagnostic[] = [...doc.parserDiagnostics];

    let instructionCount = 0;
    for (const node of doc.nodes) {
      node.provideDiagnostics(parserDiagnostics);
      if (node instanceof InstructionNode) {
        instructionCount++;

        if (instructionCount > maxInstructionCount) {
          parserDiagnostics.push({
            range: node,
            message: `Exceeded maximum instruction count of ${maxInstructionCount}`,
            severity: DiagnosticSeverity.Error,
            code: DiagnosticCode.tooManyInstructions,
          });
        }
      }
    }

    validateLabelUsage(doc, parserDiagnostics);
    validateUnusedVariables(doc.nodes, parserDiagnostics);

    const diagnostics: Diagnostic[] = [];

    for (const diagnostic of parserDiagnostics) {
      diagnostics.push({
        ...diagnostic,
        source: "mlog",
      });
    }

    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  });

  documents.onDidClose((e) => {
    const { document } = e;

    // remove existing warnings and error messages
    // since each file is standalone
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  // Make the text document manager listen on the connection
  // for open, change and close text document events
  documents.listen(connection);

  // Listen on the connection
  connection.listen();
}

function getSelectedSyntaxNodeIndex(doc: MlogDocument, position: Position) {
  return findRangeIndex(doc.nodes, position);
}

function getSelectedSyntaxNode(doc: MlogDocument, position: Position) {
  return findRange(doc.nodes, position);
}

function* getPartiallySelectedSyntaxNodes(
  doc: MlogDocument,
  start: Position,
  end: Position
) {
  for (const node of doc.nodes) {
    if (node.start.line < start.line) continue;
    if (node.start.line > end.line) break;

    if (node.end.character < start.character) continue;
    if (node.start.character > end.character) break;

    yield node;
  }
}

function containsPosition(range: Range, position: Position) {
  return (
    range.start.line === position.line &&
    range.start.character <= position.character &&
    position.character <= range.end.character
  );
}
