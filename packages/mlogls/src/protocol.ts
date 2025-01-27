import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  Position,
  TextDocumentIdentifier,
  TextEdit,
} from "vscode-languageserver";

const tokenTypes = [
  "keyword",
  "variable",
  "property",
  "enumMember",
  "function",
  "method",
  "macro",
  "type",
  "namespace",
  "interface",
  "struct",
  "class",
  "enum",
  "typeParameter",
  "parameter",
  "event",
  "operator",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
] as const;

export type SemanticTokenType = (typeof tokenTypes)[number];

const tokenModifiers = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
  "local",
] as const;

export const TokenModifiers = createTokenLegend(tokenModifiers, (i) => 1 << i);

export const TokenTypes = createTokenLegend(tokenTypes, (i) => i);

export enum DiagnosticCode {
  ignoredValue = "ignored-value",
  unusedLabel = "unused-label",
  undefinedLabel = "undefined-label",
  unusedVariable = "unused-variable",
  undefinedVariable = "undefined-variable",
  writingToReadOnly = "writing-to-readonly",
  outOfRangeValue = "out-of-range-value",
  excessPackcolorPrecision = "excess-packcolor-precision",
  lineTooLong = "line-too-long",
  unknownInstruction = "unknown-instruction",
  unknownVariant = "unknown-variant",
  unusedParameter = "unused-parameter",
  labelRedeclaration = "label-redeclaration",
  unexpectedToken = "unexpected-token",
  tooManyLabels = "too-many-labels",
  tooManyInstructions = "too-many-instructions",
  missingSpace = "missing-space",
  unclosedString = "unclosed-string",
  unknownColorName = "unknown-color-name",
  preferJumpLabels = "prefer-jump-labels",
}

export enum CommandCode {
  useJumpLabels = "mlogls.useJumpLabels",
  useJumpIndexes = "mlogls.useJumpIndexes",
  convertToColorLiteral = "mlogls.convertToColorLiteral",
  convertToPackColor = "mlogls.convertToPackColor",
  removeAllUnusedParameters = "mlogls.removeAllUnusedParameters",
}

export interface CommandHandlerMap {
  [CommandCode.useJumpLabels](
    textDocument: TextDocumentIdentifier
  ): Promise<void>;
  [CommandCode.useJumpIndexes](
    textDocument: TextDocumentIdentifier
  ): Promise<void>;
  [CommandCode.convertToColorLiteral](
    textDocument: TextDocumentIdentifier,
    position: Position
  ): Promise<void>;

  [CommandCode.convertToPackColor](
    textDocument: TextDocumentIdentifier,
    position: Position
  ): Promise<void>;
  [CommandCode.removeAllUnusedParameters](
    textDocument: TextDocumentIdentifier
  ): Promise<void>;
}

type CreateCommandActionOptions<C extends CommandCode> = Omit<
  CodeAction,
  "command"
> & {
  command: C;
  arguments: Parameters<CommandHandlerMap[C]>;
};

export function createCommandAction<C extends CommandCode>(
  options: CreateCommandActionOptions<C>
): CodeAction {
  const { command, arguments: args, ...action } = options;
  return {
    ...action,
    command: {
      title: action.title,
      command,
      arguments: args,
    },
  };
}

export function createSpellingAction(
  diagnostic: Diagnostic,
  uri: string,
  suggestion: string
): CodeAction {
  return {
    title: `Change spelling to '${suggestion}'.`,
    edit: {
      changes: {
        [uri]: [TextEdit.replace(diagnostic.range, suggestion)],
      },
    },
    diagnostics: [diagnostic],
    kind: CodeActionKind.QuickFix,
    isPreferred: true,
  };
}

type TokenLegend<K extends string> = Record<K, number> & { keys: K[] };

function createTokenLegend<const K extends string>(
  keys: readonly K[],
  computeValue: (index: number) => number
) {
  return keys.reduce((acc, key, i) => ({ ...acc, [key]: computeValue(i) }), {
    keys: [...keys],
  } as TokenLegend<K>);
}
