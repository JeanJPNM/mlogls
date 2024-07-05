import {
  CompletionItem,
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupContent,
  MarkupKind,
  ParameterInformation,
  SignatureHelp,
  SignatureInformation,
} from "vscode-languageserver";
import { type ParserDiagnostic, TextToken } from "./parser/tokenize";
import { DiagnosticCode, TokenTypes } from "./protocol";

export interface TokenSemanticData {
  token: TextToken;
  type: number;
  modifiers?: number;
}

export interface InstructionHandler<Data> {
  // mark as potentially undefined
  // for safe index access when parsing
  parse(tokens: (TextToken | undefined)[]): Data;

  getOutputs(data: Data): string[];

  provideCompletionItems(params: {
    data: Data;
    offset: number;
    context: CompletionContext;
    tokens: TextToken[];
  }): CompletionItem[];

  provideDiagnostics(data: Data): ParserDiagnostic[];

  provideTokenSemantics(data: Data, tokens: TokenSemanticData[]): void;

  provideSignatureHelp(params: {
    data: Data;
    offset: number;
    tokens: TextToken[];
  }): SignatureHelp;

  // provideColor(data: Data): ColorInformation[];

  // provideColorPresentation(data: Data): ColorPresentation[];
}

interface ParameterDescriptor {
  name: string;
  isOutput?: boolean;
  restrict?: {
    invalidPrefix: string;
    values: string[];
  };
}

type InstructionDescriptor =
  | (
      | ParameterDescriptor
      | { overloads: Record<string, ParameterDescriptor[]> }
    )[];

interface InstructionHandlerOptions<Data> {
  descriptor?: InstructionDescriptor;
  parse: InstructionHandler<Data>["parse"];
  provideCompletionItems: InstructionHandler<Data>["provideCompletionItems"];
  getOutputs?(data: Data): (TextToken | undefined)[];
  provideDiagnostics?(data: Data): ParserDiagnostic[];
  provideTokenSemantics?(data: Data, tokens: TokenSemanticData[]): void;
  provideSignatureHelp: InstructionHandler<Data>["provideSignatureHelp"];
  // provideColor(data: Data): ColorInformation[];
  // provideColorPresentation(data: Data): ColorPresentation[];
}

export interface CompletionContext {
  getVariableCompletions(): CompletionItem[];
  getLabelCompletions(): CompletionItem[];
}

const instructionHandlers: Record<string, InstructionHandler<unknown>> = {};

export function getInstructionHandler(
  id: string
): InstructionHandler<unknown> | undefined {
  return instructionHandlers[id];
}

export function getInstructionCodes() {
  return Object.keys(instructionHandlers);
}

function defineInstruction<Data>(
  id: string,
  options: InstructionHandlerOptions<Data>
) {
  // const hasOverloads = !Array.isArray(options.descriptor);
  const handler: InstructionHandler<Data> = {
    parse(tokens) {
      const data = options.parse(tokens);
      // const data: InstructionData = {};
      // if (hasOverloads) {
      //   const [, type, ...rest] = tokens;
      //   data[overloadKey] = type;

      //   const descriptor = options.descriptor[type?.content];
      //   if (!descriptor) return null;

      //   for (let i = 0; i < descriptor.length; i++) {
      //     const token = rest[i];
      //     if (!token) return null;
      //     data[descriptor[i].name] = token.content;
      //   }
      //   return data as unknown as Data;
      // }

      // const descriptor = options.descriptor;
      // for (let i = 0; i < descriptor.length; i++) {
      //   const token = tokens[i];
      //   if (!token) return null;
      //   data[descriptor[i].name] = token.content;
      // }
      return data;
    },
    provideCompletionItems: options.provideCompletionItems,
    provideDiagnostics(data) {
      return options.provideDiagnostics?.(data) ?? [];
    },
    getOutputs(data) {
      //   TODO: give warning when writing to readonly variables
      if (!options.getOutputs) return [];
      const names: string[] = [];
      for (const token of options.getOutputs(data)) {
        if (!token || token.isConstant) continue;

        names.push(token.content);
      }
      return names;
    },
    provideTokenSemantics(data, tokens) {
      if (!options.provideTokenSemantics) return [];
      options.provideTokenSemantics(data, tokens);
    },
    provideSignatureHelp: options.provideSignatureHelp,
  };
  instructionHandlers[id] = handler;
}

const restrictedTokenCompletionKind = CompletionItemKind.Value;
const restrictedTokenSemanticType = TokenTypes.keyword;

defineInstruction("noop", {
  descriptor: [],
  parse() {
    return null;
  },
  provideCompletionItems() {
    return [];
  },
  provideSignatureHelp() {
    return { signatures: [] };
  },
});

defineInstruction("read", {
  descriptor: [
    { name: "output", isOutput: true },
    { name: "target" },
    { name: "address" },
  ],
  parse(tokens) {
    const [, output, target, address] = tokens;
    return { output, target, address };
  },
  getOutputs(data) {
    return [data.output];
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { output, target, address } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken || !output || !target || !address)
      return context.getVariableCompletions();
    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("read <output> <target> <address>")],
    };
  },
});

defineInstruction("write", {
  descriptor: [{ name: "input" }, { name: "target" }, { name: "address" }],
  parse(tokens) {
    const [, input, target, address] = tokens;
    return { input, target, address };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { input, target, address } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken || !input || !target || !address)
      return context.getVariableCompletions();
    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature("write <value> <target> <address>", {
          signature: "Writes a number to the given memory cell",
          "<value>": "The number to write",
          "<target>": "The memory cell to write to",
          "<address>": "The address to write to",
        }),
      ],
    };
  },
});

const drawTypes = [
  "clear",
  "color",
  "col",
  "stroke",
  "line",
  "rect",
  "lineRect",
  "poly",
  "linePoly",
  "triangle",
  "image",
  "print",
];

defineInstruction("draw", {
  descriptor: [
    {
      overloads: {
        clear: [{ name: "red" }, { name: "green" }, { name: "blue" }],
        color: [
          { name: "red" },
          { name: "green" },
          { name: "blue" },
          { name: "alpha" },
        ],
        col: [{ name: "color" }],
        stroke: [{ name: "width" }],
        line: [{ name: "x1" }, { name: "y1" }, { name: "x2" }, { name: "y2" }],
        rect: [
          { name: "x" },
          { name: "y" },
          { name: "width" },
          { name: "height" },
        ],
        lineRect: [
          { name: "x" },
          { name: "y" },
          { name: "width" },
          { name: "height" },
        ],
        poly: [
          { name: "x" },
          { name: "y" },
          { name: "sides" },
          { name: "radius" },
          { name: "rotation" },
        ],
        linePoly: [
          { name: "x" },
          { name: "y" },
          { name: "sides" },
          { name: "radius" },
          { name: "rotation" },
        ],
        triangle: [
          { name: "x1" },
          { name: "y1" },
          { name: "x2" },
          { name: "y2" },
          { name: "x3" },
          { name: "y3" },
        ],
        image: [
          { name: "x" },
          { name: "y" },
          { name: "image" },
          { name: "size" },
          { name: "rotation" },
        ],
        print: [
          { name: "x" },
          { name: "y" },
          {
            name: "align",
            restrict: {
              invalidPrefix: "Invalid print align: ",
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
        ],
      },
    },
  ],
  parse(tokens) {
    const [, type, x, y, p1, p2, p3, p4] = tokens;
    return {
      type,
      x,
      y,
      p1,
      p2,
      p3,
      p4,
    };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      drawTypes,
      diagnostics,
      "Unknown draw type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { type, x, y, p1, p2, p3, p4 } = data;

    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return drawTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case x:
      case y:
      case p1:
      case p2:
      case p3:
      case p4:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    // TODO: see if having hardcoded indexes is a good idea
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(drawTypes, data.type),
      signatures: [
        parseSignature("draw clear <red> <green> <blue>"),
        parseSignature("draw color <red> <green> <blue> <alpha>"),
        parseSignature("draw col <color>"),
        parseSignature("draw stroke <width>"),
        parseSignature("draw line <x1> <y1> <x2> <y2>"),
        parseSignature("draw rect <x> <y> <width> <height>"),
        parseSignature("draw lineRect <x> <y> <width> <height>"),
        parseSignature("draw poly <x> <y> <sides> <radius> <rotation>"),
        parseSignature("draw linePoly <x> <y> <sides> <radius> <rotation>"),
        parseSignature("draw triangle <x1> <y1> <x2> <y2> <x3> <y3>"),
        parseSignature("draw image <x> <y> <image> <size> <rotation>"),
        parseSignature("draw print <x> <y> <align>"),
      ],
    };
  },
});

defineInstruction("print", {
  descriptor: [{ name: "value" }],
  parse(tokens) {
    const [, value] = tokens;
    return { value };
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { value } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken === value) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("print <value>")],
    };
  },
});

defineInstruction("format", {
  descriptor: [{ name: "value" }],
  parse(tokens) {
    const [, value] = tokens;
    return { value };
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { value } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken === value) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("format <value>")],
    };
  },
});

defineInstruction("drawflush", {
  descriptor: [{ name: "target" }],
  parse(tokens) {
    const [, target] = tokens;
    return { target };
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { target } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken === target) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("drawflush <target>")],
    };
  },
});

defineInstruction("printflush", {
  descriptor: [{ name: "target" }],
  parse(tokens) {
    const [, target] = tokens;
    return { target };
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { target } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken === target) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("printflush <target>")],
    };
  },
});

defineInstruction("getlink", {
  descriptor: [{ name: "result", isOutput: true }, { name: "index" }],
  parse(tokens) {
    const [, result, link] = tokens;
    return { result, link };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideCompletionItems(params) {
    const { data, context, offset, tokens } = params;
    const { result, link } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case result:
      case link:
        return context.getVariableCompletions();
    }
    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("getlink <result> <index>")],
    };
  },
});

const controlTypes = ["enabled", "shoot", "shootp", "config", "color"];

defineInstruction("control", {
  parse(tokens) {
    const [, type, target, p1, p2, p3, p4] = tokens;
    return { type, target, p1, p2, p3, p4 };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      controlTypes,
      diagnostics,
      "Unknown control type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { type, target, p1, p2, p3, p4 } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return controlTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case target:
      case p1:
      case p2:
      case p3:
      case p4:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(controlTypes, data.type),
      signatures: [
        parseSignature("control enabled <building>"),
        parseSignature("control shoot <building> <x> <y> <shoot>"),
        parseSignature("control shootp <building> <unit> <shoot>"),
        parseSignature("control config <building> <value>"),
        parseSignature("control color <building> <value>"),
      ],
    };
  },
});

const radarFilters = [
  "any",
  "enemy",
  "player",
  "ally",
  "attacker",
  "flying",
  "boss",
  "ground",
];

const radarSorts = ["distance", "health", "shield", "armor", "maxHealth"];

defineInstruction("radar", {
  parse(tokens) {
    const [, filter1, filter2, filter3, sort, radar, order, output] = tokens;

    return {
      filter1,
      filter2,
      filter3,
      sort,
      radar,
      order,
      output,
    };
  },
  getOutputs(data) {
    return [data.output];
  },
  provideDiagnostics(data) {
    const { filter1, filter2, filter3, sort } = data;
    const diagnostics: ParserDiagnostic[] = [];

    for (const filter of [filter1, filter2, filter3]) {
      validateRestrictedToken(
        filter,
        radarFilters,
        diagnostics,
        "Unknown radar filter: "
      );
    }

    validateRestrictedToken(
      sort,
      radarSorts,
      diagnostics,
      "Unknown radar sort: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { filter1, filter2, filter3, radar, order, sort, output } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case filter1:
      case filter2:
      case filter3:
        return radarFilters.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case sort:
        return radarSorts.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case radar:
      case order:
      case output:
        return context.getVariableCompletions();
    }
    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 2, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 3, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 4, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature(
          "radar <filter1> <filter2> <filter3> <sort> <radar> <order> <output>"
        ),
      ],
    };
  },
});

defineInstruction("sensor", {
  descriptor: [
    { name: "output", isOutput: true },
    { name: "value" },
    { name: "property" },
  ],
  parse(tokens) {
    const [, to, from, type] = tokens;
    return { to, from, type };
  },
  getOutputs(data) {
    return [data.to];
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { to, from, type } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case to:
      case from:
      case type:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("sensor <output> <value> <property>")],
    };
  },
});

defineInstruction("set", {
  descriptor: [{ name: "variable", isOutput: true }, { name: "value" }],
  parse(tokens) {
    const [, to, from] = tokens;
    return { to, from };
  },
  getOutputs(data) {
    return [data.to];
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { to, from } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case to:
      case from:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("set <variable> <value>")],
    };
  },
});

const operationTypes = [
  "add",
  "sub",
  "mul",
  "div",
  "idiv",
  "mod",
  "pow",
  "equal",
  "notEqual",
  "land",
  "lessThan",
  "lessThanEq",
  "greaterThan",
  "greaterThanEq",
  "strictEqual",
  "shl",
  "shr",
  "or",
  "and",
  "xor",
  "not",
  "max",
  "min",
  "angle",
  "angleDiff",
  "len",
  "noise",
  "abs",
  "log",
  "log10",
  "floor",
  "ceil",
  "sqrt",
  "rand",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
];

defineInstruction("op", {
  parse(tokens) {
    const [, type, result, a, b] = tokens;
    return { type, result, a, b };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      operationTypes,
      diagnostics,
      "Unknown operator: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { type, result, a, b } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return operationTypes.map((type) => ({
          label: type,
          kind: CompletionItemKind.Operator,
        }));
      case result:
      case a:
      case b:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, TokenTypes.operator);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(operationTypes, data.type),
      signatures: [
        parseSignature("op add <result> <a> <b>"),
        parseSignature("op sub <result> <a> <b>"),
        parseSignature("op mul <result> <a> <b>"),
        parseSignature("op div <result> <a> <b>"),
        parseSignature("op idiv <result> <a> <b>"),
        parseSignature("op mod <result> <x>"),
        parseSignature("op pow <result> <x> <y>"),
        parseSignature("op equal <result> <a> <b>"),
        parseSignature("op notEqual <result> <a> <b>"),
        parseSignature("op land <result> <a> <b>"),
        parseSignature("op lessThan <result> <a> <b>"),
        parseSignature("op lessThanEq <result> <a> <b>"),
        parseSignature("op greaterThan <result> <a> <b>"),
        parseSignature("op greaterThanEq <result> <a> <b>"),
        parseSignature("op strictEqual <result> <a> <b>"),
        parseSignature("op shl <result> <x> <y>"),
        parseSignature("op shr <result> <x> <y>"),
        parseSignature("op or <result> <a> <b>"),
        parseSignature("op and <result> <a> <b>"),
        parseSignature("op xor <result> <a> <b>"),
        parseSignature("op not <result> <x>"),
        parseSignature("op max <result> <a> <b>"),
        parseSignature("op min <result> <a> <b>"),
        parseSignature("op angle <result> <x> <y>"),
        parseSignature("op angleDiff <result> <a> <b>"),
        parseSignature("op len <result> <x> <y>"),
        parseSignature("op noise <result> <a> <b>"),
        parseSignature("op abs <result> <x>"),
        parseSignature("op log <result> <x>"),
        parseSignature("op log10 <result> <x>"),
        parseSignature("op floor <result> <x>"),
        parseSignature("op ceil <result> <x>"),
        parseSignature("op sqrt <result> <x>"),
        parseSignature("op rand <result> <x>"),
        parseSignature("op sin <result> <x>"),
        parseSignature("op cos <result> <x>"),
        parseSignature("op tan <result> <x>"),
        parseSignature("op asin <result> <x>"),
        parseSignature("op acos <result> <x>"),
        parseSignature("op atan <result> <x>"),
      ],
    };
  },
});

defineInstruction("wait", {
  parse(tokens) {
    const [, value] = tokens;
    return { value };
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { value } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken === value) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("wait <value>")],
    };
  },
});

defineInstruction("stop", {
  parse() {
    return null;
  },
  provideCompletionItems() {
    return [];
  },
  provideSignatureHelp(params) {
    return { signatures: [] };
  },
});

const lookupTypes = ["block", "unit", "item", "liquid"];

defineInstruction("lookup", {
  parse(tokens) {
    const [, type, result, id] = tokens;
    return { type, result, id };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      lookupTypes,
      diagnostics,
      "Unknown lookup type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, result, id } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return lookupTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case result:
      case id:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(lookupTypes, data.type),
      signatures: [
        parseSignature("lookup block <result> <index>"),
        parseSignature("lookup unit <result> <index>"),
        parseSignature("lookup item <result> <index>"),
        parseSignature("lookup liquid <result> <index>"),
      ],
    };
  },
});

defineInstruction("packcolor", {
  parse(tokens) {
    const [, result, r, g, b, a] = tokens;
    return { result, r, g, b, a };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideDiagnostics(data) {
    const { r, g, b, a } = data;

    const diagnostics: ParserDiagnostic[] = [];

    for (const token of [r, g, b, a]) {
      if (!token) continue;
      if (!token.isNumber) continue;
      const value = Number(token.content);

      if (value >= 0 && value <= 1) continue;

      diagnostics.push({
        start: token.start,
        end: token.end,
        message: "packcolor parameters must be within the range: [0, 1]",
        severity: DiagnosticSeverity.Warning,
      });
    }

    return diagnostics;
  },

  provideCompletionItems({ data, offset, context, tokens }) {
    const { result, r, g, b, a } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case result:
      case r:
      case g:
      case b:
      case a:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("packcolor <result> <r> <g> <b> <a>")],
    };
  },
});

defineInstruction("end", {
  parse() {
    return null;
  },
  provideCompletionItems() {
    return [];
  },
  provideSignatureHelp() {
    return { signatures: [] };
  },
});

const jumpConditionTypes = [
  "equal",
  "notEqual",
  "lessThan",
  "lessThanEq",
  "greaterThan",
  "greaterThanEq",
  "strictEqual",
  "always",
];

defineInstruction("jump", {
  parse(tokens) {
    const [, dest, type, value, compare] = tokens;
    return { dest, type, value, compare };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      jumpConditionTypes,
      diagnostics,
      "Unknown jump type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { dest, type, value, compare } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case dest:
        return context.getLabelCompletions();
      case type:
        return jumpConditionTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case value:
      case compare:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    if (!data.dest?.isNumber) {
      setSemanticTokenType(tokens, 1, TokenTypes.function);
    }
    setSemanticTokenType(tokens, 2, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(jumpConditionTypes, data.type),
      signatures: [
        parseSignature("jump <dest> equal <a> <b>"),
        parseSignature("jump <dest> notEqual <a> <b>"),
        parseSignature("jump <dest> lessThan <a> <b>"),
        parseSignature("jump <dest> lessThanEq <a> <b>"),
        parseSignature("jump <dest> greaterThan <a> <b>"),
        parseSignature("jump <dest> greaterThanEq <a> <b>"),
        parseSignature("jump <dest> strictEqual <a> <b>"),
        parseSignature("jump <dest> always"),
      ],
    };
  },
});

defineInstruction("ubind", {
  parse(tokens) {
    const [, target] = tokens;
    return { target };
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { target } = data;
    const targetToken = getTargetToken(offset, tokens);
    if (targetToken === target) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("ubind <target>")],
    };
  },
});

const unitControlTypes = [
  "idle",
  "stop",
  "move",
  "approach",
  "pathfind",
  "autoPathfind",
  "boost",
  "target",
  "targetp",
  "itemDrop",
  "itemTake",
  "payDrop",
  "payTake",
  "payEnter",
  "mine",
  "flag",
  "build",
  "getBlock",
  "within",
  "unbind",
];

defineInstruction("ucontrol", {
  parse(tokens) {
    const [, type, p1, p2, p3, p4] = tokens;
    return { type, p1, p2, p3, p4 };
  },
  getOutputs(data) {
    switch (data.type?.content) {
      case "getBlock":
        return [data.p2, data.p3, data.p4];
      case "within":
        return [data.p4];
    }
    return [];
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      unitControlTypes,
      diagnostics,
      "Unknown control type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { type, p1, p2, p3, p4 } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return unitControlTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case p1:
      case p2:
      case p3:
      case p4:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(unitControlTypes, data.type),
      signatures: [
        parseSignature("ucontrol idle"),
        parseSignature("ucontrol stop"),
        parseSignature("ucontrol move <x> <y>"),
        parseSignature("ucontrol approach <x> <y> <radius>"),
        parseSignature("ucontrol pathfind <x> <y>"),
        parseSignature("ucontrol autoPathfind"),
        parseSignature("ucontrol boost <enabled>"),
        parseSignature("ucontrol target <x> <y> <shoot>"),
        parseSignature("ucontrol targetp <unit> <shoot>"),
        parseSignature("ucontrol itemDrop <item> <amount>"),
        parseSignature("ucontrol itemTake <from> <item> <amount>"),
        parseSignature("ucontrol payDrop"),
        parseSignature("ucontrol payTake <takeUnits>"),
        parseSignature("ucontrol payEnter"),
        parseSignature("ucontrol mine <x> <y>"),
        parseSignature("ucontrol flag <flag>"),
        parseSignature("ucontrol build <x> <y> <block> <rotation> <config>"),
        parseSignature(
          "ucontrol getBlock <x> <y> <outType> <outBuilding> <outFloor>"
        ),
        parseSignature("ucontrol within <x> <y> <radius> <result>"),
        parseSignature("ucontrol unbind"),
      ],
    };
  },
});

defineInstruction("uradar", {
  parse(tokens) {
    const [, filter1, filter2, filter3, sort, ignored, order, output] = tokens;

    return {
      filter1,
      filter2,
      filter3,
      sort,
      ignored,
      order,
      output,
    };
  },
  getOutputs(data) {
    return [data.output];
  },
  provideDiagnostics(data) {
    const { filter1, filter2, filter3, sort, ignored } = data;
    const diagnostics: ParserDiagnostic[] = [];

    for (const filter of [filter1, filter2, filter3]) {
      validateRestrictedToken(
        filter,
        radarFilters,
        diagnostics,
        "Unknown radar filter: "
      );
    }
    validateRestrictedToken(
      sort,
      radarSorts,
      diagnostics,
      "Unknown radar sort: "
    );

    validateIgnoredToken(ignored, diagnostics);

    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { filter1, filter2, filter3, order, sort, output, ignored } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case filter1:
      case filter2:
      case filter3:
        return radarFilters.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case sort:
        return radarSorts.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case ignored:
        return [
          { label: "_", kind: CompletionItemKind.Constant },
          { label: "0", kind: CompletionItemKind.Constant },
        ];
      case order:
      case output:
        return context.getVariableCompletions();
    }
    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 2, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 3, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 4, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature(
          "uradar <filter1> <filter2> <filter3> <sort> <ignored> <order> <output>"
        ),
      ],
    };
  },
});

const unitLocateTypes = ["ore", "building", "spawn", "damaged"];
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

defineInstruction("ulocate", {
  parse(tokens) {
    const [, type, group, enemy, ore, outX, outY, outFound, outBuilding] =
      tokens;

    return {
      type,
      group,
      enemy,
      ore,
      outX,
      outY,
      outFound,
      outBuilding,
    };
  },
  getOutputs(data) {
    return [data.outX, data.outY, data.outFound, data.outBuilding];
  },
  provideDiagnostics(data) {
    const { type, group } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      unitLocateTypes,
      diagnostics,
      "Unknown unit locate type: "
    );
    validateRestrictedToken(
      group,
      unitLocateGroups,
      diagnostics,
      "Unknown unit locate group: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, context, offset, tokens }) {
    const { type, group, enemy, ore, outX, outY, outFound, outBuilding } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return unitLocateTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case group:
        return unitLocateGroups.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case enemy:
      case ore:
      case outX:
      case outY:
      case outFound:
      case outBuilding:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 2, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature(
          "ulocate <type> <group> <enemy> <ore> <outX> <outY> <outFound> <outBuilding>"
        ),
      ],
    };
  },
});

const getBlockTypes = ["floor", "ore", "block", "building"];

defineInstruction("getblock", {
  parse(tokens) {
    const [, type, result, x, y] = tokens;
    return { type, result, x, y };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      getBlockTypes,
      diagnostics,
      "Unknown block type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, result, x, y } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return getBlockTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case result:
      case x:
      case y:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("getblock <type> <result> <x> <y>")],
    };
  },
});

const setBlockTypes = ["floor", "ore", "block"];

defineInstruction("setblock", {
  parse(tokens) {
    const [, type, x, y, team, rotation] = tokens;
    return { type, x, y, team, rotation };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      setBlockTypes,
      diagnostics,
      "Unknown block type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, x, y, team, rotation } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return setBlockTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case x:
      case y:
      case team:
      case rotation:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(setBlockTypes, data.type),
      signatures: [
        parseSignature("setblock floor <x> <y>"),
        parseSignature("setblock ore <x> <y>"),
        parseSignature("setblock building <x> <y> <team> <rotation>"),
      ],
    };
  },
});

defineInstruction("spawn", {
  parse(tokens) {
    const [, type, x, y, rotation, team, result] = tokens;
    return { type, x, y, rotation, team, result };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, x, y, rotation, team, result } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return setBlockTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case x:
      case y:
      case rotation:
      case team:
      // TODO:what to complete on out variables?
      case result:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature("spawn <type> <x> <y> <rotation> <team> <result>"),
      ],
    };
  },
});

const applyStatusClearTypes = ["true", "false"];
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
];

defineInstruction("status", {
  parse(tokens) {
    const [, clear, effect, unit, duration] = tokens;
    return { clear, effect, unit, duration };
  },

  provideDiagnostics(data) {
    const { clear, effect } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      clear,
      applyStatusClearTypes,
      diagnostics,
      "Unknown status clear value: "
    );
    validateRestrictedToken(
      effect,
      applyStatusEffects,
      diagnostics,
      "Unknown status effect: "
    );
    return diagnostics;
  },

  provideCompletionItems({ data, offset, context, tokens }) {
    const { clear, effect, unit, duration } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case clear:
        return applyStatusClearTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case effect:
        return applyStatusEffects.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case unit:
      case duration:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
    setSemanticTokenType(tokens, 2, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    // status false electrified unit 10
    // status true electrified unit 10

    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(applyStatusClearTypes, data.clear),
      signatures: [
        parseSignature("status clear=true <effect> <unit>"),
        parseSignature("status clear=false <effect> <unit> <duration>"),
      ],
    };
  },
});

const spawnWaveTypes = ["true", "false"];

defineInstruction("spawnwave", {
  parse(tokens) {
    const [, natural, x, y] = tokens;
    return { natural, x, y };
  },
  provideDiagnostics(data) {
    const { natural } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      natural,
      spawnWaveTypes,
      diagnostics,
      "Unknown spawnwave type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { natural, x, y } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case natural:
        return spawnWaveTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      //  TODO: don't suggest anything if natural is true
      case x:
      case y:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(spawnWaveTypes, data.natural),
      signatures: [
        parseSignature("spawnwave natural=true"),
        parseSignature("spawnwave natural=false <x> <y>"),
      ],
    };
  },
});

const logicRules = [
  "currentWaveTime",
  "waveTimer",
  "waves",
  "wave",
  "waveSpacing",
  "waveSending",
  "attackMode",
  "enemyCoreBuildRadius",
  "dropZoneRadius",
  "unitCap",
  "mapArea",
  "lighting",
  "ambientLight",
  "solarMultiplier",
  "ban",
  "unban",
  "buildSpeed",
  "unitHealth",
  "unitBuildSpeed",
  "unitCost",
  "unitDamage",
  "blockHealth",
  "blockDamage",
  "rtsMinWeight",
  "rtsMinSquad",
];

defineInstruction("setrule", {
  parse(tokens) {
    const [, value, p1, p2, p3, p4] = tokens;
    return { value, p1, p2, p3, p4 };
  },
  provideDiagnostics(data) {
    const { value } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(value, logicRules, diagnostics, "Unknown rule: ");

    if (value?.content === "mapArea") {
      validateIgnoredToken(data.p1, diagnostics);
    }
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { value, p1, p2, p3, p4 } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case value:
        return logicRules.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case p1:
      case p2:
      case p3:
      case p4:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(logicRules, data.value),
      signatures: [
        parseSignature("setrule currentWaveTime <seconds>"),
        parseSignature("setrule waveTimer <enabled>"),
        parseSignature("setrule waves <enabled>"),
        parseSignature("setrule wave <number>"),
        parseSignature("setrule waveSpacing <seconds>"),
        parseSignature("setrule waveSending <enabled>"),
        parseSignature("setrule attackMode <enabled>"),
        parseSignature("setrule enemyCoreBuildRadius <radius>"),
        parseSignature("setrule dropZoneRadius <radius>"),
        parseSignature("setrule unitCap <number>"),
        parseSignature("setrule mapArea <ignored> <x> <y> <width> <height>"),
        parseSignature("setrule lighting <enabled>"),
        parseSignature("setrule ambientLight <color>"),
        parseSignature("setrule solarMultiplier <multiplier>"),
        parseSignature("setrule ban <content>"),
        parseSignature("setrule unban <content>"),
        parseSignature("setrule buildSpeed <multiplier> <team>"),
        parseSignature("setrule unitHealth <multiplier> <team>"),
        parseSignature("setrule unitBuildSpeed <multiplier> <team>"),
        parseSignature("setrule unitCost <multiplier> <team>"),
        parseSignature("setrule unitDamage <multiplier> <team>"),
        parseSignature("setrule blockHealth <multiplier> <team>"),
        parseSignature("setrule blockDamage <multiplier> <team>"),
        parseSignature("setrule rtsMinWeight <value> <team>"),
        parseSignature("setrule rtsMinSquad <value> <team>"),
      ],
    };
  },
});

const flushMessageTypes = ["notify", "announce", "toast", "mission"];

defineInstruction("message", {
  parse(tokens) {
    const [, type, duration, outSuccess] = tokens;
    return { type, duration, outSuccess };
  },
  getOutputs(data) {
    return [data.outSuccess];
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      flushMessageTypes,
      diagnostics,
      "Unknown message type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, duration, outSuccess } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return flushMessageTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case duration:
      case outSuccess:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(flushMessageTypes, data.type),
      signatures: [
        parseSignature("message notify <duration> <outSuccess>"),
        parseSignature("message announce <duration> <outSuccess>"),
        parseSignature("message toast <duration> <outSuccess>"),
        parseSignature("message mission <duration> <outSuccess>"),
      ],
    };
  },
});

const cutsceneTypes = ["pan", "zoom", "stop"];

defineInstruction("cutscene", {
  parse(tokens) {
    const [, type, p1, p2, p3, p4] = tokens;
    return { type, p1, p2, p3, p4 };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      cutsceneTypes,
      diagnostics,
      "Unknown cutscene type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, p1, p2, p3, p4 } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return cutsceneTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case p1:
      case p2:
      case p3:
      case p4:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(cutsceneTypes, data.type),
      signatures: [
        parseSignature("cutscene pan <x> <y> <speed>"),
        parseSignature("cutscene zoom <level>"),
        parseSignature("cutscene stop"),
      ],
    };
  },
});

const effectTypes = [
  "warn",
  "cross",
  "blockFall",
  "placeBlock",
  "placeBlockSpark",
  "breakBlock",
  "spawn",
  "trail",
  "breakPop",
  "smokeCloud",
  "vapor",
  "hit",
  "hitSquare",
  "shootSmall",
  "shootBig",
  "smokeSmall",
  "smokeBig",
  "smokeColor",
  "smokeSquare",
  "smokeSquareBig",
  "spark",
  "sparkBig",
  "sparkShoot",
  "sparkShootBig",
  "drill",
  "drillBig",
  "lightBlock",
  "explosion",
  "smokePuff",
  "sparkExplosion",
  "crossExplosion",
  "wave",
  "bubble",
];

defineInstruction("effect", {
  parse(tokens) {
    const [, type, x, y, rotation, color, data] = tokens;
    return { type, x, y, rotation, color, data };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(type, effectTypes, diagnostics, "Unknown effect: ");

    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, x, y, rotation, color, data: effectData } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return effectTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case x:
      case y:
      case rotation:
      case color:
      case effectData:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(effectTypes, data.type),
      signatures: [
        parseSignature("effect warn <x> <y>"),
        parseSignature("effect cross <x> <y>"),
        parseSignature("effect blockFall <x> <y> <ignored> <ignored2> <block>"),
        parseSignature("effect placeBlock <x> <y> <size>"),
        parseSignature("effect placeBlock <x> <y> <size>"),
        parseSignature("effect placeBlockSpark <x> <y> <size>"),
        parseSignature("effect breakBlock <x> <y> <size>"),
        parseSignature("effect spawn <x> <y>"),
        parseSignature("effect trail <x> <y> <size> <color>"),
        parseSignature("effect breakPop <x> <y> <size> <color>"),
        parseSignature("effect smokeCloud <x> <y> <ignored> <color>"),
        parseSignature("effect vapor <x> <y> <ignored> <color>"),
        parseSignature("effect hit <x> <y> <ignored> <color>"),
        parseSignature("effect hitSquare <x> <y> <ignored> <color>"),
        parseSignature("effect shootSmall <x> <y> <rotation> <color>"),
        parseSignature("effect shootBig <x> <y> <rotation> <color>"),
        parseSignature("effect smokeSmall <x> <y> <rotation>"),
        parseSignature("effect smokeBig <x> <y> <rotation>"),
        parseSignature("effect smokeColor <x> <y> <rotation> <color>"),
        parseSignature("effect smokeSquare <x> <y> <rotation> <color>"),
        parseSignature("effect smokeSquareBig <x> <y> <rotation> <color>"),
        parseSignature("effect spark <x> <y> <ignored> <color>"),
        parseSignature("effect sparkBig <x> <y> <ignored> <color>"),
        parseSignature("effect sparkShoot <x> <y> <rotation> <color>"),
        parseSignature("effect sparkShootBig <x> <y> <rotation> <color>"),
        parseSignature("effect drill <x> <y> <ignored> <color>"),
        parseSignature("effect drillBig <x> <y> <ignored> <color>"),
        parseSignature("effect lightBlock <x> <y> <size> <color>"),
        parseSignature("effect explosion <x> <y> <size>"),
        parseSignature("effect smokePuff <x> <y> <ignored> <color>"),
        parseSignature("effect sparkExplosion <x> <y> <ignored> <color>"),
        parseSignature("effect crossExplosion <x> <y> <size> <color>"),
        parseSignature("effect wave <x> <y> <size> <color>"),
        parseSignature("effect bubble <x> <y>"),
      ],
    };
  },
});

defineInstruction("explosion", {
  parse(tokens) {
    const [, team, x, y, radius, damage, air, ground, pierce, effect] = tokens;
    return { team, x, y, radius, damage, air, ground, pierce, effect };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { team, x, y, radius, damage, air, ground, pierce, effect } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case team:
      case x:
      case y:
      case radius:
      case damage:
      case air:
      case ground:
      case pierce:
      case effect:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature(
          "explosion <team> <x> <y> <radius> <damage> <air> <ground> <pierce> <effect>"
        ),
      ],
    };
  },
});

defineInstruction("setrate", {
  parse(tokens) {
    const [, rate] = tokens;
    return { rate };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { rate } = data;
    const targetToken = getTargetToken(offset, tokens);

    if (targetToken === rate) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("setrate <ipt>")],
    };
  },
});

const fetchTypes = [
  "unit",
  "unitCount",
  "player",
  "playerCount",
  "core",
  "coreCount",
  "build",
  "buildCount",
];

defineInstruction("fetch", {
  parse(tokens) {
    const [, type, result, team, extra] = tokens;
    return { type, result, team, extra };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      fetchTypes,
      diagnostics,
      "Unknown fetch type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, result, team, extra } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return fetchTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case result:
      case team:
      case extra:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(fetchTypes, data.type),
      signatures: [
        parseSignature("fetch unit <result> <team> <index>"),
        parseSignature("fetch unitCount <result> <team> <type>"),
        parseSignature("fetch player <result> <team> <index>"),
        parseSignature("fetch playerCount <result> <team>"),
        parseSignature("fetch core <result> <team> <index>"),
        parseSignature("fetch coreCount <result> <team>"),
        parseSignature("fetch build <result> <team> <index>"),
        parseSignature("fetch buildCount <result> <team> <type>", {
          "<type>": {
            value:
              "The type of block to count, use `null` to count every building on the team",
            kind: MarkupKind.Markdown,
          },
        }),
      ],
    };
  },
});

defineInstruction("sync", {
  parse(tokens) {
    const [, variable] = tokens;
    return { variable };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { variable } = data;
    const targetToken = getTargetToken(offset, tokens);

    if (targetToken === variable) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("sync <variable>")],
    };
  },
});

defineInstruction("getflag", {
  parse(tokens) {
    const [, flag, result] = tokens;
    return { flag, result };
  },
  getOutputs(data) {
    return [data.result];
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { flag, result } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case flag:
      case result:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("getflag <flag> <result>")],
    };
  },
});

defineInstruction("setflag", {
  parse(tokens) {
    const [, flag, value] = tokens;
    return { flag, value };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { flag, value } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case flag:
      case value:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("setflag <flag> <value>")],
    };
  },
});

defineInstruction("setprop", {
  parse(tokens) {
    const [, prop, of, value] = tokens;
    return { prop, of, value };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { prop, of, value } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case prop:
      case of:
      case value:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("setprop <prop> <target> <value>")],
    };
  },
});

const markerControlTypes = [
  "remove",
  "world",
  "minimap",
  "autoscale",
  "pos",
  "endPos",
  "drawLayer",
  "color",
  "radius",
  "stroke",
  "rotation",
  "shape",
  "flushText",
  "fontSize",
  "textHeight",
  "labelFlags",
  "texture",
  "textureSize",
  "posi",
  "uvi",
  "colori",
];

defineInstruction("setmarker", {
  parse(tokens) {
    const [, type, id, p1, p2, p3] = tokens;
    return { type, id, p1, p2, p3 };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      markerControlTypes,
      diagnostics,
      "Unknown setmarker type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, id, p1, p2, p3 } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return markerControlTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case id:
      case p1:
      case p2:
      case p3:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      activeSignature: getActiveSignature(markerControlTypes, data.type),
      signatures: [
        parseSignature("setmarker remove <id>"),
        parseSignature("setmarker world <id> <bool>"),
        parseSignature("setmarker minimap <id> <bool>"),
        parseSignature("setmarker autoscale <id> <bool>"),
        parseSignature("setmarker pos <id> <x> <y>"),
        parseSignature("setmarker endPos <id> <x> <y>"),
        parseSignature("setmarker drawLayer <id> <number>"),
        parseSignature("setmarker color <id> <color>"),
        parseSignature("setmarker radius <id> <radius>"),
        parseSignature("setmarker stroke <id> <width>"),
        parseSignature("setmarker rotation <id> <angle>"),
        parseSignature("setmarker shape <id> <sides> <fill> <outline>"),
        parseSignature("setmarker flushText <id> <fetch>"),
        parseSignature("setmarker fontSize <id> <size>"),
        parseSignature("setmarker textHeight <id> <height>"),
        parseSignature("setmarker labelFlags <id> <background> <outline>"),
        parseSignature("setmarker texture <id> <name>"),
        parseSignature("setmarker textureSize <id> <width> <height>"),
        parseSignature("setmarker posi <id> <index> <x> <y>"),
        parseSignature("setmarker uvi <id> <index> <x> <y>"),
        parseSignature("setmarker colori <id> <index> <color>"),
      ],
    };
  },
});

const makeMakerTypes = [
  "shapeText",
  "point",
  "shape",
  "text",
  "line",
  "texture",
  "quad",
];

defineInstruction("makemarker", {
  parse(tokens) {
    const [, type, id, x, y, replace] = tokens;
    return { type, id, x, y, replace };
  },
  provideDiagnostics(data) {
    const { type } = data;
    const diagnostics: ParserDiagnostic[] = [];
    validateRestrictedToken(
      type,
      makeMakerTypes,
      diagnostics,
      "Unknown marker type: "
    );
    return diagnostics;
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { type, id, x, y, replace } = data;
    const targetToken = getTargetToken(offset, tokens);

    switch (targetToken) {
      case type:
        return makeMakerTypes.map((type) => ({
          label: type,
          kind: restrictedTokenCompletionKind,
        }));
      case id:
      case x:
      case y:
      case replace:
        return context.getVariableCompletions();
    }

    return [];
  },
  provideTokenSemantics(data, tokens) {
    setSemanticTokenType(tokens, 1, restrictedTokenSemanticType);
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [
        parseSignature("makemarker shapeText <id> <x> <y> <replace>"),
        parseSignature("makemarker point <id> <x> <y> <replace>"),
        parseSignature("makemarker shape <id> <x> <y> <replace>"),
        parseSignature("makemarker text <id> <x> <y> <replace>"),
        parseSignature("makemarker line <id> <x> <y> <replace>"),
        parseSignature("makemarker texture <id> <x> <y> <replace>"),
        parseSignature("makemarker quad <id> <x> <y> <replace>"),
      ],
    };
  },
});

defineInstruction("printlocale", {
  parse(tokens) {
    const [, value] = tokens;
    return { value };
  },
  provideCompletionItems({ data, offset, context, tokens }) {
    const { value } = data;
    const targetToken = getTargetToken(offset, tokens);

    if (targetToken === value) {
      return context.getVariableCompletions();
    }

    return [];
  },
  provideSignatureHelp({ data, offset, tokens }) {
    return {
      activeParameter: getActiveParameter(data, offset, tokens),
      signatures: [parseSignature("printlocale <entry>")],
    };
  },
});

export function validateRestrictedToken(
  token: TextToken | undefined,
  values: readonly string[],
  diagnostics: ParserDiagnostic[],
  message: string
) {
  if (!token) return;
  if (values.indexOf(token.content) !== -1) return;

  diagnostics.push({
    start: token.start,
    end: token.end,
    message: message + token.content,
    severity: DiagnosticSeverity.Warning,
    code: DiagnosticCode.unknownVariant,
  });
}

export function validateIgnoredToken(
  token: TextToken | undefined,
  diagnostics: ParserDiagnostic[]
) {
  if (!token) return;
  if (token.content === "_") return;

  diagnostics.push({
    start: token.start,
    end: token.end,
    message:
      "This parameter is not used by the instruction. Consider replacing it with _",
    severity: DiagnosticSeverity.Information,
  });
}

export function getTargetToken(character: number, tokens: TextToken[]) {
  // return the first token that contains the offset
  // or the next token after it
  // this allows the completion handlers
  // to perform plain equality comparisons with their respective tokens
  return (
    tokens.find(
      (token) =>
        token.start.character <= character && character <= token.end.character
    ) ?? tokens.find((token) => token.start.character >= character)
  );
}

function setSemanticTokenType(
  tokens: TokenSemanticData[],
  index: number,
  type: number
) {
  const token = tokens[index];
  if (!token) return;
  token.type = type;
}

export function getActiveParameter(
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

export function getActiveSignature(variants: string[], token?: TextToken) {
  if (!token) return 0;
  return variants.indexOf(token.content);
}

export interface ParseSignatureDocs {
  signature?: string | MarkupContent;
  [key: string]: string | MarkupContent | undefined;
}

export function parseSignature(
  signature: string,
  docs?: ParseSignatureDocs
): SignatureInformation {
  return {
    label: signature,
    documentation: docs?.signature,
    parameters: signature
      .split(" ")
      .slice(1)
      .map<ParameterInformation>((part) => ({
        label: part,
        documentation: docs?.[part],
      })),
  };
}
