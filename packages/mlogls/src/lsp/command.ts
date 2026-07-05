import {
  Position,
  Range,
  TextDocumentIdentifier,
  TextDocuments,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver";
import { CommandCode, CommandHandlerMap, isDiagnosticCode } from "./protocol";
import { convertToLabeledJumps, convertToNumberedJumps } from "../refactoring";
import { MlogDocument } from "../document";
import { getSelectedSyntaxNode, getSelectedSyntaxNodeIndex } from "./common";
import {
  CommentLine,
  InstructionNode,
  PackColorInstruction,
  SetInstruction,
} from "../parser/nodes";
import { ParameterUsage } from "../parser/descriptors";
import { ignoreToken } from "../constants";
import { DiagnosticDirectiveScope } from "../parser/tokens";

type CommandHandlers = {
  [K in keyof CommandHandlerMap]: (
    documents: TextDocuments<MlogDocument>,
    ...args: Parameters<CommandHandlerMap[K]>
  ) => TextEdit[] | undefined;
};

export function executeCommand(
  documents: TextDocuments<MlogDocument>,
  command: CommandCode,
  args: unknown[]
): WorkspaceEdit | undefined {
  let uri: string | undefined;
  let edits: TextEdit[] | undefined;
  switch (command) {
    case CommandCode.useJumpLabels: {
      const [textDocument] = args;
      if (!TextDocumentIdentifier.is(textDocument)) return;

      uri = textDocument.uri;
      edits = commands[command](documents, textDocument);
      break;
    }
    case CommandCode.useJumpIndexes: {
      const [textDocument] = args;
      if (!TextDocumentIdentifier.is(textDocument)) return;

      uri = textDocument.uri;
      edits = commands[command](documents, textDocument);
      break;
    }
    case CommandCode.convertToColorLiteral: {
      const [textDocument, start] = args;
      if (!TextDocumentIdentifier.is(textDocument) || !Position.is(start))
        return;
      uri = textDocument.uri;
      edits = commands[command](documents, textDocument, start);
      break;
    }

    case CommandCode.convertToPackColor: {
      const [textDocument, start] = args;
      if (!TextDocumentIdentifier.is(textDocument) || !Position.is(start))
        return;
      uri = textDocument.uri;
      edits = commands[command](documents, textDocument, start);
      break;
    }
    case CommandCode.removeAllUnusedParameters: {
      const [textDocument] = args;
      if (!TextDocumentIdentifier.is(textDocument)) return;
      uri = textDocument.uri;
      edits = commands[command](documents, textDocument);
      break;
    }
    case CommandCode.disableDiagnosticForLine: {
      const [textDocument, position, code] = args;
      if (!TextDocumentIdentifier.is(textDocument)) return;
      if (!Position.is(position)) return;
      if (!isDiagnosticCode(code)) return;

      uri = textDocument.uri;
      edits = commands[command](documents, textDocument, position, code);
      break;
    }
    case CommandCode.disableDiagnosticForFile: {
      const [textDocument, code] = args;
      if (!TextDocumentIdentifier.is(textDocument)) return;
      if (!isDiagnosticCode(code)) return;

      uri = textDocument.uri;
      edits = commands[command](documents, textDocument, code);
      break;
    }
    case CommandCode.removeDiagnosticDirective: {
      const [textDocument, position] = args;

      if (!TextDocumentIdentifier.is(textDocument)) return;
      if (!Position.is(position)) return;

      uri = textDocument.uri;
      edits = commands[command](documents, textDocument, position);
      break;
    }
  }

  if (!uri || !edits) return;
  return {
    changes: {
      [uri]: edits,
    },
  };
}

const commands: CommandHandlers = {
  [CommandCode.useJumpLabels](documents, textDocument) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    return convertToLabeledJumps(doc);
  },
  [CommandCode.useJumpIndexes](documents, textDocument) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    return convertToNumberedJumps(doc);
  },
  [CommandCode.convertToColorLiteral](documents, textDocument, start) {
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

    // using last.end instead of node.end to preserve comments
    return [TextEdit.replace(Range.create(node.start, last.end), newText)];
  },
  [CommandCode.convertToPackColor](documents, textDocument, start) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;
    const node = getSelectedSyntaxNode(doc, start);

    if (!(node instanceof SetInstruction)) return;

    const { variable, value } = node.data;

    if (!value?.isColorLiteral()) return;

    const { red, green, blue, alpha } = value;

    const c = (value: number) => Math.round(value * 10 ** 3) / 10 ** 3;

    const newText = `packcolor ${variable!.content} ${c(red)} ${c(green)} ${c(
      blue
    )} ${c(alpha)}`;

    // using last.end instead of node.end to preserve comments
    return [TextEdit.replace(Range.create(node.start, value.end), newText)];
  },
  [CommandCode.removeAllUnusedParameters](documents, textDocument) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    const { nodes } = doc;
    const edits: TextEdit[] = [];

    for (const node of nodes) {
      if (!(node instanceof InstructionNode)) continue;

      // will never be removed because it's the instruction name
      let previousToken = node.line.tokens[0];

      for (let i = 0; i < node.parameters.length; i++) {
        const param = node.parameters[i];

        if (
          param.usage !== ParameterUsage.unused ||
          param.token.content === ignoreToken
        ) {
          previousToken = param.token;
          continue;
        }

        edits.push(
          TextEdit.del(Range.create(previousToken.end, param.token.end))
        );
        previousToken = param.token;
      }
    }

    return edits;
  },
  [CommandCode.disableDiagnosticForLine](
    documents,
    textDocument,
    position,
    code
  ) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    const index = getSelectedSyntaxNodeIndex(doc, position);
    if (index === -1) return;
    const node = doc.nodes[index];
    const previous = doc.nodes[index - 1];

    const edits: TextEdit[] = [];
    if (
      previous instanceof CommentLine &&
      previous.start.line === node.start.line - 1 &&
      previous.diagnosticDirective?.scope === DiagnosticDirectiveScope.nextLine
    ) {
      const directive = previous.diagnosticDirective;
      const insertPosition =
        directive.items.length > 0
          ? directive.items[directive.items.length - 1].endPosition
          : Position.create(
              previous.start.line,
              previous.start.character + directive.prefixEnd
            );

      edits.push(TextEdit.insert(insertPosition, ` ${code}`));
    } else {
      const lineStart = Position.create(position.line, 0);
      const indentation = doc.getText({
        start: lineStart,
        end: node.start,
      });
      edits.push(
        TextEdit.insert(
          lineStart,
          `${indentation}# mlogls-disable-next-line ${code}\n`
        )
      );
    }

    return edits;
  },
  [CommandCode.disableDiagnosticForFile](documents, textDocument, code) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;
    const first = doc.nodes[0];
    const edits: TextEdit[] = [];
    if (
      first instanceof CommentLine &&
      first.diagnosticDirective?.scope === DiagnosticDirectiveScope.scope
    ) {
      const directive = first.diagnosticDirective;
      const insertPosition =
        directive.items.length > 0
          ? directive.items[directive.items.length - 1].endPosition
          : Position.create(
              first.start.line,
              first.start.character + directive.prefixEnd
            );
      edits.push(TextEdit.insert(insertPosition, ` ${code}`));
    } else {
      edits.push(
        TextEdit.insert(Position.create(0, 0), `# mlogls-disable ${code}\n`)
      );
    }
    return edits;
  },

  [CommandCode.removeDiagnosticDirective](documents, textDocument, position) {
    const doc = documents.get(textDocument.uri);
    if (!doc) return;

    const index = getSelectedSyntaxNodeIndex(doc, position);
    if (index === -1) return;
    const node = doc.nodes[index];

    const edits: TextEdit[] = [];

    const directive = node.trailingComment?.diagnosticDirective;
    if (!directive) return;

    for (const item of directive.items) {
      const offset = position.character - item.basePosition.character;

      if (offset < item.start || offset >= item.end) continue;

      let deleteStart: Position;
      let deleteEnd: Position;

      // delete the single item if there are more
      // otherwise delete the entire comment
      if (directive.items.length > 1) {
        deleteStart = Position.create(
          item.basePosition.line,
          // include the space before the code
          item.basePosition.character + item.start - 1
        );
        deleteEnd = Position.create(
          item.basePosition.line,
          item.basePosition.character + item.end
        );
      } else if (node instanceof CommentLine) {
        deleteStart = Position.create(node.start.line, 0);
        deleteEnd = Position.create(node.start.line + 1, 0);
      } else {
        const lastToken = node.line.tokens[node.line.tokens.length - 1];
        deleteStart = lastToken.end;
        deleteEnd = node.trailingComment.end;
      }

      edits.push(TextEdit.del(Range.create(deleteStart, deleteEnd)));
    }

    return edits;
  },
};
