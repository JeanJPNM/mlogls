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
  "variable",
  "property",
  "enumMember",
  "event",
  "operator",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
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
  missingSpace = "missing-space",
  unclosedString = "unclosed-string",
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
