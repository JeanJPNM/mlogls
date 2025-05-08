import {
  CodeAction,
  Command,
  CompletionItem,
  CompletionItemKind,
  DiagnosticSeverity,
  DiagnosticTag,
  Hover,
  MarkupContent,
  MarkupKind,
  ParameterInformation,
  SignatureInformation,
} from "vscode-languageserver";
import { ParserDiagnostic } from "./tokenize";
import {
  createSpellingAction,
  DiagnosticCode,
  TokenModifiers,
  TokenTypes,
} from "../protocol";
import { CompletionContext, TokenSemanticData } from "../analysis";
import { TextToken } from "./tokens";
import { SymbolTable } from "../symbol";
import { getSpellingSuggestionForName } from "../util/spelling";
import { MlogDocument } from "../document";

export const restrictedTokenCompletionKind = CompletionItemKind.EnumMember;

export enum ParameterUsage {
  read,
  write,
  ignored,
  unused,
}

export enum ParameterType {
  label,
  variable,
  enumMember,
}

export interface InstructionParameter {
  type: ParameterType;
  usage: ParameterUsage;
  token: TextToken;
}

interface ParameterDescriptor {
  isOutput?: boolean;
  isLabel?: boolean;
  restrict?: {
    semanticType?: number;
    invalidPrefix: string;
    values: readonly string[];
  };
}

export type SingleDescriptor = Record<string, ParameterDescriptor>;
export type OverloadDescriptor = Record<string, SingleDescriptor>;

export type DescriptorData<T extends SingleDescriptor> = Partial<
  Record<keyof T, TextToken>
>;

export type OverloadData<
  T extends Record<string, SingleDescriptor>,
  Pre extends SingleDescriptor = Record<string, never>,
> =
  | {
      [K in keyof T]: DescriptorData<Pre> &
        DescriptorData<T[K]> & {
          $type: K;
          typeToken: TextToken;
        };
    }[keyof T]
  | (DescriptorData<Pre> & { $type: "unknown"; typeToken?: TextToken });

export interface InstructionDescriptor<Data> {
  parse(tokens: TextToken[]): [Data, InstructionParameter[]];
  getSignatures(): SignatureInformation[];
  getActiveSignature(data: Data): number;
  getActiveSignatureParameter(
    data: Data,
    character: number,
    tokens: TextToken[]
  ): number;
  getCompletionItems(
    data: Data,
    context: CompletionContext,
    targetToken: TextToken | undefined
  ): CompletionItem[];

  provideDiagnostics(
    table: SymbolTable,
    data: Data,
    tokens: TextToken[],
    parameters: InstructionParameter[],
    diagnostics: ParserDiagnostic[]
  ): void;
  provideCodeActions(
    doc: MlogDocument,
    diagnostic: ParserDiagnostic,
    data: Data,
    tokens: TextToken[],
    actions: (CodeAction | Command)[]
  ): void;
  provideTokenSemantics(
    table: SymbolTable,
    params: InstructionParameter[],
    tokens: TokenSemanticData[]
  ): void;

  provideHover(
    data: Data,
    character: number,
    tokens: TextToken[]
  ): Hover | undefined;
}

export type DataOf<Inst> = Inst extends {
  descriptor: InstructionDescriptor<infer Data>;
}
  ? Data
  : never;

export function createSingleDescriptor<const T extends SingleDescriptor>({
  name,
  descriptor,
}: {
  name: string;
  descriptor: T;
}): InstructionDescriptor<DescriptorData<T>> {
  return {
    parse(tokens) {
      const data = parseDescriptor(descriptor, tokens);
      const parameters = parseParameters(descriptor, tokens);

      return [data, parameters];
    },
    getActiveSignature() {
      return 0;
    },
    getActiveSignatureParameter(data, character, tokens) {
      return getActiveParameter(data, character, tokens);
    },
    getCompletionItems(data, context, targetToken) {
      return provideMemberCompletions(descriptor, data, context, targetToken);
    },
    getSignatures() {
      return [getDescriptorSignature(descriptor, name)];
    },

    provideDiagnostics(table, data, tokens, parameters, diagnostics) {
      validateMembers(descriptor, data, tokens, diagnostics);
      validateParameters(table, parameters, diagnostics);
    },
    provideCodeActions(doc, diagnostic, data, tokens, actions) {
      if (diagnostic.code !== DiagnosticCode.unknownVariant) return;

      const token = getTargetToken(diagnostic.range.start.character, tokens);
      if (!token) return;

      const name = getActiveParameterName(data, token);
      if (!name) return;

      const param = descriptor[name];

      if (!param.restrict) return;

      const suggestion = getSpellingSuggestionForName(
        token.content,
        param.restrict.values
      );

      if (!suggestion) return;

      actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
    },
    provideTokenSemantics: provideSemantics,
    provideHover(data, character, tokens) {
      const token = getTargetToken(character, tokens);
      if (!token) return;

      const name = getActiveParameterName(data, token);
      if (!name) return;

      return {
        contents: createHoverString(`parameter <${name}>`),
        range: token,
      };
    },
  };
}

export function createOverloadDescriptor<
  const T extends OverloadDescriptor,
  const Pre extends SingleDescriptor = Record<string, never>,
>({
  name,
  pre,
  overloads,
}: {
  name: string;
  pre?: Pre;
  overloads: T;
}): InstructionDescriptor<OverloadData<T, Pre>> {
  const preKeys = pre ? Object.keys(pre) : [];
  const typeTokenIndex = preKeys.length + 1;

  return {
    parse(tokens: TextToken[]) {
      const preData = pre
        ? parseDescriptor(pre, tokens)
        : ({} as unknown as DescriptorData<Pre>);
      const preParams = pre
        ? parseParameters(pre, tokens, 1, typeTokenIndex)
        : [];

      const typeToken = tokens[typeTokenIndex];

      if (tokens.length > typeTokenIndex) {
        let key: keyof T;
        for (key in overloads) {
          const params = overloads[key];
          if (typeToken.content !== key) continue;

          return [
            {
              ...preData,
              ...parseDescriptor(params, tokens, typeTokenIndex + 1),
              $type: key,
              typeToken,
            },
            [
              ...preParams,
              {
                type: ParameterType.enumMember,
                token: typeToken,
                usage: ParameterUsage.read,
              },
              ...parseParameters(params, tokens, typeTokenIndex + 1),
            ],
          ];
        }
      }

      if (typeToken) {
        preParams.push({
          type: ParameterType.enumMember,
          token: typeToken,
          usage: ParameterUsage.read,
        });
      }
      return [
        { ...preData, $type: "unknown", typeToken },
        [...preParams, ...parseParameters({}, tokens, typeTokenIndex + 1)],
      ];
    },

    getSignatures(): SignatureInformation[] {
      let prefix = name;
      let params: ParameterInformation[] = [];
      if (pre) {
        const signature = getDescriptorSignature(pre, prefix);
        prefix = signature.label;
        params = signature.parameters ?? [];
      }

      return Object.keys(overloads).map((key) => {
        const signature = getDescriptorSignature(
          overloads[key],
          `${prefix} ${key}`
        );
        return {
          ...signature,
          parameters: [...params, ...signature.parameters!],
        };
      });
    },
    getActiveSignature(data: OverloadData<T, Pre>): number {
      if (data.$type === "unknown") return 0;

      let i = 0;
      for (const current in overloads) {
        if (current === data.$type) return i;
        i++;
      }

      return 0;
    },
    getActiveSignatureParameter(
      data: OverloadData<T, Pre>,
      character: number,
      tokens: TextToken[]
    ): number {
      const targetToken = getTargetToken(character, tokens);
      if (data.$type === "unknown" && preKeys.length === 0) return -1;

      const keys = [...preKeys];

      if (data.$type !== "unknown") {
        const parameters = overloads[data.$type];
        keys.push(...Object.keys(parameters));
      }

      let i = 0;
      for (const key of keys) {
        if (targetToken === data[key as never]) return i;
        i++;
      }

      return -1;
    },
    getCompletionItems(
      data: OverloadData<T, Pre>,
      context: CompletionContext,
      targetToken: TextToken | undefined
    ) {
      // makes sure that the keys are in the correct order
      const keys = [...preKeys, "typeToken"];
      if (data.$type !== "unknown") {
        keys.push(...Object.keys(overloads[data.$type]));
      }

      for (const key of keys) {
        const value = data[key];
        if (value !== targetToken) continue;

        if (key === "typeToken") return overloadCompletionItems(overloads);

        const param = pre?.[key] ?? overloads[data.$type][key];

        if (param.isLabel) return context.getLabelCompletions();

        if (!param.restrict) return context.getVariableCompletions();

        return param.restrict.values.map(
          (value): CompletionItem => ({
            label: value,
            kind: restrictedTokenCompletionKind,
          })
        );
      }

      return context.getVariableCompletions();
    },
    provideDiagnostics(table, data, tokens, parameters, diagnostics) {
      if (data.$type === "unknown" && data.typeToken) {
        let message = `Unknown ${name} type: ${data.typeToken.content}`;

        const suggestion = getSpellingSuggestionForName(
          data.typeToken.content,
          Object.keys(overloads)
        );

        if (suggestion) message += `. Did you mean '${suggestion}'?`;

        diagnostics.push({
          range: data.typeToken,
          message,
          severity: DiagnosticSeverity.Error,
          code: DiagnosticCode.unknownVariant,
        });
        return;
      }

      if (data.$type !== "unknown") {
        const descriptor = overloads[data.$type];
        validateMembers(
          descriptor,
          data as DescriptorData<typeof descriptor>,
          tokens,
          diagnostics
        );
      } else {
        diagnostics.push({
          range: tokens[0],
          message: "Incomplete instruction",
          code: DiagnosticCode.incompleteInstruction,
          severity: DiagnosticSeverity.Warning,
        });
      }

      validateParameters(table, parameters, diagnostics);
    },
    provideCodeActions(doc, diagnostic, data, tokens, actions) {
      if (diagnostic.code !== DiagnosticCode.unknownVariant) return;

      const token = getTargetToken(diagnostic.range.start.character, tokens);
      if (!token) return;

      if (token === data.typeToken) {
        const suggestion = getSpellingSuggestionForName(
          data.typeToken.content,
          Object.keys(overloads)
        );

        if (!suggestion) return;

        actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
        return;
      }

      const name = getActiveParameterName(data, token);
      if (!name) return;

      const param = pre?.[name] ?? overloads[data.$type]?.[name];

      if (!param?.restrict) return;

      const suggestion = getSpellingSuggestionForName(
        token.content,
        param.restrict.values
      );

      if (!suggestion) return;

      actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
    },
    provideTokenSemantics: provideSemantics,
    provideHover(data, character, tokens) {
      const token = getTargetToken(character, tokens);

      if (!token || token === data.typeToken) return;

      const name = getActiveParameterName(data, token);
      if (!name) return;

      return {
        contents: createHoverString(`parameter <${name}>`),
        range: token,
      };
    },
  };
}

function parseDescriptor<const T extends SingleDescriptor>(
  descriptor: T,
  tokens: TextToken[],
  offset = 1
): DescriptorData<T> {
  const data: DescriptorData<T> = {};

  let key: keyof T;
  let i = 0;
  for (key in descriptor) {
    const token = tokens[i + offset];
    data[key] = token?.isComment() ? undefined : token;
    i++;
  }

  return data;
}

function parseParameters<const T extends SingleDescriptor>(
  descriptor: T,
  tokens: TextToken[],
  offset = 1,
  limit = tokens.length
) {
  const parameters: InstructionParameter[] = [];

  let key: keyof T;
  let i = offset;
  for (key in descriptor) {
    const token = tokens[i];
    if (token) {
      let usage = ParameterUsage.read;
      const param = descriptor[key];
      if (param.isOutput) {
        usage = ParameterUsage.write;
      } else if (key.startsWith("_")) {
        usage = ParameterUsage.ignored;
      }

      let type = ParameterType.variable;
      if (param.restrict) {
        type = ParameterType.enumMember;
      } else if (param.isLabel) {
        type = ParameterType.label;
      }

      parameters.push({
        type,
        token,
        usage,
      });
    }
    i++;
  }

  for (; i < limit; i++) {
    const token = tokens[i];
    if (token.isComment()) break;

    parameters.push({
      type: ParameterType.variable,
      token,
      usage: ParameterUsage.unused,
    });
  }

  return parameters;
}

function getDescriptorSignature<const T extends SingleDescriptor>(
  descriptor: T,
  prefix: string
): SignatureInformation {
  let label = prefix;

  for (const key in descriptor) {
    label += ` <${key}>`;
  }
  return {
    label,
    parameters: Object.keys(descriptor).map((key) => ({ label: `<${key}>` })),
  };
}

export function validateMembers<T extends SingleDescriptor>(
  descriptor: T,
  data: DescriptorData<T>,
  tokens: TextToken[],
  diagnostics: ParserDiagnostic[]
) {
  const missing: string[] = [];
  for (const key in descriptor) {
    const token = data[key];

    if (!token) {
      missing.push(key);
      continue;
    }

    const param = descriptor[key];

    if (param.restrict) {
      validateRestrictedToken(
        token,
        param.restrict.values,
        diagnostics,
        param.restrict.invalidPrefix
      );
    }
  }

  if (missing.length > 0) {
    diagnostics.push({
      message:
        missing.length === 1
          ? `Missing parameter: ${missing[0]}`
          : `Missing parameters: ${missing.join(", ")}`,
      range: tokens[0],
      code: DiagnosticCode.incompleteInstruction,
      severity: DiagnosticSeverity.Warning,
    });
  }
}

export function validateParameters(
  table: SymbolTable,
  parameters: InstructionParameter[],
  diagnostics: ParserDiagnostic[]
) {
  for (const param of parameters) {
    switch (param.usage) {
      case ParameterUsage.ignored:
        if (param.type === ParameterType.enumMember) break;
        if (param.token.content === "_") break;

        diagnostics.push({
          range: param.token,
          message:
            "This parameter is ignored by this instruction. Replace it with an underscore.",
          severity: DiagnosticSeverity.Hint,
          code: DiagnosticCode.ignoredValue,
          tags: [DiagnosticTag.Unnecessary],
        });
        break;
      case ParameterUsage.unused:
        diagnostics.push({
          range: param.token,
          message: "Unused parameter",
          severity: DiagnosticSeverity.Hint,
          code: DiagnosticCode.unusedParameter,
          tags: [DiagnosticTag.Unnecessary],
        });
        break;
      case ParameterUsage.write: {
        if (param.type !== ParameterType.variable) break;

        if (!param.token.isIdentifier()) {
          diagnostics.push({
            range: param.token,
            message: "Cannot use a literal value as an output parameter",
            code: DiagnosticCode.writingToReadOnly,
            severity: DiagnosticSeverity.Error,
          });
          break;
        }

        const symbol = table.get(param.token.content);
        if (!symbol) break;

        if (symbol.isKeyword) {
          diagnostics.push({
            range: param.token,
            message: "Cannot use a keyword as an output parameter",
            code: DiagnosticCode.writingToReadOnly,
            severity: DiagnosticSeverity.Error,
          });
        } else if (!symbol.isWriteable) {
          diagnostics.push({
            range: param.token,
            message: "Cannot write to a read-only variable",
            code: DiagnosticCode.writingToReadOnly,
            severity: DiagnosticSeverity.Error,
          });
        }
      }
    }
  }
}

function provideMemberCompletions<T extends SingleDescriptor>(
  descriptor: T,
  data: DescriptorData<T>,
  context: CompletionContext,
  targetToken: TextToken | undefined
) {
  for (const key in descriptor) {
    const value = data[key];

    if (value !== targetToken) continue;

    const param = descriptor[key];

    if (!param.restrict) return context.getVariableCompletions();

    return param.restrict.values.map(
      (value): CompletionItem => ({
        label: value,
        kind: restrictedTokenCompletionKind,
      })
    );
  }

  return context.getVariableCompletions();
}

function getActiveParameter(
  members: Record<string, TextToken | undefined>,
  offset: number,
  tokens: TextToken[]
) {
  const targetToken = getTargetToken(offset, tokens);

  let index = 0;
  for (const key in members) {
    if (members[key] === targetToken) break;
    index++;
  }
  return index;
}

function getActiveParameterName(
  members: Record<string, TextToken | undefined>,
  targetToken: TextToken | undefined
): string | undefined {
  for (const key in members) {
    if (members[key] === targetToken) return key;
  }
}

export function getTargetToken(character: number, tokens: TextToken[]) {
  // return the first token that contains the offset
  // or the next token after it
  // this allows the completion handlers
  // to perform plain equality comparisons with their respective tokens
  return (
    tokens.find(
      ({ start, end }) =>
        start.character <= character && character <= end.character
    ) ?? tokens.find((token) => token.start.character >= character)
  );
}

export function getTargetParameter(
  character: number,
  parameters: InstructionParameter[]
) {
  return (
    parameters.find(
      ({ token: { start, end } }) =>
        start.character <= character && character <= end.character
    ) ?? parameters.find(({ token }) => token.start.character >= character)
  );
}

function overloadCompletionItems<const T extends Record<string, unknown>>(
  descriptor: T
) {
  return Object.keys(descriptor).map(
    (type): CompletionItem => ({
      label: type,
      kind: restrictedTokenCompletionKind,
    })
  );
}

export function validateRestrictedToken(
  token: TextToken | undefined,
  values: readonly string[],
  diagnostics: ParserDiagnostic[],
  message: string
) {
  if (!token) return;
  if (values.indexOf(token.content) !== -1) return;

  const suggestion = getSpellingSuggestionForName(token.content, values);

  let finalMessage = message + `'${token.content}'`;

  if (suggestion) finalMessage += `. Did you mean '${suggestion}'?`;

  diagnostics.push({
    range: token,
    message: finalMessage,
    severity: DiagnosticSeverity.Warning,
    code: DiagnosticCode.unknownVariant,
  });
}

function provideSemantics(
  table: SymbolTable,
  parameters: InstructionParameter[],
  tokens: TokenSemanticData[]
) {
  for (const param of parameters) {
    switch (param.type) {
      case ParameterType.enumMember:
        tokens.push({
          type: TokenTypes.enumMember,
          token: param.token,
        });
        break;
      case ParameterType.label:
        if (!param.token.isIdentifier()) break;

        tokens.push({
          type: TokenTypes.function,
          token: param.token,
        });
        break;
      case ParameterType.variable: {
        if (!param.token.isIdentifier()) break;

        const symbol = table.get(param.token.content);

        // keywords are already taken care of by
        // the language grammar
        if (!symbol || symbol.isKeyword) break;

        let modifiers = 0;

        if (!symbol.isWriteable) {
          modifiers = TokenModifiers.readonly;
        } else if (param.usage === ParameterUsage.write) {
          modifiers = TokenModifiers.modification;
        }

        tokens.push({
          token: param.token,
          type: TokenTypes.variable,
          modifiers,
        });
      }
    }
  }
}

function createHoverString(headerCode: string): MarkupContent {
  return {
    kind: MarkupKind.Markdown,
    value: "```mlog\n" + headerCode + "\n```\n",
  };
}
