import { Diagnostic, Position, Range } from "vscode-languageserver";
import { DiagnosticCode } from "../protocol";

export enum TextTokenType {
  comment,
  string,
  number,
  color,
  label,
  identifier,
}

export class ParserPosition implements Position {
  constructor(public line: number, public character: number) {}
}

export class TextToken {
  type: TextTokenType;
  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public content: string
  ) {
    this.type = getTextTokenType(content);
  }

  get isComment() {
    return this.type === TextTokenType.comment;
  }

  get isString() {
    return this.type === TextTokenType.string;
  }

  get isNumber() {
    return this.type === TextTokenType.number;
  }

  get isColorLiteral() {
    return this.type === TextTokenType.color;
  }

  get isLabel() {
    return this.type === TextTokenType.label;
  }

  get isIdentifier() {
    return this.type === TextTokenType.identifier;
  }
}

function getTextTokenType(content: string): TextTokenType {
  if (content.startsWith("#")) return TextTokenType.comment;
  if (content.startsWith('"')) return TextTokenType.string;
  if (content.startsWith("%")) return TextTokenType.color;
  if (!isNaN(Number(content))) return TextTokenType.number;

  return TextTokenType.identifier;
}

/**
 * A logical line of tokens. May only contain a comment token,
 * be a label declaration or just be a regular instruction..
 *
 * Token lines have at least one token.
 *
 * There may be multiple token lines in a single line of code due to the use of the `;` separator.
 */
export class TokenLine {
  constructor(
    public start: ParserPosition,
    public end: ParserPosition,
    public tokens: TextToken[]
  ) {}
}

export type Lines = TokenLine[];

export type ParserDiagnostic = Diagnostic;

const missingSpaceErrorMessage = "Expected space after string.";

// adapted from
// https://github.com/Anuken/Mindustry/blob/cb7f641ed60a9ef58b89d4c74da5efcb80d9b1f5/core/src/mindustry/logic/LParser.java
export function tokenize(chars: string) {
  const diagnostics: ParserDiagnostic[] = [];
  let tokens: TextToken[] = [];
  const lines: TokenLine[] = [];
  const opNameChanges: Record<string, string> = {
    atan2: "angle",
    dst: "len",
  };

  let pos = 0;
  let line = 0;
  let lineStart = 0;

  while (pos < chars.length) {
    switch (chars[pos]) {
      case "\n":
        line++;
        pos++;
        lineStart = pos;
        break;
      case ";":
      case " ":
      case "\r":
        pos++; //skip newlines and spaces
        break;
      default:
        statement();
    }
  }

  //load destination indices
  // for (var i of jumps) {
  //   const content = i.location?.content;
  //   if (!jumpLocations.has(i.location?.content)) {
  //     emitError(
  //       'Undefined jump location: "' +
  //         i.location +
  //         '". Make sure the jump label exists and is typed correctly.'
  //     );
  //   }
  //   i.jump.dest = jumpLocations.get(i.location?.content) ?? -1;
  // }

  function getCurrentLocation(): ParserPosition {
    return new ParserPosition(line, pos - lineStart);
  }

  function parseComment(): TextToken {
    const start = getCurrentLocation();
    const startPos = pos;
    //read until \n or eof
    while (pos < chars.length && chars[pos] != "\n" && chars[pos] != "\r") {
      pos++;
    }
    const end = getCurrentLocation();
    const endPos = pos;

    return new TextToken(start, end, chars.slice(startPos, endPos));
  }

  function parseString(): TextToken {
    const start = getCurrentLocation();
    const startPos = pos;

    while (++pos < chars.length) {
      const c = chars[pos];
      if (c == "\n" || c == "\r" || c == '"') {
        break;
      }
    }

    if (pos >= chars.length || chars[pos] != '"') {
      diagnostics.push({
        range: Range.create(start, getCurrentLocation()),
        message: 'Missing closing quote " before end of line.',
        code: DiagnosticCode.unclosedString,
      });
    }
    pos++;
    const end = getCurrentLocation();
    const endPos = pos;
    return new TextToken(start, end, chars.slice(startPos, endPos));
  }

  function parseToken(): TextToken {
    const start = getCurrentLocation();
    const startPos = pos;

    while (pos < chars.length) {
      const c = chars[pos];
      if (
        c == "\n" ||
        c == " " ||
        c == "#" ||
        c == "\t" ||
        c == ";" ||
        c == "\r"
      )
        break;
      pos++;
    }

    const end = getCurrentLocation();
    const endPos = pos;
    return new TextToken(start, end, chars.slice(startPos, endPos));
  }

  /** Apply changes after reading a list of tokens. */
  function checkRead() {
    // set the type of label declarations
    if (tokens[0].isIdentifier && tokens[0].content.endsWith(":")) {
      tokens[0].type = TextTokenType.label;
    }

    if (tokens.length > 1 && tokens[0].content === "op") {
      //legacy name change
      tokens[1].content = opNameChanges[tokens[1].content] ?? tokens[1].content;
    }
  }

  /** Reads the next statement until EOL/EOF. */
  function statement() {
    const start = getCurrentLocation();
    let expectNext = false;
    let missingSpace = false;

    tokens = [];

    while (pos < chars.length) {
      const c = chars[pos];

      //reached end of line, bail out.
      if (c == "\n" || c == ";" || c == "\r") break;

      if (expectNext && c != " " && c != "#" && c != "\t") {
        missingSpace = true;
      }

      expectNext = false;

      if (c == "#") {
        tokens.push(parseComment());
        break;
      } else if (c == '"') {
        const token = parseString();
        tokens.push(token);

        if (missingSpace) {
          diagnostics.push({
            range: token,
            message: missingSpaceErrorMessage,
            code: DiagnosticCode.missingSpace,
          });
          missingSpace = false;
        }

        // if the string is not closed, it means we reached the end of the line
        if (!token.content.endsWith('"')) break;

        expectNext = true;
      } else if (c != " " && c != "\t") {
        const token = parseToken();
        tokens.push(token);

        if (missingSpace) {
          diagnostics.push({
            range: token,
            message: missingSpaceErrorMessage,
            code: DiagnosticCode.missingSpace,
          });
          missingSpace = false;
        }

        expectNext = true;
      } else {
        pos++;
      }
    }

    const end = getCurrentLocation();

    //only process lines with at least 1 token
    if (tokens.length === 0) return;

    checkRead();

    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].content === "@configure") tokens[i].content = "@config";
      if (tokens[i].content === "configure") tokens[i].content = "config";
    }

    lines.push(new TokenLine(start, end, tokens));
  }

  return { lines, diagnostics };
}

export function parseColor(color: string) {
  if (color.length !== 6 && color.length !== 8)
    return { red: 0, green: 0, blue: 0, alpha: 1 };

  const red = parseInt(color.slice(0, 2), 16) / 255;
  const green = parseInt(color.slice(2, 4), 16) / 255;
  const blue = parseInt(color.slice(4, 6), 16) / 255;
  const alpha = color.length === 8 ? parseInt(color.slice(6, 8), 16) / 255 : 1;

  return { red, green, blue, alpha };
}