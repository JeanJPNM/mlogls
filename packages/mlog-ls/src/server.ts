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
} from "vscode-languageserver";
import { MlogDocument } from "./document";
import { TokenModifiers, TokenTypes } from "./protocol";
import { builtinGlobals, keywordConstants } from "./constants";
import { ParserDiagnostic, TokenLine, parseColor } from "./parser/tokenize";
import { formatCode } from "./formatter";
import {
  InstructionNode,
  JumpInstruction,
  LabelDeclaration,
  PackColorInstruction,
  getInstructionNames,
} from "./parser/nodes";
import { convertToLabeledJumps, convertToNumberedJumps } from "./refactoring";
import {
  CompletionContext,
  declaredVariables,
  findLabelDefinition,
  findLabelReferences,
  findLabels,
  findVariableUsageLocations,
  findVariableWriteLocations,
  labelDeclarationNameRange,
  TokenSemanticData,
} from "./analysis";
import { ParameterType, ParameterUsage } from "./parser/descriptors";

export interface LanguageServerOptions {
  connection: Connection;
}

enum Commands {
  useJumpLabels = "mlog-ls.useJumpLabels",
  useJumpIndexes = "mlog-ls.useJumpIndexes",
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
      let tokenType = type ?? TokenTypes.variable;

      let tokenModifiers = modifiers ?? 0;

      if (token.isComment) {
        tokenType = TokenTypes.comment;
      } else if (token.isColorLiteral || token.isNumber) {
        tokenType = TokenTypes.number;
      } else if (token.isString) {
        tokenType = TokenTypes.string;
      } else if (!type && token.content.startsWith("@")) {
        tokenModifiers = TokenModifiers.readonly;
      } else if (token.isLabel) {
        tokenType = TokenTypes.function;
      }

      data.push(deltaLine);
      data.push(deltaStart);
      data.push(length);
      data.push(tokenType);
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
        const { red, green, blue, alpha } = node.data;
        if (!red) continue;
        if (green && !green.isNumber) continue;
        if (blue && !blue.isNumber) continue;
        if (alpha && !alpha.isNumber) continue;

        const last = alpha ?? blue ?? green ?? red;

        colors.push({
          color: {
            red: Number(red?.content) || 0,
            green: Number(green?.content) || 0,
            blue: Number(blue?.content) || 0,
            alpha: Number(alpha?.content) || 1,
          },
          range: Range.create(red.start, last.end),
        });

        continue;
      }

      for (const token of node.line.tokens) {
        if (!token.isColorLiteral) continue;
        const color = parseColor(token.content.slice(1));

        colors.push({
          range: Range.create(token.start, token.end),
          color,
        });
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

    const red = Math.round(color.red * 255);
    const green = Math.round(color.green * 255);
    const blue = Math.round(color.blue * 255);
    const alpha = Math.round(color.alpha * 255);

    const c = (n: number) => n.toString(16).padStart(2, "0");
    const label =
      alpha === 255
        ? `%${c(red)}${c(green)}${c(blue)}`
        : `%${c(red)}${c(green)}${c(blue)}${c(alpha)}`;

    return [{ label }];
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const { position } = params;

    const node = getSelectedSyntaxNode(doc, position);
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

    const context: CompletionContext = {
      getVariableCompletions() {
        return [...builtinGlobals, ...declaredVariables(doc.nodes)].map(
          (variable): CompletionItem => ({
            label: variable,
            kind:
              keywordConstants.indexOf(variable) === -1
                ? CompletionItemKind.Variable
                : CompletionItemKind.Keyword,
            sortText: variable.startsWith("@")
              ? `1${variable}`
              : `0${variable}`,
          })
        );
      },
      // TODO: only give completions for labels
      // accessible in the current "scope"
      getLabelCompletions() {
        return [...findLabels(doc.nodes)].map((label) => ({
          label,
          kind: CompletionItemKind.Function,
        }));
      },
    };

    const completionList = CompletionList.create(
      node.provideCompletionItems(context, position.character)
    );

    completionList.itemDefaults = {
      editRange: range,
    };
    return completionList;
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
      if (node instanceof JumpInstruction) {
        const { destination } = node.data;
        switch (destination?.type) {
          case "identifier":
            hasLabelJump = true;
            break;
          case "number":
            hasIndexJump = true;
            break;
        }
      }
    }

    if (hasLabelJump) {
      actions.push({
        title: "Use indexes for all jumps",
        kind: CodeActionKind.RefactorRewrite,
        command: {
          command: Commands.useJumpIndexes,
          title: "Use indexes for all jumps",
          arguments: [textDocument],
        },
      });
    }

    if (hasIndexJump) {
      actions.push({
        title: "Use labels for all jumps",
        kind: CodeActionKind.RefactorRewrite,
        command: {
          command: Commands.useJumpLabels,
          title: "Use labels for all jumps",
          arguments: [textDocument],
        },
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

    if (selectedParameter?.token.type !== "identifier") return;

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

    if (selectedParameter?.token.type !== "identifier") return;

    const name = selectedParameter.token.content;

    switch (selectedParameter.type) {
      case ParameterType.variable:
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

    if (selectedParameter?.token.type !== "identifier") return;

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
    // TODO: prevent renaming of built-in globals
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

    if (selectedParameter?.token.type !== "identifier") return;

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
    // TODO: add support for nested labels
    // TODO: make nesting logic consistent with formatting
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const { nodes } = doc;
    const symbols: DocumentSymbol[] = [];

    let i = 0;

    while (i < nodes.length) {
      const node = nodes[i];
      if (node instanceof LabelDeclaration) break;

      i++;
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

    while (i < nodes.length) {
      const node = nodes[i];

      if (!(node instanceof LabelDeclaration)) {
        i++;
        continue;
      }

      const start = node.start;
      let end = node.end;
      const children: DocumentSymbol[] = [];

      // finds every instruction between this and the next label
      // and adds the variables written by them as children
      i++;
      while (i < nodes.length) {
        const current = nodes[i];
        if (current instanceof LabelDeclaration) break;
        i++;

        if (!(current instanceof InstructionNode)) continue;

        end = current.end;
        for (const parameter of current.parameters) {
          if (
            parameter.type === ParameterType.variable &&
            parameter.usage === ParameterUsage.write
          ) {
            children.push({
              name: parameter.token.content,
              kind: SymbolKind.Variable,
              range: parameter.token,
              selectionRange: parameter.token,
            });
          }
        }
      }

      symbols.push({
        name: node.name,
        kind: SymbolKind.Function,
        range: Range.create(start, end),
        selectionRange: labelDeclarationNameRange(node.nameToken),
        children,
      });
    }

    return symbols;
  });

  documents.onDidChangeContent((change) => {
    // TODO: add diagnostics for unused labels
    // TODO: add diagnostics for unused variables (script-wide)
    const doc = documents.get(change.document.uri);
    if (!doc) return;

    const parserDiagnostics: ParserDiagnostic[] = [...doc.parserDiagnostics];
    for (const node of doc.nodes) {
      node.provideDiagnostics(parserDiagnostics);
    }

    const diagnostics: Diagnostic[] = [];

    for (const diagnostic of parserDiagnostics) {
      diagnostics.push({
        ...diagnostic,
        range: Range.create(diagnostic.start, diagnostic.end),
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

function getSelectedSyntaxNode(doc: MlogDocument, position: Position) {
  return doc.nodes.find((node) => containsPosition(node, position));
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
