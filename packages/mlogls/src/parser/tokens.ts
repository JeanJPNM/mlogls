import { Color, Position } from "vscode-languageserver";
import { colorData } from "../constants";

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

  isComment(): boolean {
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
  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    super();
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
    const { red, green, blue, alpha } = parseColor(content.slice(1));

    this.red = red;
    this.green = green;
    this.blue = blue;
    this.alpha = alpha;
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
