import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Position,
  Range,
} from "vscode-languageserver";
import { MlogDocument } from "../document";
import { containsPosition, getSelectedSyntaxNodeIndex } from "./common";
import { CommentLine, getInstructionNames } from "../parser/nodes";
import { colorData } from "../constants";
import {
  commentLineDiagnosticDirectiveKinds,
  CommentToken,
  DiagnosticDirective,
  diagnosticDirectiveKinds,
  StringToken,
  StringTokenTag,
  TextToken,
  trailingCommentDiagnosticDirectiveKinds,
} from "../parser/tokens";
import { ignorableDiagnosticCodes } from "./protocol";
import { findLabelsInScope } from "../analysis/logical_scope";
import { CompletionContext } from "../analysis/types";

export function getCompletions(doc: MlogDocument, position: Position) {
  const nodeIndex = getSelectedSyntaxNodeIndex(doc, position);
  const node = doc.nodes[nodeIndex];
  const line = node?.line;

  const selectedToken = line?.tokens.find((token) =>
    containsPosition(token, position)
  );

  const range = selectedToken
    ? Range.create(selectedToken.start, selectedToken.end)
    : Range.create(position, position);

  // show completions for instructions if:
  // - no token line is selected
  // - the cursor is contained within the first token of the selected token line
  if (
    !line ||
    (selectedToken === line.tokens[0] && !selectedToken.isComment())
  ) {
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
    return stringColorTagCompletions(selectedToken, position);
  }

  if (selectedToken?.isColorLiteral() && selectedToken.tag) {
    return colorLiteralCompletions(selectedToken, selectedToken.tag, position);
  }

  // suggest diagnostic directive kinds if the comment
  // is a potentially incomplete diagnostic directive
  if (
    selectedToken?.isComment() &&
    shouldSuggestDiagnosticKinds(selectedToken, position)
  ) {
    const kinds =
      node instanceof CommentLine
        ? commentLineDiagnosticDirectiveKinds
        : trailingCommentDiagnosticDirectiveKinds;

    return kinds.map<CompletionItem>((kind) => ({
      label: kind,
      kind: CompletionItemKind.Keyword,
      insertText: kind,
      detail: "Diagnostic directive",
    }));
  }

  if (selectedToken?.isComment() && selectedToken.diagnosticDirective) {
    return diagnosticCodeSuggestions(
      selectedToken,
      selectedToken.diagnosticDirective,
      position
    );
  }

  const context: CompletionContext = {
    getVariableCompletions() {
      const completions: CompletionItem[] = [];

      for (const symbol of doc.unit.symbolTable.values()) {
        completions.push({
          label: symbol.name,
          kind: symbol.isKeyword
            ? CompletionItemKind.Keyword
            : CompletionItemKind.Variable,
          // higher precedence to keywords and declared variables
          sortText:
            symbol.isGlobal || symbol.isBuildingLink
              ? `1${symbol.name}`
              : `0${symbol.name}`,
        });
      }

      return completions;
    },
    getLabelCompletions() {
      return [...findLabelsInScope(doc.unit, nodeIndex)].map((label) => ({
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
}

function stringColorTagCompletions(token: StringToken, position: Position) {
  const offset = position.character - token.start.character;
  for (const tag of token.colorTags) {
    if (tag.nameStart > offset || tag.nameEnd < offset) continue;

    const completions = CompletionList.create();

    completions.itemDefaults = {
      editRange: Range.create(
        token.start.line,
        token.start.character + tag.nameStart,
        token.start.line,
        token.start.character + tag.nameEnd
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

function colorLiteralCompletions(
  token: TextToken,
  tag: StringTokenTag,
  position: Position
) {
  const offset = position.character - token.start.character;
  if (tag.nameStart > offset || tag.nameEnd < offset) return;

  const completions = CompletionList.create();

  completions.itemDefaults = {
    editRange: Range.create(
      token.start.line,
      token.start.character + tag.nameStart,
      token.start.line,
      token.start.character + tag.nameEnd
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

function diagnosticCodeSuggestions(
  token: TextToken,
  directive: DiagnosticDirective,
  position: Position
) {
  const offset = position.character - token.start.character;

  // make sure we don't recommend rule names inside the directive prefix
  if (offset < directive.prefixEnd) return;
  // don't show completions in the description section of the comment
  if (offset > directive.itemsEnd) return;

  const items = directive.items;

  const completions = CompletionList.create();
  for (const item of items) {
    if (item.start > offset || item.end < offset) continue;

    completions.itemDefaults = {
      editRange: Range.create(
        token.start.line,
        token.start.character + item.start,
        token.start.line,
        token.start.character + item.end
      ),
    };
    break;
  }

  completions.items = ignorableDiagnosticCodes
    .filter((code) => items.every((item) => item.code !== code))
    .map<CompletionItem>((code) => ({
      label: code,
      kind: CompletionItemKind.Value,
    }));

  return completions;
}

function shouldSuggestDiagnosticKinds(token: CommentToken, position: Position) {
  const content = token.content;
  const offset = position.character - token.start.character;

  // skip leading #
  let start = 1;
  while (
    start < content.length &&
    (content[start] === " " || content[start] === "\t")
  ) {
    start++;
  }

  // suggest directive kinds on empty comments
  if (start >= content.length) return true;

  let end = start;
  while (
    end < content.length &&
    content[end] !== " " &&
    content[end] !== "\t"
  ) {
    end++;
  }

  if (offset > end) return false;

  const prefix = content.slice(start, end);

  return diagnosticDirectiveKinds.some((kind) => kind.startsWith(prefix));
}
