import {
  CodeAction,
  CodeActionKind,
  Command,
  CompletionItem,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  Range,
  SignatureHelp,
  TextEdit,
} from "vscode-languageserver";
import { ParserDiagnostic, TokenLine } from "./tokenize";
import {
  CommandCode,
  createCommandAction,
  createSpellingAction,
  DiagnosticCode,
  TokenTypes,
} from "../protocol";
import {
  createOverloadDescriptor,
  createSingleDescriptor,
  DataOf,
  getTargetToken,
  InstructionDescriptor,
  InstructionParameter,
  ParameterUsage,
} from "./descriptors";
import { colorData, counterVar, waitVar } from "../constants";
import {
  CompletionContext,
  getLabelNames,
  TokenSemanticData,
} from "../analysis";
import { MlogDocument } from "../document";
import { ParserPosition, TextToken } from "./tokens";
import { getSpellingSuggestionForName } from "../util/spelling";

export abstract class SyntaxNode {
  start: ParserPosition;
  end: ParserPosition;

  constructor(public line: TokenLine) {
    this.start = line.start;
    this.end = line.end;
  }

  provideDiagnostics(doc: MlogDocument, diagnostics: ParserDiagnostic[]): void {
    // TODO: makes more sense to move this to the parser
    const tokens = this.line.tokens;

    if (tokens.length > 16) {
      diagnostics.push({
        range: Range.create(tokens[16].start, tokens[tokens.length - 1].end),
        message: "Line too long; may only contain 16 tokens",
        severity: DiagnosticSeverity.Error,
        code: DiagnosticCode.lineTooLong,
      });
    }

    for (const token of this.line.tokens) {
      if (token.isString()) {
        for (const tag of token.colorTags) {
          if (tag.nameStart === tag.nameEnd || tag.color) continue;

          const name = token.content.slice(tag.nameStart, tag.nameEnd);

          let message = `Unknown color name: ${name}`;
          const suggestion = getSpellingSuggestionForName(
            name,
            Object.keys(colorData)
          );

          if (suggestion) {
            message += `. Did you mean '${suggestion}'?`;
          }

          diagnostics.push({
            message,
            range: Range.create(
              token.start.line,
              token.start.character + tag.nameStart,
              token.start.line,
              token.start.character + tag.nameEnd
            ),
            severity: DiagnosticSeverity.Warning,
            code: DiagnosticCode.unknownColorName,
          });
        }
      } else if (token.isColorLiteral() && token.tag) {
        const { tag } = token;
        if (tag.nameStart === tag.nameEnd || tag.color) continue;

        const name = token.content.slice(tag.nameStart, tag.nameEnd);

        let message = `Unknown color name: ${name}`;
        const suggestion = getSpellingSuggestionForName(
          name,
          Object.keys(colorData)
        );

        if (suggestion) {
          message += `. Did you mean '${suggestion}'?`;
        }

        diagnostics.push({
          message,
          range: Range.create(
            token.start.line,
            token.start.character + tag.nameStart,
            token.start.line,
            token.start.character + tag.nameEnd
          ),
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.unknownColorName,
        });
      }
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    _character: number
  ): CompletionItem[] {
    return context.getVariableCompletions();
  }

  provideTokenSemantics(
    _doc: MlogDocument,
    _tokens: TokenSemanticData[]
  ): void {}

  provideCodeActions(
    doc: MlogDocument,
    diagnostic: Diagnostic,
    actions: (CodeAction | Command)[]
  ): void {
    if (diagnostic.code !== DiagnosticCode.unknownColorName) return;

    const token = getTargetToken(
      diagnostic.range.start.character,
      this.line.tokens
    );

    if (token?.isString()) {
      const offset = diagnostic.range.start.character - token.start.character;
      for (const tag of token.colorTags) {
        if (tag.nameStart > offset || tag.nameEnd < offset) continue;
        const name = token.content.slice(tag.nameStart, tag.nameEnd);
        const suggestion = getSpellingSuggestionForName(
          name,
          Object.keys(colorData)
        );
        if (!suggestion) return;

        actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
      }
    } else if (token?.isColorLiteral() && token.tag) {
      const offset = diagnostic.range.start.character - token.start.character;
      const tag = token.tag;
      if (tag.nameStart > offset || tag.nameEnd < offset) return;

      const name = token.content.slice(tag.nameStart, tag.nameEnd);
      const suggestion = getSpellingSuggestionForName(
        name,
        Object.keys(colorData)
      );
      if (!suggestion) return;

      actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
    }
  }

  provideHover(_character: number): Hover | undefined {
    return;
  }

  abstract provideSignatureHelp(character: number): SignatureHelp;
}

export class CommentLine extends SyntaxNode {
  constructor(line: TokenLine) {
    super(line);
  }

  provideSignatureHelp(): SignatureHelp {
    return { signatures: [] };
  }

  provideCompletionItems(
    _context: CompletionContext,
    _character: number
  ): CompletionItem[] {
    return [];
  }
}

export class LabelDeclaration extends SyntaxNode {
  nameToken: TextToken;
  name: string;

  constructor(line: TokenLine) {
    super(line);

    this.nameToken = line.tokens[0];
    this.name = line.tokens[0].content.slice(0, -1);
  }

  provideDiagnostics(doc: MlogDocument, diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(doc, diagnostics);

    const { tokens } = this.line;

    let tokenCount = tokens.length;
    if (tokens[tokens.length - 1].isComment()) {
      tokenCount--;
    }

    if (tokenCount === 1) return;

    const first = tokens[1];
    const last = tokens[tokenCount - 1];

    diagnostics.push({
      range: Range.create(first.start, last.end),
      message: "Unexpected token after label declaration",
      severity: DiagnosticSeverity.Error,
      code: DiagnosticCode.unexpectedToken,
    });
  }

  provideCodeActions(
    doc: MlogDocument,
    diagnostic: Diagnostic,
    actions: (CodeAction | Command)[]
  ): void {
    super.provideCodeActions(doc, diagnostic, actions);
    if (diagnostic.code !== DiagnosticCode.unexpectedToken) return;

    actions.push({
      title: "Remove token",
      kind: CodeActionKind.QuickFix,
      isPreferred: true,
      edit: {
        changes: {
          [doc.uri]: [TextEdit.del(diagnostic.range)],
        },
      },
    });
  }

  provideSignatureHelp(): SignatureHelp {
    return { signatures: [] };
  }
}

export abstract class InstructionNode<Data> extends SyntaxNode {
  abstract descriptor: InstructionDescriptor<Data>;
  constructor(
    line: TokenLine,
    public data: Data,
    public parameters: InstructionParameter[]
  ) {
    super(line);
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return this.descriptor.getCompletionItems(this.data, context, targetToken);
  }

  provideDiagnostics(doc: MlogDocument, diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(doc, diagnostics);
    this.descriptor.provideDiagnostics(
      doc.symbolTable,
      this.data,
      this.line.tokens,
      this.parameters,
      diagnostics
    );
  }

  provideTokenSemantics(doc: MlogDocument, tokens: TokenSemanticData[]): void {
    this.descriptor.provideTokenSemantics(
      doc.symbolTable,
      this.parameters,
      tokens
    );
  }

  provideCodeActions(
    doc: MlogDocument,
    diagnostic: Diagnostic,
    actions: (CodeAction | Command)[]
  ): void {
    super.provideCodeActions(doc, diagnostic, actions);
    this.descriptor.provideCodeActions(
      doc,
      diagnostic,
      this.data,
      this.line.tokens,
      actions
    );

    switch (diagnostic.code) {
      case DiagnosticCode.ignoredValue:
      case DiagnosticCode.unusedVariable:
        actions.push({
          title: "Replace with _",
          edit: {
            changes: {
              [doc.uri]: [TextEdit.replace(diagnostic.range, "_")],
            },
          },
          diagnostics: [diagnostic],
          kind: CodeActionKind.QuickFix,
        });

        break;

      case DiagnosticCode.unusedParameter:
        actions.push({
          title: "Remove parameter",
          isPreferred: true,
          edit: {
            changes: {
              [doc.uri]: [TextEdit.del(diagnostic.range)],
            },
          },
          diagnostics: [diagnostic],
          kind: CodeActionKind.QuickFix,
        });

        actions.push(
          createCommandAction({
            command: CommandCode.removeAllUnusedParameters,
            arguments: [{ uri: doc.uri }],
            title: "Remove all unused parameters",
            kind: CodeActionKind.QuickFix,
          })
        );
        break;
      case DiagnosticCode.undefinedVariable: {
        const token = getTargetToken(
          diagnostic.range.start.character,
          this.line.tokens
        );
        if (!token?.isIdentifier()) break;

        const suggestion = getSpellingSuggestionForName(
          token.content,
          doc.symbolTable.keys()
        );
        if (!suggestion) break;

        actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
      }
    }
  }

  provideHover(character: number): Hover | undefined {
    return this.descriptor.provideHover(this.data, character, this.line.tokens);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: this.descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: this.descriptor.getActiveSignature(this.data),
      signatures: this.descriptor.getSignatures(),
    };
  }
}

export class NoopInstruction extends InstructionNode<
  DataOf<typeof NoopInstruction>
> {
  descriptor = NoopInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "noop",
    descriptor: {},
  });

  static parse(this: void, line: TokenLine) {
    return new NoopInstruction(
      line,
      ...NoopInstruction.descriptor.parse(line.tokens)
    );
  }

  provideSignatureHelp(_character: number): SignatureHelp {
    return {
      signatures: [
        {
          label: "noop",
          documentation: "Does nothing, consumes one instruction cycle.",
        },
      ],
    };
  }
}

/** Used to handle instrucions that this language server does not know */
export class UnknownInstruction extends InstructionNode<
  DataOf<typeof UnknownInstruction>
> {
  descriptor = UnknownInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "unknown",
    descriptor: {},
  });

  static parse(this: void, line: TokenLine) {
    const data = UnknownInstruction.descriptor.parse(line.tokens);
    return new UnknownInstruction(line, ...data);
  }

  provideSignatureHelp(): SignatureHelp {
    return {
      signatures: [],
    };
  }

  provideDiagnostics(doc: MlogDocument, diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(doc, diagnostics);

    const [name] = this.line.tokens;
    let message = `Unknown instruction: ${name.content}`;
    const suggestion = getSpellingSuggestionForName(
      name.content,
      getInstructionNames()
    );

    if (suggestion) {
      message += `. Did you mean '${suggestion}'?`;
    }
    diagnostics.push({
      message,
      range: name,
      severity: DiagnosticSeverity.Warning,
      code: DiagnosticCode.unknownInstruction,
    });
  }

  provideCodeActions(
    doc: MlogDocument,
    diagnostic: Diagnostic,
    actions: (CodeAction | Command)[]
  ): void {
    super.provideCodeActions(doc, diagnostic, actions);

    if (diagnostic.code !== DiagnosticCode.unknownInstruction) return;

    const [name] = this.line.tokens;
    const suggestion = getSpellingSuggestionForName(
      name.content,
      getInstructionNames()
    );

    if (!suggestion) return;

    actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
  }
}

export class ReadInstruction extends InstructionNode<
  DataOf<typeof ReadInstruction>
> {
  descriptor = ReadInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "read",
    descriptor: {
      output: { isOutput: true },
      target: {},
      address: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    return new ReadInstruction(
      line,
      ...ReadInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class WriteInstruction extends InstructionNode<
  DataOf<typeof WriteInstruction>
> {
  descriptor = WriteInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "write",
    descriptor: {
      input: {},
      target: {},
      address: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    return new WriteInstruction(
      line,
      ...WriteInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class DrawInstruction extends InstructionNode<
  DataOf<typeof DrawInstruction>
> {
  descriptor = DrawInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "draw",
    overloads: {
      clear: {
        red: {},
        green: {},
        blue: {},
      },
      color: {
        red: {},
        green: {},
        blue: {},
        alpha: {},
      },
      col: {
        color: {},
      },
      stroke: {
        width: {},
      },
      line: {
        x1: {},
        y1: {},
        x2: {},
        y2: {},
      },
      rect: {
        x: {},
        y: {},
        width: {},
        height: {},
      },
      lineRect: {
        x: {},
        y: {},
        width: {},
        height: {},
      },
      poly: {
        x: {},
        y: {},
        sides: {},
        radius: {},
        rotation: {},
      },
      linePoly: {
        x: {},
        y: {},
        sides: {},
        radius: {},
        rotation: {},
      },
      triangle: {
        x1: {},
        y1: {},
        x2: {},
        y2: {},
        x3: {},
        y3: {},
      },
      image: {
        x: {},
        y: {},
        image: {},
        size: {},
        rotation: {},
      },
      print: {
        x: {},
        y: {},
        alignment: {
          restrict: {
            invalidPrefix: "Invalid print alignment: ",
            values: [
              "center",
              "top",
              "bottom",
              "left",
              "right",
              "topLeft",
              "topRight",
              "bottomLeft",
              "bottomRight",
            ],
          },
        },
      },
      translate: { x: {}, y: {} },
      scale: { x: {}, y: {} },
      rotate: { degrees: {} },
      reset: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    return new DrawInstruction(
      line,
      ...DrawInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class PrintInstruction extends InstructionNode<
  DataOf<typeof PrintInstruction>
> {
  descriptor = PrintInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "print",
    descriptor: { value: {} },
  });

  static parse(this: void, line: TokenLine) {
    const data = PrintInstruction.descriptor.parse(line.tokens);

    return new PrintInstruction(line, ...data);
  }
}

export class PrintCharInstruction extends InstructionNode<
  DataOf<typeof PrintCharInstruction>
> {
  descriptor = PrintCharInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "printchar",
    descriptor: { value: {} },
  });

  static parse(this: void, line: TokenLine) {
    const data = PrintCharInstruction.descriptor.parse(line.tokens);

    return new PrintCharInstruction(line, ...data);
  }
}

export class FormatInstruction extends InstructionNode<
  DataOf<typeof FormatInstruction>
> {
  descriptor = FormatInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "format",
    descriptor: { value: {} },
  });

  static parse(this: void, line: TokenLine) {
    const data = FormatInstruction.descriptor.parse(line.tokens);
    return new FormatInstruction(line, ...data);
  }
}

export class DrawFlushInstruction extends InstructionNode<
  DataOf<typeof DrawFlushInstruction>
> {
  descriptor = DrawFlushInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "drawflush",
    descriptor: { target: {} },
  });

  static parse(this: void, line: TokenLine) {
    const data = DrawFlushInstruction.descriptor.parse(line.tokens);

    return new DrawFlushInstruction(line, ...data);
  }
}

export class PrintFlushInstruction extends InstructionNode<
  DataOf<typeof PrintFlushInstruction>
> {
  descriptor = PrintFlushInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "printflush",
    descriptor: { target: {} },
  });

  static parse(this: void, line: TokenLine) {
    return new PrintFlushInstruction(
      line,
      ...PrintFlushInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class GetLinkInstruction extends InstructionNode<
  DataOf<typeof GetLinkInstruction>
> {
  descriptor = GetLinkInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "getlink",
    descriptor: {
      result: { isOutput: true },
      index: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    return new GetLinkInstruction(
      line,
      ...GetLinkInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class ControlInstruction extends InstructionNode<
  DataOf<typeof ControlInstruction>
> {
  descriptor = ControlInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "control",
    overloads: {
      enabled: { building: {}, enabled: {} },
      shoot: { building: {}, x: {}, y: {}, shoot: {} },
      shootp: { building: {}, unit: {}, shoot: {} },
      config: { building: {}, value: {} },
      color: { building: {}, color: {} },
    },
  });

  static parse(this: void, line: TokenLine) {
    return new ControlInstruction(
      line,
      ...ControlInstruction.descriptor.parse(line.tokens)
    );
  }
}

const radarFilters = [
  "any",
  "enemy",
  "player",
  "ally",
  "attacker",
  "flying",
  "boss",
  "ground",
] as const;

const radarSorts = [
  "distance",
  "health",
  "shield",
  "armor",
  "maxHealth",
] as const;

export class RadarInstruction extends InstructionNode<
  DataOf<typeof RadarInstruction>
> {
  descriptor = RadarInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "radar",
    descriptor: {
      filter1: {
        restrict: {
          invalidPrefix: "Invalid radar filter: ",
          values: radarFilters,
        },
      },
      filter2: {
        restrict: {
          invalidPrefix: "Invalid radar filter: ",
          values: radarFilters,
        },
      },
      filter3: {
        restrict: {
          invalidPrefix: "Invalid radar filter: ",
          values: radarFilters,
        },
      },
      sort: {
        restrict: {
          invalidPrefix: "Invalid radar sort: ",
          values: radarSorts,
        },
      },
      building: {},
      order: {},
      output: { isOutput: true },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = RadarInstruction.descriptor.parse(line.tokens);

    return new RadarInstruction(line, ...data);
  }
}

export class SensorInstruction extends InstructionNode<
  DataOf<typeof SensorInstruction>
> {
  descriptor = SensorInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "sensor",
    descriptor: {
      output: { isOutput: true },
      target: {},
      property: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    return new SensorInstruction(
      line,
      ...SensorInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class SetInstruction extends InstructionNode<
  DataOf<typeof SetInstruction>
> {
  descriptor = SetInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "set",
    descriptor: {
      variable: { isOutput: true },
      value: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetInstruction.descriptor.parse(line.tokens);

    return new SetInstruction(line, ...data);
  }

  provideTokenSemantics(doc: MlogDocument, tokens: TokenSemanticData[]): void {
    // this tells the editor that this particular
    // use of the set instruction affects the control flow
    // just like jump
    if (this.data.variable?.content === counterVar) {
      tokens.push({
        token: this.line.tokens[0],
        type: TokenTypes.keyword,
      });
    }
    super.provideTokenSemantics(doc, tokens);
  }
}

export class OpInstruction extends InstructionNode<
  DataOf<typeof OpInstruction>
> {
  descriptor = OpInstruction.descriptor;

  static readonly legacyAliases: Record<string, string> = {
    atan2: "angle",
    dst: "len",
  };

  static readonly descriptor = createOverloadDescriptor({
    name: "op",
    overloads: {
      add: { result: { isOutput: true }, a: {}, b: {} },
      sub: { result: { isOutput: true }, a: {}, b: {} },
      mul: { result: { isOutput: true }, a: {}, b: {} },
      div: { result: { isOutput: true }, a: {}, b: {} },
      idiv: { result: { isOutput: true }, a: {}, b: {} },
      mod: { result: { isOutput: true }, a: {}, b: {} },
      pow: { result: { isOutput: true }, x: {}, y: {} },
      equal: { result: { isOutput: true }, a: {}, b: {} },
      notEqual: { result: { isOutput: true }, a: {}, b: {} },
      land: { result: { isOutput: true }, a: {}, b: {} },
      lessThan: { result: { isOutput: true }, a: {}, b: {} },
      lessThanEq: { result: { isOutput: true }, a: {}, b: {} },
      greaterThan: { result: { isOutput: true }, a: {}, b: {} },
      greaterThanEq: { result: { isOutput: true }, a: {}, b: {} },
      strictEqual: { result: { isOutput: true }, a: {}, b: {} },
      shl: { result: { isOutput: true }, x: {}, y: {} },
      shr: { result: { isOutput: true }, x: {}, y: {} },
      or: { result: { isOutput: true }, x: {}, y: {} },
      and: { result: { isOutput: true }, x: {}, y: {} },
      xor: { result: { isOutput: true }, x: {}, y: {} },
      not: { result: { isOutput: true }, x: {} },
      max: { result: { isOutput: true }, a: {}, b: {} },
      min: { result: { isOutput: true }, a: {}, b: {} },
      angle: { result: { isOutput: true }, x: {}, y: {} },
      angleDiff: { result: { isOutput: true }, a: {}, b: {} },
      len: { result: { isOutput: true }, x: {}, y: {} },
      noise: { result: { isOutput: true }, a: {}, b: {} },
      abs: { result: { isOutput: true }, x: {} },
      log: { result: { isOutput: true }, x: {} },
      log10: { result: { isOutput: true }, x: {} },
      floor: { result: { isOutput: true }, x: {} },
      ceil: { result: { isOutput: true }, x: {} },
      sqrt: { result: { isOutput: true }, x: {} },
      rand: { result: { isOutput: true }, max: {} },
      sin: { result: { isOutput: true }, degrees: {} },
      cos: { result: { isOutput: true }, degrees: {} },
      tan: { result: { isOutput: true }, degrees: {} },
      asin: { result: { isOutput: true }, x: {} },
      acos: { result: { isOutput: true }, x: {} },
      atan: { result: { isOutput: true }, x: {} },
    },
  });

  static parse(this: void, line: TokenLine) {
    return new OpInstruction(
      line,
      ...OpInstruction.descriptor.parse(line.tokens)
    );
  }

  provideTokenSemantics(doc: MlogDocument, tokens: TokenSemanticData[]): void {
    // this tells the editor that this particular
    // use of the set instruction affects the control flow
    // just like jump
    if (
      this.data.$type !== "unknown" &&
      this.data.result?.content === counterVar
    ) {
      tokens.push({
        token: this.line.tokens[0],
        type: TokenTypes.keyword,
      });
    }
    super.provideTokenSemantics(doc, tokens);
  }
}

export class WaitInstruction extends InstructionNode<
  DataOf<typeof WaitInstruction>
> {
  descriptor = WaitInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "wait",
    descriptor: {
      seconds: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = WaitInstruction.descriptor.parse(line.tokens);

    return new WaitInstruction(line, ...data);
  }
}

export class StopInstruction extends InstructionNode<
  DataOf<typeof StopInstruction>
> {
  descriptor = StopInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "stop",
    descriptor: {},
  });

  static parse(this: void, line: TokenLine) {
    return new StopInstruction(
      line,
      ...StopInstruction.descriptor.parse(line.tokens)
    );
  }

  provideSignatureHelp(_character: number): SignatureHelp {
    return {
      signatures: [
        {
          label: "stop",
          documentation:
            "Stops the execution of instructions in the processor.",
        },
      ],
    };
  }
}

export class LookupInstruction extends InstructionNode<
  DataOf<typeof LookupInstruction>
> {
  descriptor = LookupInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "lookup",
    overloads: {
      block: { result: { isOutput: true }, id: {} },
      unit: { result: { isOutput: true }, id: {} },
      item: { result: { isOutput: true }, id: {} },
      liquid: { result: { isOutput: true }, id: {} },
      team: { result: { isOutput: true }, id: {} },
    },
  });

  static parse(this: void, line: TokenLine) {
    return new LookupInstruction(
      line,
      ...LookupInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class PackColorInstruction extends InstructionNode<
  DataOf<typeof PackColorInstruction>
> {
  descriptor = PackColorInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "packcolor",
    descriptor: {
      result: { isOutput: true },
      red: {},
      green: {},
      blue: {},
      alpha: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = PackColorInstruction.descriptor.parse(line.tokens);

    return new PackColorInstruction(line, ...data);
  }

  provideDiagnostics(doc: MlogDocument, diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(doc, diagnostics);

    const { red, green, blue, alpha } = this.data;

    for (const token of [red, green, blue, alpha]) {
      if (!token) continue;
      if (!token.isNumber()) continue;
      const { value } = token;

      if (value < 0 || value > 1) {
        diagnostics.push({
          range: token,
          message: "packcolor parameters must be within the range: [0, 1]",
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.outOfRangeValue,
        });
        // emit a warning if the number has more than 3 decimal digits
        // because with three digits the smallest step is 0.001 * 255 = 0.255
        // meaning that further precision is not necessary
      } else if (
        token.content.indexOf(".") !== -1 &&
        token.content.split(".")[1].length > 3
      ) {
        diagnostics.push({
          range: token,
          message:
            "Only 3 decimal digits are necessary for packcolor parameters.",
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.excessPackcolorPrecision,
        });
      }
    }
  }

  provideCodeActions(
    doc: MlogDocument,
    diagnostic: Diagnostic,
    actions: (CodeAction | Command)[]
  ): void {
    super.provideCodeActions(doc, diagnostic, actions);
    if (diagnostic.code !== DiagnosticCode.excessPackcolorPrecision) return;

    const number = getTargetToken(
      diagnostic.range.start.character,
      this.line.tokens
    );

    if (!number?.isNumber()) return;
    const { value } = number;
    const newText = String(Math.round(value * 10 ** 3) / 10 ** 3);

    actions.push({
      title: "Round to 3 decimal digits",
      kind: CodeActionKind.QuickFix,
      isPreferred: true,
      edit: {
        changes: {
          [doc.uri]: [TextEdit.replace(diagnostic.range, newText)],
        },
      },
      diagnostics: [diagnostic],
    });
  }

  isConstant() {
    const { red, green, blue, alpha } = this.data;

    if (red && !red.isNumber()) return false;
    if (green && !green.isNumber()) return false;
    if (blue && !blue.isNumber()) return false;
    if (alpha && !alpha.isNumber()) return false;

    return true;
  }

  getColor() {
    const { data } = this;
    let red = 0;
    if (data.red?.isNumber()) red = data.red.value;

    let green = 0;
    if (data.green?.isNumber()) green = data.green.value;

    let blue = 0;
    if (data.blue?.isNumber()) blue = data.blue.value;

    let alpha = 1;
    if (data.alpha?.isNumber()) alpha = data.alpha.value;

    return { red, green, blue, alpha };
  }
}
export class UnpackColorInstruction extends InstructionNode<
  DataOf<typeof UnpackColorInstruction>
> {
  descriptor = UnpackColorInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "unpackcolor",
    descriptor: {
      red: { isOutput: true },
      green: { isOutput: true },
      blue: { isOutput: true },
      alpha: { isOutput: true },
      value: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = UnpackColorInstruction.descriptor.parse(line.tokens);

    return new UnpackColorInstruction(line, ...data);
  }
}

export class EndInstruction extends InstructionNode<
  DataOf<typeof EndInstruction>
> {
  descriptor = EndInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "end",
    descriptor: {},
  });

  static parse(this: void, line: TokenLine) {
    return new EndInstruction(
      line,
      ...EndInstruction.descriptor.parse(line.tokens)
    );
  }
}

export class JumpInstruction extends InstructionNode<
  DataOf<typeof JumpInstruction>
> {
  descriptor = JumpInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "jump",
    pre: {
      destination: { isLabel: true },
    },
    overloads: {
      equal: { x: {}, y: {} },
      notEqual: { x: {}, y: {} },
      lessThan: { x: {}, y: {} },
      lessThanEq: { x: {}, y: {} },
      greaterThan: { x: {}, y: {} },
      greaterThanEq: { x: {}, y: {} },
      strictEqual: { x: {}, y: {} },
      always: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = JumpInstruction.descriptor.parse(line.tokens);

    return new JumpInstruction(line, ...data);
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    if (targetToken === this.data.destination) {
      return context.getLabelCompletions();
    }

    return super.provideCompletionItems(context, character);
  }

  provideCodeActions(
    doc: MlogDocument,
    diagnostic: Diagnostic,
    actions: (CodeAction | Command)[]
  ): void {
    super.provideCodeActions(doc, diagnostic, actions);

    const name = this.data.destination?.content;
    if (!name || diagnostic.code !== DiagnosticCode.undefinedLabel) return;

    const suggestion = getSpellingSuggestionForName(
      name,
      getLabelNames(doc.nodes)
    );

    if (!suggestion) return;

    actions.push(createSpellingAction(diagnostic, doc.uri, suggestion));
  }
}

export class UnitBindInstruction extends InstructionNode<
  DataOf<typeof UnitBindInstruction>
> {
  descriptor = UnitBindInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "ubind",
    descriptor: {
      unit: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = UnitBindInstruction.descriptor.parse(line.tokens);

    return new UnitBindInstruction(line, ...data);
  }
}

export class UnitControlInstruction extends InstructionNode<
  DataOf<typeof UnitControlInstruction>
> {
  descriptor = UnitControlInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "ucontrol",
    overloads: {
      idle: {},
      stop: {},
      move: { x: {}, y: {} },
      approach: { x: {}, y: {}, radius: {} },
      pathfind: { x: {}, y: {} },
      autoPathfind: {},
      boost: { enabled: {} },
      target: { x: {}, y: {}, shoot: {} },
      targetp: { unit: {}, shoot: {} },
      itemDrop: { to: {}, amount: {} },
      itemTake: { from: {}, item: {}, amount: {} },
      payDrop: {},
      payTake: { takeUnits: {} },
      payEnter: {},
      mine: { x: {}, y: {} },
      flag: { value: {} },
      build: { x: {}, y: {}, block: {}, rotation: {}, config: {} },
      getBlock: {
        x: {},
        y: {},
        type: { isOutput: true },
        building: { isOutput: true },
        floor: { isOutput: true },
      },
      within: { x: {}, y: {}, radius: {}, result: { isOutput: true } },
      unbind: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = UnitControlInstruction.descriptor.parse(line.tokens);

    return new UnitControlInstruction(line, ...data);
  }
}

export class UnitRadarinstruction extends InstructionNode<
  DataOf<typeof UnitRadarinstruction>
> {
  descriptor = UnitRadarinstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "uradar",
    descriptor: {
      filter1: {
        restrict: {
          invalidPrefix: "Invalid radar filter: ",
          values: radarFilters,
        },
      },
      filter2: {
        restrict: {
          invalidPrefix: "Invalid radar filter: ",
          values: radarFilters,
        },
      },
      filter3: {
        restrict: {
          invalidPrefix: "Invalid radar filter: ",
          values: radarFilters,
        },
      },
      sort: {
        restrict: {
          invalidPrefix: "Invalid radar sort: ",
          values: radarSorts,
        },
      },
      _: {},
      order: {},
      output: { isOutput: true },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = UnitRadarinstruction.descriptor.parse(line.tokens);

    return new UnitRadarinstruction(line, ...data);
  }
}

const unitLocateGroups = [
  "core",
  "storage",
  "generator",
  "turret",
  "factory",
  "repair",
  "battery",
  "reactor",
];

export class UnitLocateInstruction extends InstructionNode<
  DataOf<typeof UnitLocateInstruction>
> {
  descriptor = UnitLocateInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "ulocate",
    overloads: {
      ore: {
        _group: {
          restrict: {
            invalidPrefix: "Invalid unit locate group: ",
            values: unitLocateGroups,
          },
        },
        _enemy: {},
        ore: {},
        x: { isOutput: true },
        y: { isOutput: true },
        found: { isOutput: true },
      },
      building: {
        group: {
          restrict: {
            invalidPrefix: "Invalid unit locate group: ",
            values: unitLocateGroups,
          },
        },
        enemy: {},
        _ore: {},
        x: { isOutput: true },
        y: { isOutput: true },
        found: { isOutput: true },
        building: { isOutput: true },
      },
      spawn: {
        _group: {
          restrict: {
            invalidPrefix: "Invalid unit locate group: ",
            values: unitLocateGroups,
          },
        },
        _enemy: {},
        _ore: {},
        x: { isOutput: true },
        y: { isOutput: true },
        found: { isOutput: true },
        building: { isOutput: true },
      },
      damaged: {
        _group: {
          restrict: {
            invalidPrefix: "Invalid unit locate group: ",
            values: unitLocateGroups,
          },
        },
        _enemy: {},
        _ore: {},
        x: { isOutput: true },
        y: { isOutput: true },
        found: { isOutput: true },
        building: { isOutput: true },
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = UnitLocateInstruction.descriptor.parse(line.tokens);
    return new UnitLocateInstruction(line, ...data);
  }
}

export class GetBlockInstruction extends InstructionNode<
  DataOf<typeof GetBlockInstruction>
> {
  descriptor = GetBlockInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "getblock",
    overloads: {
      floor: {
        result: { isOutput: true },
        x: {},
        y: {},
      },
      ore: {
        result: { isOutput: true },
        x: {},
        y: {},
      },
      block: {
        result: { isOutput: true },
        x: {},
        y: {},
      },
      building: {
        result: { isOutput: true },
        x: {},
        y: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = GetBlockInstruction.descriptor.parse(line.tokens);

    return new GetBlockInstruction(line, ...data);
  }
}

export class SetBlockInstruction extends InstructionNode<
  DataOf<typeof SetBlockInstruction>
> {
  descriptor = SetBlockInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "setblock",
    overloads: {
      floor: {
        to: {},
        x: {},
        y: {},
      },
      ore: {
        to: {},
        x: {},
        y: {},
      },
      block: {
        to: {},
        x: {},
        y: {},
        team: {},
        rotation: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetBlockInstruction.descriptor.parse(line.tokens);

    return new SetBlockInstruction(line, ...data);
  }
}

export class SpawnUnitInstruction extends InstructionNode<
  DataOf<typeof SpawnUnitInstruction>
> {
  descriptor = SpawnUnitInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "spawn",
    descriptor: {
      unitType: {},
      x: {},
      y: {},
      rotation: {},
      team: {},
      result: { isOutput: true },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SpawnUnitInstruction.descriptor.parse(line.tokens);

    return new SpawnUnitInstruction(line, ...data);
  }
}

export class SenseWeatherInstruction extends InstructionNode<
  DataOf<typeof SenseWeatherInstruction>
> {
  descriptor = SenseWeatherInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "weathersense",
    descriptor: {
      result: { isOutput: true },
      weather: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SenseWeatherInstruction.descriptor.parse(line.tokens);

    return new SenseWeatherInstruction(line, ...data);
  }
}

export class SetWeatherInstruction extends InstructionNode<
  DataOf<typeof SetWeatherInstruction>
> {
  descriptor = SetWeatherInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "weatherset",
    descriptor: {
      weather: {},
      active: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetWeatherInstruction.descriptor.parse(line.tokens);

    return new SetWeatherInstruction(line, ...data);
  }
}

const applyStatusEffects = [
  "burning",
  "freezing",
  "unmoving",
  "slow",
  "fast",
  "wet",
  "muddy",
  "melting",
  "sapped",
  "tarred",
  "overclock",
  "shielded",
  "shocked",
  "blasted",
  "corroded",
  "spore-slowed",
  "disarmed",
  "electrified",
  "invincible",
  "boss",
  "overdrive",
] as const;

export class ApplyStatusInstruction extends InstructionNode<
  DataOf<typeof ApplyStatusInstruction>
> {
  descriptor = ApplyStatusInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "status",
    overloads: {
      // clear status effect
      true: {
        effect: {
          restrict: {
            values: applyStatusEffects,
            invalidPrefix: "Invalid status effect: ",
          },
        },
        unit: {},
      },

      // apply status effect
      false: {
        effect: {
          restrict: {
            values: applyStatusEffects,
            invalidPrefix: "Invalid status effect: ",
          },
        },
        unit: {},
        duration: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = ApplyStatusInstruction.descriptor.parse(line.tokens);

    return new ApplyStatusInstruction(line, ...data);
  }
}

export class SpawnWaveInstruction extends InstructionNode<
  DataOf<typeof SpawnWaveInstruction>
> {
  descriptor = SpawnWaveInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "spawnwave",
    descriptor: {
      x: {},
      y: {},
      natural: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const [data, params] = SpawnWaveInstruction.descriptor.parse(line.tokens);

    // x and y are not used in natural waves
    // the units will appear at the map's spawn point
    if (data.natural?.content === "true") {
      params[0].usage = ParameterUsage.ignored;
      params[1].usage = ParameterUsage.ignored;
    }

    return new SpawnWaveInstruction(line, data, params);
  }
}

export class SetRuleInstruction extends InstructionNode<
  DataOf<typeof SetRuleInstruction>
> {
  descriptor = SetRuleInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "setrule",
    overloads: {
      currentWaveTime: {
        seconds: {},
      },
      waveTimer: { enabled: {} },
      waves: { enabled: {} },
      wave: {
        waveNumber: {},
      },
      waveSpacing: {
        seconds: {},
      },
      waveSending: {
        enabled: {},
      },
      attackMode: {
        enabled: {},
      },
      enemyCoreBuildRadius: {
        radius: {},
      },
      dropZoneRadius: {
        radius: {},
      },
      unitCap: {
        amount: {},
      },
      mapArea: {
        _: {},
        x: {},
        y: {},
        width: {},
        height: {},
      },
      lighting: {
        enabled: {},
      },
      canGameOver: {
        canIt: {},
      },
      ambientLight: {
        color: {},
      },
      solarMultiplier: {
        multiplier: {},
      },
      dragMultiplier: {
        multiplier: {},
      },
      ban: {
        content: {},
      },
      unban: {
        content: {},
      },
      buildSpeed: {
        multiplier: {},
        team: {},
      },
      unitHealth: {
        multiplier: {},
        team: {},
      },
      unitBuildSpeed: {
        multiplier: {},
        team: {},
      },
      unitMineSpeed: {
        multiplier: {},
        team: {},
      },
      unitCost: {
        multiplier: {},
        team: {},
      },
      unitDamage: {
        multiplier: {},
        team: {},
      },
      blockHealth: {
        multiplier: {},
        team: {},
      },
      blockDamage: {
        multiplier: {},
        team: {},
      },
      rtsMinWeight: {
        weight: {},
        team: {},
      },
      rtsMinSquad: {
        size: {},
        team: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetRuleInstruction.descriptor.parse(line.tokens);

    return new SetRuleInstruction(line, ...data);
  }
}

export class FlushMessageInstruction extends InstructionNode<
  DataOf<typeof FlushMessageInstruction>
> {
  descriptor = FlushMessageInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "message",
    overloads: {
      notify: {
        _: {},
        success: { isOutput: true },
      },
      announce: {
        seconds: {},
        success: { isOutput: true },
      },
      toast: { seconds: {}, success: { isOutput: true } },
      mission: { _: {}, success: { isOutput: true } },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = FlushMessageInstruction.descriptor.parse(line.tokens);

    // hardcoding it like this feels bad
    // but I don't want to add a feature to the descriptor system
    // just because this single instruction wants to do
    // things this way
    const successParam = data[1][2];
    if (successParam?.token.content === waitVar) {
      successParam.usage = ParameterUsage.read;
    }

    return new FlushMessageInstruction(line, ...data);
  }
}

export class CutsceneInstruction extends InstructionNode<
  DataOf<typeof CutsceneInstruction>
> {
  descriptor = CutsceneInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "cutscene",
    overloads: {
      pan: {
        x: {},
        y: {},
        speed: {},
      },
      zoom: {
        level: {},
      },
      stop: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = CutsceneInstruction.descriptor.parse(line.tokens);

    return new CutsceneInstruction(line, ...data);
  }
}

export class EffectInstruction extends InstructionNode<
  DataOf<typeof EffectInstruction>
> {
  descriptor = EffectInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "effect",
    overloads: {
      warn: {
        x: {},
        y: {},
      },
      cross: {
        x: {},
        y: {},
      },
      blockFall: {
        x: {},
        y: {},
        _: {},
        blockType: {},
      },
      placeBlock: {
        x: {},
        y: {},
        size: {},
      },
      placeBlockSpark: {
        x: {},
        y: {},
        size: {},
      },
      breakBlock: {
        x: {},
        y: {},
        size: {},
      },
      spawn: {
        x: {},
        y: {},
      },
      trail: {
        x: {},
        y: {},
        size: {},
        color: {},
      },
      breakPop: {
        x: {},
        y: {},
        size: {},
        color: {},
      },
      smokeCloud: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      vapor: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      hit: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      hitSquare: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      shootSmall: {
        x: {},
        y: {},
        rotation: {},
        color: {},
      },
      shootBig: {
        x: {},
        y: {},
        rotation: {},
        color: {},
      },
      smokeSmall: {
        x: {},
        y: {},
        rotation: {},
      },
      smokeBig: {
        x: {},
        y: {},
        rotation: {},
      },
      smokeColor: {
        x: {},
        y: {},
        rotation: {},
        color: {},
      },
      smokeSquare: {
        x: {},
        y: {},
        rotation: {},
        color: {},
      },
      smokeSquareBig: {
        x: {},
        y: {},
        rotation: {},
        color: {},
      },
      spark: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      sparkBig: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      sparkShoot: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      sparkShootBig: {
        x: {},
        y: {},
        rotation: {},
        color: {},
      },
      drill: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      drillBig: {
        x: {},
        y: {},
        _: {},
        color: {},
      },
      lightBlock: {
        x: {},
        y: {},
        size: {},
        color: {},
      },
      explosion: {
        x: {},
        y: {},
        size: {},
      },
      smokePuff: {
        x: {},
        y: {},
        size: {},
      },
      sparkExplosion: {
        x: {},
        y: {},
        size: {},
      },
      crossExplosion: {
        x: {},
        y: {},
        size: {},
        color: {},
      },
      wave: {
        x: {},
        y: {},
        size: {},
        color: {},
      },
      bubble: {
        x: {},
        y: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = EffectInstruction.descriptor.parse(line.tokens);

    return new EffectInstruction(line, ...data);
  }
}

export class ExplosionInstruction extends InstructionNode<
  DataOf<typeof ExplosionInstruction>
> {
  descriptor = ExplosionInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "explosion",
    descriptor: {
      team: {},
      x: {},
      y: {},
      radius: {},
      damage: {},
      air: {},
      ground: {},
      pierce: {},
      effect: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = ExplosionInstruction.descriptor.parse(line.tokens);

    return new ExplosionInstruction(line, ...data);
  }
}

export class SetRateInstruction extends InstructionNode<
  DataOf<typeof SetRateInstruction>
> {
  descriptor = SetRateInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "setrate",
    descriptor: {
      rate: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetRateInstruction.descriptor.parse(line.tokens);

    return new SetRateInstruction(line, ...data);
  }
}

export class FetchInstruction extends InstructionNode<
  DataOf<typeof FetchInstruction>
> {
  descriptor = FetchInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "fetch",
    overloads: {
      unit: {
        result: { isOutput: true },
        team: {},
        index: {},
        unitType: {},
      },
      unitCount: {
        result: { isOutput: true },
        team: {},
        _: {},
        unitType: {},
      },
      player: {
        result: { isOutput: true },
        team: {},
        index: {},
      },
      playerCount: {
        result: { isOutput: true },
        team: {},
      },
      core: {
        result: { isOutput: true },
        team: {},
        index: {},
      },
      coreCount: {
        result: { isOutput: true },
        team: {},
      },
      build: {
        result: { isOutput: true },
        team: {},
        index: {},
        blockType: {},
      },
      buildCount: {
        result: { isOutput: true },
        team: {},
        _: {},
        blockType: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = FetchInstruction.descriptor.parse(line.tokens);

    return new FetchInstruction(line, ...data);
  }
}

export class SyncInstruction extends InstructionNode<
  DataOf<typeof SyncInstruction>
> {
  descriptor = SyncInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "sync",
    descriptor: {
      variable: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SyncInstruction.descriptor.parse(line.tokens);

    return new SyncInstruction(line, ...data);
  }
}

export class GetFlagInstruction extends InstructionNode<
  DataOf<typeof GetFlagInstruction>
> {
  descriptor = GetFlagInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "getflag",
    descriptor: {
      output: { isOutput: true },
      flagName: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = GetFlagInstruction.descriptor.parse(line.tokens);

    return new GetFlagInstruction(line, ...data);
  }
}

export class SetFlagInstruction extends InstructionNode<
  DataOf<typeof SetFlagInstruction>
> {
  descriptor = SetFlagInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "setflag",
    descriptor: {
      flagName: {},
      enabled: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetFlagInstruction.descriptor.parse(line.tokens);

    return new SetFlagInstruction(line, ...data);
  }
}

export class SetPropInstruction extends InstructionNode<
  DataOf<typeof SetPropInstruction>
> {
  descriptor = SetPropInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "setprop",
    descriptor: {
      property: {},
      target: {},
      value: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetPropInstruction.descriptor.parse(line.tokens);

    return new SetPropInstruction(line, ...data);
  }
}

export class PlaySoundInstruction extends InstructionNode<
  DataOf<typeof PlaySoundInstruction>
> {
  descriptor = PlaySoundInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "playsound",
    overloads: {
      // global
      false: {
        id: {},
        volume: {},
        pitch: {},
        pan: {},
        _x: {},
        _y: {},
        limit: {},
      },
      // positional
      true: {
        id: {},
        volume: {},
        pitch: {},
        _pan: {},
        x: {},
        y: {},
        limit: {},
      },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = PlaySoundInstruction.descriptor.parse(line.tokens);

    return new PlaySoundInstruction(line, ...data);
  }
}
export class SetMarkerInstruction extends InstructionNode<
  DataOf<typeof SetMarkerInstruction>
> {
  descriptor = SetMarkerInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "setmarker",
    overloads: {
      remove: { id: {} },
      world: { id: {}, bool: {} },
      minimap: { id: {}, bool: {} },
      autoscale: { id: {}, bool: {} },
      pos: { id: {}, x: {}, y: {} },
      endPos: { id: {}, x: {}, y: {} },
      drawLayer: { id: {}, layer: {} },
      color: { id: {}, color: {} },
      radius: { id: {}, radius: {} },
      stroke: { id: {}, width: {} },
      rotation: { id: {}, angle: {} },
      shape: { id: {}, sides: {}, fill: {}, outline: {} },
      flushText: { id: {}, fetch: {} },
      fontSize: { id: {}, size: {} },
      textHeight: { id: {}, height: {} },
      labelFlags: { id: {}, background: {}, outline: {} },
      texture: { id: {}, name: {} },
      textureSize: { id: {}, width: {}, height: {} },
      posi: { id: {}, index: {}, x: {}, y: {} },
      uvi: { id: {}, index: {}, x: {}, y: {} },
      colori: { id: {}, index: {}, color: {} },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = SetMarkerInstruction.descriptor.parse(line.tokens);

    return new SetMarkerInstruction(line, ...data);
  }
}

export class MakeMakerInstruction extends InstructionNode<
  DataOf<typeof MakeMakerInstruction>
> {
  descriptor = MakeMakerInstruction.descriptor;

  static readonly descriptor = createOverloadDescriptor({
    name: "makemarker",
    overloads: {
      shapeText: { id: {}, x: {}, y: {}, replace: {} },
      point: { id: {}, x: {}, y: {}, replace: {} },
      shape: { id: {}, x: {}, y: {}, replace: {} },
      text: { id: {}, x: {}, y: {}, replace: {} },
      line: { id: {}, x: {}, y: {}, replace: {} },
      texture: { id: {}, x: {}, y: {}, replace: {} },
      quad: { id: {}, x: {}, y: {}, replace: {} },
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = MakeMakerInstruction.descriptor.parse(line.tokens);

    return new MakeMakerInstruction(line, ...data);
  }
}

export class PrintLocaleInstruction extends InstructionNode<
  DataOf<typeof PrintLocaleInstruction>
> {
  descriptor = PrintLocaleInstruction.descriptor;

  static readonly descriptor = createSingleDescriptor({
    name: "printlocale",
    descriptor: {
      key: {},
    },
  });

  static parse(this: void, line: TokenLine) {
    const data = PrintLocaleInstruction.descriptor.parse(line.tokens);

    return new PrintLocaleInstruction(line, ...data);
  }
}

const instructionParsers: Record<string, (line: TokenLine) => SyntaxNode> = {
  noop: NoopInstruction.parse,
  read: ReadInstruction.parse,
  write: WriteInstruction.parse,
  draw: DrawInstruction.parse,
  print: PrintInstruction.parse,
  printchar: PrintCharInstruction.parse,
  format: FormatInstruction.parse,
  drawflush: DrawFlushInstruction.parse,
  printflush: PrintFlushInstruction.parse,
  getlink: GetLinkInstruction.parse,
  control: ControlInstruction.parse,
  radar: RadarInstruction.parse,
  sensor: SensorInstruction.parse,
  set: SetInstruction.parse,
  op: OpInstruction.parse,
  wait: WaitInstruction.parse,
  stop: StopInstruction.parse,
  lookup: LookupInstruction.parse,
  packcolor: PackColorInstruction.parse,
  unpackcolor: UnpackColorInstruction.parse,
  end: EndInstruction.parse,
  jump: JumpInstruction.parse,
  ubind: UnitBindInstruction.parse,
  ucontrol: UnitControlInstruction.parse,
  uradar: UnitRadarinstruction.parse,
  ulocate: UnitLocateInstruction.parse,
  getblock: GetBlockInstruction.parse,
  setblock: SetBlockInstruction.parse,
  spawn: SpawnUnitInstruction.parse,
  weathersense: SenseWeatherInstruction.parse,
  weatherset: SetWeatherInstruction.parse,
  status: ApplyStatusInstruction.parse,
  spawnwave: SpawnWaveInstruction.parse,
  setrule: SetRuleInstruction.parse,
  message: FlushMessageInstruction.parse,
  cutscene: CutsceneInstruction.parse,
  effect: EffectInstruction.parse,
  explosion: ExplosionInstruction.parse,
  setrate: SetRateInstruction.parse,
  fetch: FetchInstruction.parse,
  sync: SyncInstruction.parse,
  getflag: GetFlagInstruction.parse,
  setflag: SetFlagInstruction.parse,
  setprop: SetPropInstruction.parse,
  playsound: PlaySoundInstruction.parse,
  setmarker: SetMarkerInstruction.parse,
  makemarker: MakeMakerInstruction.parse,
  printlocale: PrintLocaleInstruction.parse,
};

export function getInstructionNames() {
  return Object.keys(instructionParsers);
}

function parseLine(line: TokenLine) {
  const [first] = line.tokens;

  if (first.isComment()) return new CommentLine(line);
  if (first.isIdentifier() && first.content.endsWith(":"))
    return new LabelDeclaration(line);

  const parse = instructionParsers[first.content];
  if (parse) return parse(line);

  return UnknownInstruction.parse(line);
}

export function getSyntaxNodes(lines: TokenLine[]) {
  const nodes: SyntaxNode[] = [];
  for (const line of lines) {
    nodes.push(parseLine(line));
  }

  return nodes;
}
