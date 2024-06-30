import {
  CompletionItem,
  CompletionItemKind,
  DiagnosticSeverity,
  ParameterInformation,
  SignatureHelp,
  SignatureInformation,
} from "vscode-languageserver";
import {
  CompletionContext,
  TokenSemanticData,
  getActiveParameter,
  getTargetToken,
  validateRestrictedToken,
} from "../instructions";
import {
  ParserDiagnostic,
  ParserPosition,
  TextToken,
  TokenLine,
} from "./tokenize";
import { SemanticTokenType, TokenModifiers, TokenTypes } from "../protocol";

const restrictedTokenCompletionKind = CompletionItemKind.Keyword;

interface TokenServiceProvider {
  provideTokenSemantics(tokens: TokenSemanticData[]): void;

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void;
}

export abstract class SyntaxNode {
  abstract type: string;
  isInstruction = true;
  constructor(public line: TokenLine) {}

  get start(): ParserPosition {
    return this.line.start;
  }

  get end(): ParserPosition {
    return this.line.end;
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    // TODO: makes more sense to move this to the parser
    const tokens = this.line.tokens;

    if (tokens.length > 16) {
      diagnostics.push({
        start: tokens[16].start,
        end: tokens[tokens.length - 1].end,
        message: "Line too long; may only contain 16 tokens",
        severity: DiagnosticSeverity.Error,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    return context.getVariableCompletions();
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {}

  abstract provideSignatureHelp(character: number): SignatureHelp;
}

export class CommentLine extends SyntaxNode {
  type = "CommentLine" as const;
  isInstruction = false;

  constructor(line: TokenLine) {
    super(line);
  }

  provideSignatureHelp(): SignatureHelp {
    return { signatures: [] };
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    return [];
  }
}

export class LabelDeclaration extends SyntaxNode {
  type = "LabelDeclaration" as const;
  isInstruction = false;

  name: string;

  constructor(line: TokenLine) {
    super(line);

    this.name = line.tokens[0].content.slice(0, -1);
  }

  provideSignatureHelp(): SignatureHelp {
    return { signatures: [] };
  }
}

export class NoopInstruction extends SyntaxNode {
  type = "NoopInstruction" as const;

  constructor(line: TokenLine) {
    super(line);
  }

  provideSignatureHelp(character: number): SignatureHelp {
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
export class UnknownInstruction extends SyntaxNode {
  type = "UnknownInstruction" as const;

  constructor(line: TokenLine) {
    super(line);
  }

  provideSignatureHelp(): SignatureHelp {
    return {
      signatures: [],
    };
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const [name] = this.line.tokens;
    diagnostics.push({
      message: `Unknown instruction: ${name.content}`,
      start: name.start,
      end: name.end,
      severity: DiagnosticSeverity.Warning,
    });
  }
}

export class ReadInstruction extends SyntaxNode {
  type = "ReadInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof ReadInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    output: { isOutput: true },
    target: {},
    address: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(ReadInstruction.descriptor, line.tokens);

    return new ReadInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [getDescriptorSignature(ReadInstruction.descriptor, "read")],
    };
  }
}

export class WriteInstruction extends SyntaxNode {
  type = "WriteInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof WriteInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    input: {},
    target: {},
    address: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(WriteInstruction.descriptor, line.tokens);

    return new WriteInstruction(line, data);
  }
  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [
        getDescriptorSignature(WriteInstruction.descriptor, "write"),
      ],
    };
  }
}

export class DrawInstruction extends SyntaxNode {
  type = "DrawInstruction" as const;

  constructor(
    line: TokenLine,
    public data: ReturnType<(typeof DrawInstruction.descriptor)["parse"]>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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
    },
  });

  static parse(line: TokenLine) {
    const data = DrawInstruction.descriptor.parse(line.tokens);

    return new DrawInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]) {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;
    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown draw type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });

      return;
    }

    if (type === "print") {
      validateMembers(
        DrawInstruction.descriptor.overloads.print,
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(context: CompletionContext, character: number) {
    const targetToken = getTargetToken(character, this.line.tokens);

    return DrawInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }
    if (type === "print" && this.data.alignment) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: this.data.alignment,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { type } = this.data;
    const { descriptor } = DrawInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(type),
      signatures: descriptor.getSignatures("draw"),
    };
  }
}

export class PrintInstruction extends SyntaxNode {
  type = "PrintInstruction" as const;

  constructor(line: TokenLine, public value?: TextToken) {
    super(line);
  }

  static readonly descriptor = {
    value: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const { value } = parseDescriptor(PrintInstruction.descriptor, line.tokens);

    return new PrintInstruction(line, value);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        { value: this.value },
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(PrintInstruction.descriptor, "print"),
      ],
    };
  }
}

export class FormatInstruction extends SyntaxNode {
  type = "FormatInstruction" as const;
  constructor(line: TokenLine, public value?: TextToken) {
    super(line);
  }

  static readonly descriptor = {
    value: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const { value } = parseDescriptor(
      FormatInstruction.descriptor,
      line.tokens
    );
    return new FormatInstruction(line, value);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        { value: this.value },
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(FormatInstruction.descriptor, "format"),
      ],
    };
  }
}

export class DrawFlushInstruction extends SyntaxNode {
  type = "DrawFlushInstruction" as const;

  constructor(line: TokenLine, public target?: TextToken) {
    super(line);
  }

  static readonly descriptor = {
    target: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const { target } = parseDescriptor(
      DrawFlushInstruction.descriptor,
      line.tokens
    );

    return new DrawFlushInstruction(line, target);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        { target: this.target },
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(DrawFlushInstruction.descriptor, "drawflush"),
      ],
    };
  }
}

export class PrintFlushInstruction extends SyntaxNode {
  type = "PrintFlushInstruction" as const;

  constructor(line: TokenLine, public target?: TextToken) {
    super(line);
  }

  static readonly descriptor = {
    target: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const { target } = parseDescriptor(
      PrintFlushInstruction.descriptor,
      line.tokens
    );

    return new PrintFlushInstruction(line, target);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        { target: this.target },
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(PrintFlushInstruction.descriptor, "printflush"),
      ],
    };
  }
}

export class GetLinkInstruction extends SyntaxNode {
  type = "GetLinkInstruction" as const;

  constructor(
    line: TokenLine,
    public result?: TextToken,
    public index?: TextToken
  ) {
    super(line);
  }

  static readonly descriptor = {
    result: { isOutput: true },
    index: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const { result, index } = parseDescriptor(
      GetLinkInstruction.descriptor,
      line.tokens
    );

    return new GetLinkInstruction(line, result, index);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        { result: this.result, index: this.index },
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(GetLinkInstruction.descriptor, "getlink"),
      ],
    };
  }
}

export class ControlInstruction extends SyntaxNode {
  type = "ControlInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadData<typeof ControlInstruction.descriptor.overloads>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
    overloads: {
      enabled: { building: {}, enabled: {} },
      shoot: { building: {}, x: {}, y: {}, shoot: {} },
      shootp: { building: {}, unit: {}, shoot: {} },
      config: { building: {}, value: {} },
      color: { building: {}, color: {} },
    },
  });

  static parse(line: TokenLine) {
    const data = ControlInstruction.descriptor.parse(line.tokens);

    return new ControlInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;
    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown control type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    if (targetToken === this.data.typeToken) {
      return overloadCompletionItems(ControlInstruction.descriptor.overloads);
    }

    return context.getVariableCompletions();
  }
  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { type } = this.data;

    return {
      activeParameter:
        ControlInstruction.descriptor.getActiveSignatureParameter(
          this.data,
          character,
          this.line.tokens
        ),
      activeSignature: ControlInstruction.descriptor.getActiveSignature(type),
      signatures: ControlInstruction.descriptor.getSignatures("control"),
    };
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

export class RadarInstruction extends SyntaxNode {
  type = "RadarInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof RadarInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
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
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(RadarInstruction.descriptor, line.tokens);

    return new RadarInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    validateRestrictedToken(
      this.data.filter1,
      radarFilters,
      diagnostics,
      RadarInstruction.descriptor.filter1.restrict.invalidPrefix
    );

    validateRestrictedToken(
      this.data.filter2,
      radarFilters,
      diagnostics,
      RadarInstruction.descriptor.filter2.restrict.invalidPrefix
    );

    validateRestrictedToken(
      this.data.filter3,
      radarFilters,
      diagnostics,
      RadarInstruction.descriptor.filter3.restrict.invalidPrefix
    );

    validateRestrictedToken(
      this.data.sort,
      radarSorts,
      diagnostics,
      RadarInstruction.descriptor.sort.restrict.invalidPrefix
    );
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return provideMemberCompletions(
      RadarInstruction.descriptor,
      this.data,
      context,
      targetToken
    );
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [
        getDescriptorSignature(RadarInstruction.descriptor, "radar"),
      ],
    };
  }
}

export class SensorInstruction extends SyntaxNode {
  type = "SensorInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SensorInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    output: { isOutput: true },
    target: {},
    property: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SensorInstruction.descriptor, line.tokens);

    return new SensorInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [
        getDescriptorSignature(SensorInstruction.descriptor, "sensor"),
      ],
    };
  }
}

export class SetInstruction extends SyntaxNode {
  type = "SetInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SetInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    variable: { isOutput: true },
    value: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SetInstruction.descriptor, line.tokens);

    return new SetInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [getDescriptorSignature(SetInstruction.descriptor, "set")],
    };
  }
}

export class OpInstruction extends SyntaxNode {
  type = "OpInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadData<typeof OpInstruction.descriptor.overloads>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = OpInstruction.descriptor.parse(line.tokens);

    return new OpInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;
    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown op type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    if (targetToken === this.data.typeToken) {
      return Object.keys(OpInstruction.descriptor.overloads).map(
        (type): CompletionItem => ({
          label: type,
          kind: CompletionItemKind.Operator,
        })
      );
    }

    return context.getVariableCompletions();
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.operator,
        token: typeToken,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { type } = this.data;
    return {
      activeParameter: OpInstruction.descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: OpInstruction.descriptor.getActiveSignature(type),
      signatures: OpInstruction.descriptor.getSignatures("op"),
    };
  }
}

export class WaitInstruction extends SyntaxNode {
  type = "WaitInstruction" as const;

  constructor(line: TokenLine, public seconds?: TextToken) {
    super(line);
  }

  static readonly descriptor = {
    seconds: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const { seconds } = parseDescriptor(
      WaitInstruction.descriptor,
      line.tokens
    );

    return new WaitInstruction(line, seconds);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        { duration: this.seconds },
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [getDescriptorSignature(WaitInstruction.descriptor, "wait")],
    };
  }
}

export class StopInstruction extends SyntaxNode {
  type = "StopInstruction" as const;

  constructor(line: TokenLine) {
    super(line);
  }

  static parse(line: TokenLine) {
    return new StopInstruction(line);
  }

  provideSignatureHelp(character: number): SignatureHelp {
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

export class LookupInstruction extends SyntaxNode {
  type = "LookupInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadData<typeof LookupInstruction.descriptor.overloads>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
    overloads: {
      block: { result: { isOutput: true }, id: {} },
      unit: { result: { isOutput: true }, id: {} },
      item: { result: { isOutput: true }, id: {} },
      liquid: { result: { isOutput: true }, id: {} },
    },
  });

  static parse(line: TokenLine) {
    const data = LookupInstruction.descriptor.parse(line.tokens);

    return new LookupInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;
    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown lookup type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    if (targetToken === this.data.typeToken) {
      return overloadCompletionItems(LookupInstruction.descriptor.overloads);
    }

    return context.getVariableCompletions();
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: LookupInstruction.descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: LookupInstruction.descriptor.getActiveSignature(
        this.data.type
      ),
      signatures: LookupInstruction.descriptor.getSignatures("lookup"),
    };
  }
}

export class PackColorInstruction extends SyntaxNode {
  type = "PackColorInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof PackColorInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    result: { isOutput: true },
    red: {},
    green: {},
    blue: {},
    alpha: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(PackColorInstruction.descriptor, line.tokens);

    return new PackColorInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { red, green, blue, alpha } = this.data;

    for (const token of [red, green, blue, alpha]) {
      if (!token) continue;
      if (!token.isNumber) continue;
      const value = Number(token.content);

      if (value < 0 || value > 1) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message: "packcolor parameters must be within the range: [0, 1]",
          severity: DiagnosticSeverity.Warning,
        });
        // emit a warning if the number has more than 3 decimal digits
        // because with three digits the smallest step is 0.001 * 255 = 0.255
        // meaning that further precision is not necessary
      } else if (
        token.content.indexOf(".") !== -1 &&
        token.content.split(".")[1].length > 3
      ) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message:
            "Only 3 decimal digits are necessary for packcolor parameters.",
          severity: DiagnosticSeverity.Warning,
        });
      }
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(PackColorInstruction.descriptor, "packcolor"),
      ],
    };
  }
}

export class EndInstruction extends SyntaxNode {
  type = "EndInstruction" as const;

  constructor(line: TokenLine) {
    super(line);
  }

  static parse(line: TokenLine) {
    return new EndInstruction(line);
  }

  provideSignatureHelp(): SignatureHelp {
    return {
      signatures: [
        {
          label: "end",
        },
      ],
    };
  }
}

export class JumpInstruction extends SyntaxNode {
  type = "JumpInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof JumpInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
    pre: {
      destination: {},
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

  static parse(line: TokenLine) {
    const data = JumpInstruction.descriptor.parse(line.tokens);

    return new JumpInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown jump operation: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    if (targetToken === this.data.destination) {
      return context.getLabelCompletions();
    }

    if (targetToken === this.data.typeToken) {
      return overloadCompletionItems(JumpInstruction.descriptor.overloads);
    }

    return context.getVariableCompletions();
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { destination, typeToken } = this.data;

    if (destination?.type === "identifier") {
      tokens.push({
        type: TokenTypes.function,
        token: destination,
      });
    }

    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      signatures: JumpInstruction.descriptor.getSignatures("jump"),
      activeParameter: JumpInstruction.descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: JumpInstruction.descriptor.getActiveSignature(
        this.data.type
      ),
    };
  }
}

export class UnitBindInstruction extends SyntaxNode {
  type = "UnitBindInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof UnitBindInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    unit: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(UnitBindInstruction.descriptor, line.tokens);

    return new UnitBindInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [
        getDescriptorSignature(UnitBindInstruction.descriptor, "ubind"),
      ],
    };
  }
}

export class UnitControlInstruction extends SyntaxNode {
  type = "UnitControlInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<
      typeof UnitControlInstruction.descriptor
    >
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = UnitControlInstruction.descriptor.parse(line.tokens);

    return new UnitControlInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown unit control type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return UnitControlInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter:
        UnitControlInstruction.descriptor.getActiveSignatureParameter(
          this.data,
          character,
          this.line.tokens
        ),
      activeSignature: UnitControlInstruction.descriptor.getActiveSignature(
        this.data.type
      ),
      signatures: UnitControlInstruction.descriptor.getSignatures("ucontrol"),
    };
  }
}

export class UnitRadarinstruction extends SyntaxNode {
  type = "UnitRadarinstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof UnitRadarinstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
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
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(UnitRadarinstruction.descriptor, line.tokens);

    return new UnitRadarinstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    validateMembers(UnitRadarinstruction.descriptor, this.data, diagnostics);
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    switch (targetToken) {
      case this.data.filter1:
      case this.data.filter2:
      case this.data.filter3:
        return radarFilters.map(
          (value): CompletionItem => ({
            label: value,
            kind: restrictedTokenCompletionKind,
          })
        );
      case this.data.sort:
        return radarSorts.map(
          (value): CompletionItem => ({
            label: value,
            kind: restrictedTokenCompletionKind,
          })
        );
    }

    return context.getVariableCompletions();
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { filter1, filter2, filter3, sort } = this.data;

    for (const token of [filter1, filter2, filter3]) {
      if (token) {
        tokens.push({
          type: TokenTypes.enumMember,
          token,
        });
      }
    }

    if (sort) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: sort,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      signatures: [
        getDescriptorSignature(UnitRadarinstruction.descriptor, "uradar"),
      ],
    };
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

export class UnitLocateInstruction extends SyntaxNode {
  type = "UnitLocateInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof UnitLocateInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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
        outX: {},
        outY: {},
        found: {},
        building: {},
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
        outX: {},
        outY: {},
        found: {},
        building: {},
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
        outX: {},
        outY: {},
        found: {},
        building: {},
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
        outX: {},
        outY: {},
        found: {},
        building: {},
      },
    },
  });

  static parse(line: TokenLine) {
    const data = UnitLocateInstruction.descriptor.parse(line.tokens);
    return new UnitLocateInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown unit locate type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }

    if (type !== "unknown") {
      validateMembers(
        UnitLocateInstruction.descriptor.overloads[type],
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return UnitLocateInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        UnitLocateInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = UnitLocateInstruction;
    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("ulocate"),
    };
  }
}

export class GetBlockInstruction extends SyntaxNode {
  type = "GetBlockInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof GetBlockInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = GetBlockInstruction.descriptor.parse(line.tokens);

    return new GetBlockInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown get block type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        GetBlockInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return GetBlockInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = GetBlockInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("getblock"),
    };
  }
}

export class SetBlockInstruction extends SyntaxNode {
  type = "SetBlockInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof SetBlockInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = SetBlockInstruction.descriptor.parse(line.tokens);

    return new SetBlockInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown set block type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return SetBlockInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = SetBlockInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("setblock"),
    };
  }
}

export class SpawnUnitInstruction extends SyntaxNode {
  type = "SpawnUnitInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SpawnUnitInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    unitType: {},
    x: {},
    y: {},
    rotation: {},
    team: {},
    result: { isOutput: true },
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SpawnUnitInstruction.descriptor, line.tokens);

    return new SpawnUnitInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(SpawnUnitInstruction.descriptor, "spawn"),
      ],
    };
  }
}

export class SenseWeatherInstruction extends SyntaxNode {
  type = "SenseWeatherInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SenseWeatherInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    result: { isOutput: true },
    weather: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(
      SenseWeatherInstruction.descriptor,
      line.tokens
    );

    return new SenseWeatherInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(
          SenseWeatherInstruction.descriptor,
          "weathersense"
        ),
      ],
    };
  }
}

export class SetWeatherInstruction extends SyntaxNode {
  type = "SetWeatherInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SetWeatherInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    weather: {},
    active: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SetWeatherInstruction.descriptor, line.tokens);

    return new SetWeatherInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(SetWeatherInstruction.descriptor, "weatherset"),
      ],
    };
  }
}

// TODO: update status effects
// there is one that can make you- [title card]
const applyStatusEffects = [
  "burning",
  "freezing",
  "unmoving",
  "slow",
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

export class ApplyStatusInstruction extends SyntaxNode {
  type = "ApplyStatusInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<
      typeof ApplyStatusInstruction.descriptor
    >
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = ApplyStatusInstruction.descriptor.parse(line.tokens);

    return new ApplyStatusInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown apply status type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }

    if (type !== "unknown") {
      validateMembers(
        ApplyStatusInstruction.descriptor.overloads[type],
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return ApplyStatusInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        ApplyStatusInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = ApplyStatusInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("status"),
    };
  }
}

export class SpawnWaveInstruction extends SyntaxNode {
  type = "SpawnWaveInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof SpawnWaveInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
    overloads: {
      // natural wave
      true: {},
      // synthetic wave
      false: {
        x: {},
        y: {},
      },
    },
  });

  static parse(line: TokenLine) {
    const data = SpawnWaveInstruction.descriptor.parse(line.tokens);

    return new SpawnWaveInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown spawn wave type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return SpawnWaveInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        SpawnWaveInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = SpawnWaveInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("spawnwave"),
    };
  }
}

export class SetRuleInstruction extends SyntaxNode {
  type = "SetRuleInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof SetRuleInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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
      ambientLight: {
        color: {},
      },
      solarMultiplier: {
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

  static parse(line: TokenLine) {
    const data = SetRuleInstruction.descriptor.parse(line.tokens);

    return new SetRuleInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown setrule type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }

    if (type !== "unknown") {
      validateMembers(
        SetRuleInstruction.descriptor.overloads[type],
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return SetRuleInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        SetRuleInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = SetRuleInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("setrule"),
    };
  }
}

export class FlushMessageInstruction extends SyntaxNode {
  type = "FlushMessageInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<
      typeof FlushMessageInstruction.descriptor
    >
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = FlushMessageInstruction.descriptor.parse(line.tokens);

    return new FlushMessageInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown flush message type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }

    if (type !== "unknown") {
      validateMembers(
        FlushMessageInstruction.descriptor.overloads[type],
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return FlushMessageInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        FlushMessageInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = FlushMessageInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("message"),
    };
  }
}

export class CutsceneInstruction extends SyntaxNode {
  type = "CutsceneInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof CutsceneInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = CutsceneInstruction.descriptor.parse(line.tokens);

    return new CutsceneInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown cutscene type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return CutsceneInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        CutsceneInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = CutsceneInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("cutscene"),
    };
  }
}

export class EffectInstruction extends SyntaxNode {
  type = "EffectInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof EffectInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = EffectInstruction.descriptor.parse(line.tokens);

    return new EffectInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown effect: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }

    if (type !== "unknown") {
      validateMembers(
        EffectInstruction.descriptor.overloads[type],
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return EffectInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        EffectInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = EffectInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("effect"),
    };
  }
}

export class ExplosionInstruction extends SyntaxNode {
  type = "ExplosionInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof ExplosionInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    team: {},
    x: {},
    y: {},
    radius: {},
    damage: {},
    air: {},
    ground: {},
    pierce: {},
    effect: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(ExplosionInstruction.descriptor, line.tokens);

    return new ExplosionInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(ExplosionInstruction.descriptor, "explosion"),
      ],
    };
  }
}

export class SetRateInstruction extends SyntaxNode {
  type = "SetRateInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SetRateInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    rate: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SetRateInstruction.descriptor, line.tokens);

    return new SetRateInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(SetRateInstruction.descriptor, "setrate"),
      ],
    };
  }
}

export class FetchInstruction extends SyntaxNode {
  type = "FetchInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof FetchInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = FetchInstruction.descriptor.parse(line.tokens);

    return new FetchInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown fetch type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }

    if (type !== "unknown") {
      validateMembers(
        FetchInstruction.descriptor.overloads[type],
        this.data,
        diagnostics
      );
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return FetchInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        FetchInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = FetchInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("fetch"),
    };
  }
}

export class SyncInstruction extends SyntaxNode {
  type = "SyncInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SyncInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    variable: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SyncInstruction.descriptor, line.tokens);

    return new SyncInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [getDescriptorSignature(SyncInstruction.descriptor, "sync")],
    };
  }
}

export class GetFlagInstruction extends SyntaxNode {
  type = "GetFlagInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof GetFlagInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    output: { isOutput: true },
    flagName: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(GetFlagInstruction.descriptor, line.tokens);

    return new GetFlagInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(GetFlagInstruction.descriptor, "getflag"),
      ],
    };
  }
}

export class SetFlagInstruction extends SyntaxNode {
  type = "SetFlagInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SetFlagInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    flagName: {},
    enabled: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SetFlagInstruction.descriptor, line.tokens);

    return new SetFlagInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(SetFlagInstruction.descriptor, "getflag"),
      ],
    };
  }
}

export class SetPropInstruction extends SyntaxNode {
  type = "SetPropInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof SetPropInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    property: {},
    target: {},
    value: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(SetPropInstruction.descriptor, line.tokens);

    return new SetPropInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(SetPropInstruction.descriptor, "setprop"),
      ],
    };
  }
}

export class SetMarkerInstruction extends SyntaxNode {
  type = "SetMarkerInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof SetMarkerInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = SetMarkerInstruction.descriptor.parse(line.tokens);

    return new SetMarkerInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown setmarker type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return SetMarkerInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        SetMarkerInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = SetMarkerInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("setmarker"),
    };
  }
}

export class MakeMakerInstruction extends SyntaxNode {
  type = "MakeMakerInstruction" as const;

  constructor(
    line: TokenLine,
    public data: OverloadDescriptorData<typeof MakeMakerInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = createOverloadDescriptor({
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

  static parse(line: TokenLine) {
    const data = MakeMakerInstruction.descriptor.parse(line.tokens);

    return new MakeMakerInstruction(line, data);
  }

  provideDiagnostics(diagnostics: ParserDiagnostic[]): void {
    super.provideDiagnostics(diagnostics);

    const { type, typeToken } = this.data;

    if (type === "unknown" && typeToken) {
      diagnostics.push({
        message: `Unknown makemarker type: ${typeToken.content}`,
        start: typeToken.start,
        end: typeToken.end,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  provideCompletionItems(
    context: CompletionContext,
    character: number
  ): CompletionItem[] {
    const targetToken = getTargetToken(character, this.line.tokens);

    return MakeMakerInstruction.descriptor.getCompletionItems(
      this.data,
      context,
      targetToken
    );
  }

  provideTokenSemantics(tokens: TokenSemanticData[]): void {
    const { type, typeToken } = this.data;
    if (typeToken) {
      tokens.push({
        type: TokenTypes.enumMember,
        token: typeToken,
      });
    }

    if (type !== "unknown") {
      provideMemberSemantics(
        MakeMakerInstruction.descriptor.overloads[type],
        this.data,
        tokens
      );
    }
  }

  provideSignatureHelp(character: number): SignatureHelp {
    const { descriptor } = MakeMakerInstruction;

    return {
      activeParameter: descriptor.getActiveSignatureParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: descriptor.getActiveSignature(this.data.type),
      signatures: descriptor.getSignatures("makemarker"),
    };
  }
}

export class PrintLocaleInstruction extends SyntaxNode {
  type = "PrintLocaleInstruction" as const;

  constructor(
    line: TokenLine,
    public data: DescriptorData<typeof PrintLocaleInstruction.descriptor>
  ) {
    super(line);
  }

  static readonly descriptor = {
    key: {},
  } as const satisfies SingleDescriptor;

  static parse(line: TokenLine) {
    const data = parseDescriptor(
      PrintLocaleInstruction.descriptor,
      line.tokens
    );

    return new PrintLocaleInstruction(line, data);
  }

  provideSignatureHelp(character: number): SignatureHelp {
    return {
      activeParameter: getActiveParameter(
        this.data,
        character,
        this.line.tokens
      ),
      activeSignature: 0,
      signatures: [
        getDescriptorSignature(
          PrintLocaleInstruction.descriptor,
          "printlocale"
        ),
      ],
    };
  }
}

const instructionParsers: Record<string, (line: TokenLine) => SyntaxNode> = {
  noop: (line) => new NoopInstruction(line),
  read: ReadInstruction.parse,
  write: WriteInstruction.parse,
  draw: DrawInstruction.parse,
  print: PrintInstruction.parse,
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
  setmarker: SetMarkerInstruction.parse,
  makemarker: MakeMakerInstruction.parse,
  printlocale: PrintLocaleInstruction.parse,
};

interface ParameterDescriptor {
  name: string;
  isOutput?: boolean;
  restrict?: {
    semanticType?: number;
    invalidPrefix: string;
    values: readonly string[];
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
    data[key] = token?.isComment ? undefined : token;
    i++;
  }

  return data;
}

type SingleDescriptor = Record<string, Omit<ParameterDescriptor, "name">>;
type OverloadDescriptor = Record<string, SingleDescriptor>;

type DescriptorData<T extends SingleDescriptor> = Partial<
  Record<keyof T, TextToken>
>;

type OverloadData<
  T extends Record<string, SingleDescriptor>,
  Pre extends SingleDescriptor = {}
> =
  | {
      [K in keyof T]: DescriptorData<Pre> &
        DescriptorData<T[K]> & {
          type: K;
          typeToken: TextToken;
        };
    }[keyof T]
  | (DescriptorData<Pre> & { type: "unknown"; typeToken?: TextToken });

type OverloadDescriptorData<
  T extends { pre: SingleDescriptor; overloads: OverloadDescriptor }
> = OverloadData<T["overloads"], T["pre"]>;

function tokenToNumber(token: TextToken) {
  if (token.type !== "number") return undefined;
  return Number(token.content);
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

export function getInstructionNames() {
  return Object.keys(instructionParsers);
}

function validateMembers<T extends SingleDescriptor>(
  descriptor: T,
  data: DescriptorData<T>,
  diagnostics: ParserDiagnostic[]
) {
  for (const key in descriptor) {
    const token = data[key];
    if (!token) break;
    const param = descriptor[key];
    const isIgnored = key.startsWith("_");

    if (param.restrict) {
      validateRestrictedToken(
        token,
        param.restrict.values,
        diagnostics,
        param.restrict.invalidPrefix
      );
    } else if (isIgnored && token.content !== "_") {
      diagnostics.push({
        start: token.start,
        end: token.end,
        message: `This parameter is ignored by this instruction. Replace it with an underscore.`,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }
}

function provideMemberSemantics<T extends SingleDescriptor>(
  descriptor: T,
  data: DescriptorData<T>,
  tokens: TokenSemanticData[]
) {
  for (const key in descriptor) {
    const token = data[key];
    if (!token) break;
    const param = descriptor[key];

    if (param.restrict) {
      tokens.push({
        type: param.restrict.semanticType ?? TokenTypes.enumMember,
        token,
      });
    } else if (token.type === "identifier" && token.content.startsWith("@")) {
      tokens.push({
        type: TokenTypes.variable,
        modifiers: TokenModifiers.readonly,
        token,
      });
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

function parseLine(line: TokenLine) {
  const [first] = line.tokens;

  if (first.isComment) return new CommentLine(line);
  if (first.isLabel) return new LabelDeclaration(line);

  const parse = instructionParsers[first.content];
  if (parse) return parse(line);

  return new UnknownInstruction(line);
}

export function getSyntaxNodes(lines: TokenLine[]) {
  const nodes: SyntaxNode[] = [];
  for (const line of lines) {
    nodes.push(parseLine(line));
  }

  return nodes;
}

function createOverloadDescriptor<
  const T extends OverloadDescriptor,
  const Pre extends SingleDescriptor = {}
>({ pre, overloads }: { pre?: Pre; overloads: T }) {
  const preKeys = pre ? Object.keys(pre) : [];
  const typeTokenIndex = preKeys.length + 1;

  return {
    pre: pre ?? ({} as Pre),
    overloads,
    parse(tokens: TextToken[]): OverloadData<T, Pre> {
      const preData = pre
        ? parseDescriptor(pre, tokens)
        : ({} as any as DescriptorData<Pre>);

      const typeToken = tokens[typeTokenIndex];

      if (tokens.length > typeTokenIndex) {
        let key: keyof T;
        for (key in overloads) {
          const params = overloads[key];
          if (typeToken.content !== key) continue;

          return {
            ...preData,
            ...parseDescriptor(params, tokens, typeTokenIndex + 1),
            type: key,
            typeToken,
          };
        }
      }

      return { ...preData, type: "unknown", typeToken };
    },

    getSignatures(prefix: string): SignatureInformation[] {
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
    getActiveSignature(key: string): number {
      let i = 0;
      for (let current in overloads) {
        if (current === key) return i;
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
      if (data.type === "unknown" && preKeys.length === 0) return -1;

      const keys = [...preKeys];

      if (data.type !== "unknown") {
        const parameters = overloads[data.type];
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
      if (targetToken === data.typeToken) {
        return overloadCompletionItems(overloads);
      }

      for (const key in data) {
        const value = data[key];
        if (typeof value === "string") continue;

        if (value !== targetToken) continue;

        const param = pre?.[key] ?? overloads[data.type][key];

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
  };
}
