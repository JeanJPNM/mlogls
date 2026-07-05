import {
  type Connection,
  type InitializeResult,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  TextEdit,
} from "vscode-languageserver";
import { MlogDocument } from "./document";
import { CommandCode, TokenModifiers, TokenTypes } from "./lsp/protocol";
import { formatCode } from "./lsp/formatter";
import { getColorPresentations, getDocumentColors } from "./lsp/color";
import { getCompletions } from "./lsp/completions";
import { getCodeActions } from "./lsp/code_actions";
import { executeCommand } from "./lsp/command";
import { getDefinitions, getReferences } from "./lsp/references";
import { getSelectedSyntaxNode } from "./lsp/common";
import { getRenameEdits, getRenamePreparation } from "./lsp/rename";
import { getDocumentSymbols } from "./lsp/document_symbol";
import { getDocumentDiagnostics } from "./lsp/diagnostics";
import { getFoldingRanges } from "./lsp/folding";
import { getSemanticTokens } from "./lsp/semantic_tokens";

export interface LanguageServerOptions {
  connection: Connection;
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

  connection.onInitialize(() => {
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
          commands: Object.values(CommandCode),
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
    if (!doc) return { data: [] };

    return { data: getSemanticTokens(doc) };
  });

  connection.onDocumentColor((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    return getDocumentColors(doc);
  });

  connection.onColorPresentation((params) => {
    const { color, range, textDocument } = params;

    const doc = documents.get(textDocument.uri);
    if (!doc) return [];

    return getColorPresentations(doc, range, color);
  });

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    return getCompletions(doc, params.position);
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
    if (doc.nodes.length === 0) return;
    const { options } = params;

    const formattedCode = formatCode({
      unit: doc.unit,
      insertSpaces: options.insertSpaces,
      tabSize: options.tabSize,
      insertFinalNewline: options.insertFinalNewline,
    });

    return [
      TextEdit.replace(Range.create(0, 0, doc.lineCount, 0), formattedCode),
    ];
  });

  connection.onCodeAction((params) => {
    const { range, textDocument, context } = params;
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    return getCodeActions(doc, context, range);
  });

  connection.onExecuteCommand(async (params) => {
    const command = params.command as CommandCode;
    const args: unknown[] = params.arguments ?? [];

    const edit = executeCommand(documents, command, args);
    if (!edit) return;

    await connection.workspace.applyEdit(edit);
  });

  connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    return getDefinitions(doc, params.position);
  });

  connection.onReferences((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    return getReferences(doc, params.position);
  });

  connection.onRenameRequest((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const edits = getRenameEdits(doc, params.position, params.newName);
    if (!edits) return;

    return {
      changes: {
        [params.textDocument.uri]: edits,
      },
    };
  });

  connection.onPrepareRename((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    return getRenamePreparation(doc, params.position);
  });

  connection.onDocumentSymbol((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    return getDocumentSymbols(doc);
  });

  connection.onFoldingRanges((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    return getFoldingRanges(doc);
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);

    if (!doc) return;

    const { position } = params;

    const node = getSelectedSyntaxNode(doc, position);

    if (!node) return;

    return node.provideHover(doc.unit, params.position.character);
  });

  documents.onDidChangeContent(async (change) => {
    const doc = documents.get(change.document.uri);
    if (!doc) return;

    const diagnostics = getDocumentDiagnostics(doc);

    await connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  });

  documents.onDidClose(async (e) => {
    const { document } = e;

    // remove existing warnings and error messages
    // since each file is standalone
    await connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  // Make the text document manager listen on the connection
  // for open, change and close text document events
  documents.listen(connection);

  // Listen on the connection
  connection.listen();
}
