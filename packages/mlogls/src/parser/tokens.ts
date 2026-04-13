import { Color, Position } from "vscode-languageserver";
import { colorData, isColorName } from "../constants";
import {
  DiagnosticCode,
  isDiagnosticCode,
  isIgnorableDiagnosticCode,
} from "../protocol";

export class ParserPosition implements Position {
  constructor(
    public line: number,
    public character: number
  ) {}
}

export abstract class TextToken {
  abstract start: ParserPosition;
  abstract end: ParserPosition;
  abstract content: string;

  isNumber(): this is NumberToken {
    return this instanceof NumberToken;
  }

  isString(): this is StringToken {
    return this instanceof StringToken;
  }

  // identifier and comment tokens don't
  // have any special properties
  // so typescript sees their type is equivalent to Token
  isIdentifier(): boolean {
    return this instanceof IdentifierToken;
  }

  isComment(): this is CommentToken {
    return this instanceof CommentToken;
  }

  isColorLiteral(): this is ColorLiteralToken {
    return this instanceof ColorLiteralToken;
  }
}

export class IdentifierToken extends TextToken {
  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    super();
  }
}

export class CommentToken extends TextToken {
  diagnosticDirective?: DiagnosticDirective;

  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    super();
    this.diagnosticDirective = DiagnosticDirective.tryParse(start, content);
  }
}

export enum DiagnosticDirectiveMode {
  enable,
  disable,
}

export enum DiagnosticDirectiveScope {
  currentLine,
  nextLine,
  scope,
}

const diagnosticDirectiveModeMap: Record<
  string,
  { mode: DiagnosticDirectiveMode; scope: DiagnosticDirectiveScope }
> = {
  "mlogls-disable-next-line": {
    mode: DiagnosticDirectiveMode.disable,
    scope: DiagnosticDirectiveScope.nextLine,
  },
  "mlogls-enable-next-line": {
    mode: DiagnosticDirectiveMode.enable,
    scope: DiagnosticDirectiveScope.nextLine,
  },
  "mlogls-disable-line": {
    mode: DiagnosticDirectiveMode.disable,
    scope: DiagnosticDirectiveScope.currentLine,
  },
  "mlogls-enable-line": {
    mode: DiagnosticDirectiveMode.enable,
    scope: DiagnosticDirectiveScope.currentLine,
  },
  "mlogls-disable": {
    mode: DiagnosticDirectiveMode.disable,
    scope: DiagnosticDirectiveScope.scope,
  },
  "mlogls-enable": {
    mode: DiagnosticDirectiveMode.enable,
    scope: DiagnosticDirectiveScope.scope,
  },
};

export const diagnosticDirectiveKinds = Object.keys(diagnosticDirectiveModeMap);

/** Diagnostic directive kinds that are valid on comment lines */
export const commentLineDiagnosticDirectiveKinds =
  diagnosticDirectiveKinds.filter((kind) => {
    const scope = diagnosticDirectiveModeMap[kind].scope;
    return (
      scope === DiagnosticDirectiveScope.nextLine ||
      scope === DiagnosticDirectiveScope.scope
    );
  });

/** Diagnostic directive kinds that are valid on trailing comments */
export const trailingCommentDiagnosticDirectiveKinds =
  diagnosticDirectiveKinds.filter((kind) => {
    const scope = diagnosticDirectiveModeMap[kind].scope;
    return scope === DiagnosticDirectiveScope.currentLine;
  });

export class DiagnosticDirective {
  constructor(
    public mode: DiagnosticDirectiveMode,
    public scope: DiagnosticDirectiveScope,
    public basePosition: ParserPosition,
    public prefixEnd: number,
    public itemsEnd: number,
    public items: DiagnosticDirectiveItem[]
  ) {}

  get isDisable() {
    return this.mode === DiagnosticDirectiveMode.disable;
  }

  static readonly prefixRegex = /^#\s*(mlogls-[a-zA-Z-]*)/;

  static tryParse(
    basePosition: ParserPosition,
    comment: string
  ): DiagnosticDirective | undefined {
    const match = comment.match(this.prefixRegex);
    if (match?.index === undefined) return;
    const prefix = match[0];
    const rulesStart = match.index + prefix.length;

    if (!(match[1] in diagnosticDirectiveModeMap)) return;
    const { mode, scope } = diagnosticDirectiveModeMap[match[1]];

    let start = -1;

    const itemsStart = rulesStart;
    let itemsEnd = comment.indexOf("--", itemsStart);
    if (itemsEnd === -1) itemsEnd = comment.length;

    const items: DiagnosticDirectiveItem[] = [];
    for (let i = itemsStart; i < itemsEnd; i++) {
      const c = comment[i];

      if (c === " " || c === "\t") {
        if (start !== -1) {
          const name = comment.slice(start, i);
          items.push(new DiagnosticDirectiveItem(basePosition, start, i, name));
          start = -1;
        }
        continue;
      }

      if (start === -1) start = i;
    }

    if (start !== -1) {
      items.push(
        new DiagnosticDirectiveItem(
          basePosition,
          start,
          itemsEnd,
          comment.slice(start, itemsEnd)
        )
      );
    }

    return new DiagnosticDirective(
      mode,
      scope,
      basePosition,
      rulesStart,
      itemsEnd,
      items
    );
  }
}
export class DiagnosticDirectiveItem {
  /**
   * The diagnostic code, present only if the item's code exists and if it can
   * be disabled.
   */
  code?: DiagnosticCode;
  /**
   * Whether the code is a valid diagnostic code. Regardless of whether it can
   * be disabled.
   */
  codeExists: boolean;

  constructor(
    /**
     * The start position of the comment containing this diagnostic directive
     * item.
     */
    public basePosition: ParserPosition,
    /** The start position of the rule name relative to the token's content. */
    public start: number,
    /** The end position of the rule name relative to the token's content. */
    public end: number,
    content: string
  ) {
    this.code = isIgnorableDiagnosticCode(content) ? content : undefined;
    this.codeExists = isDiagnosticCode(content);
  }

  get startPosition(): ParserPosition {
    return new ParserPosition(
      this.basePosition.line,
      this.basePosition.character + this.start
    );
  }

  get endPosition(): ParserPosition {
    return new ParserPosition(
      this.basePosition.line,
      this.basePosition.character + this.end
    );
  }
}

export interface StringTokenTag {
  /** The start position of the tag name relative to the token's content. */
  nameStart: number;
  /** The end position of the tag name relative to the token's content. */
  nameEnd: number;
  /** Color data extracted from the tag in case it's valid. */
  color?: Color;
}

export class StringToken extends TextToken {
  colorTags: StringTokenTag[];

  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    super();
    this.colorTags = parseStringColorTags(content);
  }
}

export class NumberToken extends TextToken {
  value: number;

  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    super();
    this.value = Number(content);
  }
}

export class ColorLiteralToken extends TextToken {
  tag?: StringTokenTag;
  red: number;
  green: number;
  blue: number;
  alpha: number;

  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    super();
    const tagged = content[1] === "[";
    const color = parseColorLiteral(content, tagged);

    this.red = color?.red ?? 0;
    this.green = color?.green ?? 0;
    this.blue = color?.blue ?? 0;
    this.alpha = color?.alpha ?? 1;
    if (tagged) {
      this.tag = {
        nameStart: 2,
        nameEnd: content.length - 1,
        color,
      };
    }
  }
}

export function parseColor(color: string): Color {
  if (color.length !== 6 && color.length !== 8)
    return { red: 0, green: 0, blue: 0, alpha: 1 };

  const red = parseInt(color.slice(0, 2), 16) / 255;
  const green = parseInt(color.slice(2, 4), 16) / 255;
  const blue = parseInt(color.slice(4, 6), 16) / 255;
  const alpha = color.length === 8 ? parseInt(color.slice(6, 8), 16) / 255 : 1;

  return { red, green, blue, alpha };
}

function parseColorLiteral(content: string, named: boolean): Color | undefined {
  // check if tag uses hex code instead of color name
  if (!named) return parseColor(content.slice(1));

  const name = content.slice(2, -1);

  if (!isColorName(name)) return;
  return parseColor(colorData[name]);
}

function parseStringColorTags(str: string): StringTokenTag[] {
  const tags: StringTokenTag[] = [];

  // using -2 as the initial value to not break
  // the logic for checking escaped brackets
  const noTag = -2;
  let tagStart = noTag;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    switch (c) {
      // tags can't contain whitespace
      case " ":
      case "\t":
        tagStart = noTag;
        break;
      case "[":
        // escaped bracket: [[
        if (tagStart === i - 1) {
          tagStart = noTag;
        } else {
          tagStart = i;
        }
        break;
      case "]": {
        if (tagStart === noTag) break;

        let color: Color | undefined;

        // tag is color literal
        if (str[tagStart + 1] === "#") {
          color = parseColor(str.slice(tagStart + 2, i));
        } else {
          const name = str.slice(tagStart + 1, i);
          if (isColorName(name)) {
            color = parseColor(colorData[name]);
          }
        }

        tags.push({ nameStart: tagStart + 1, nameEnd: i, color });
        tagStart = noTag;
      }
    }
  }

  return tags;
}
