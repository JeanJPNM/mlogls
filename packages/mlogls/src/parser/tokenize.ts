import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";
import { DiagnosticCode } from "../protocol";
import {
  ColorLiteralToken,
  CommentToken,
  IdentifierToken,
  NumberToken,
  ParserPosition,
  StringToken,
  TextToken,
} from "./tokens";

/**
 * A logical line of tokens. May only contain a comment token, be a label
 * declaration or just be a regular instruction..
 *
 * Token lines have at least one token.
 *
 * There may be multiple token lines in a single line of code due to the use of
 * the `;` separator.
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
      case "\t":
      case "\r":
        pos++; //skip newlines and spaces
        break;
      default:
        statement();
    }
  }

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

    return new CommentToken(start, end, chars.slice(startPos, endPos));
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
    return new StringToken(start, end, chars.slice(startPos, endPos));
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
    const content = chars.slice(startPos, endPos);
    if (
      // mindustry will only treat this token as a named
      // color literal if it has more than three characters
      // but we won't apply that constraint since
      // it messes up autocomplete when writing a named color literal
      (content.startsWith("%[") && content.endsWith("]")) ||
      (content.startsWith("%") &&
        (content.length === 7 || content.length === 9))
    )
      return new ColorLiteralToken(start, end, content);
    const maybeNumber = parseNumber(content, start, diagnostics);
    if (maybeNumber !== undefined) return new NumberToken(start, end, content);
    return new IdentifierToken(start, end, content);
  }

  /** Apply changes after reading a list of tokens. */
  function checkRead() {
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

const binaryNumberRegex = /^[-+]?0b[01]+$/;
const hexNumberRegex = /^[-+]?0x[0-9a-fA-F]+$/;
const decimalNumberRegex = /^[+-]?(\.\d+|\d+(\.\d+)?|\d+[eE][+-]?\d+)[fF.]?$/;

function parseNumber(
  content: string,
  position: ParserPosition,
  diagnostics: ParserDiagnostic[]
): number | undefined {
  let sign = 1;
  let start = 0;
  if (content.startsWith("+")) {
    start++;
  } else if (content.startsWith("-")) {
    sign = -1;
    start++;
  }

  if (binaryNumberRegex.test(content)) {
    return sign * parseInt(content.slice(start + 2), 2);
  }

  if (hexNumberRegex.test(content)) {
    return sign * parseInt(content.slice(start + 2), 16);
  }

  if (decimalNumberRegex.test(content)) {
    let end = content.length;
    if (/[fF.]$/.test(content)) end--;

    validateDecimalNumber(content, start, end, position, diagnostics);

    return Number(content.slice(0, end));
  }
}

const maxLongValue = 1n << 63n;
const maxLongValueLength = maxLongValue.toString().length;

function validateDecimalNumber(
  content: string,
  start: number,
  end: number,
  position: ParserPosition,
  diagnostics: ParserDiagnostic[]
): void {
  let dot = -1;
  let e = -1;

  for (let i = start; i < end; i++) {
    if (content[i] === ".") {
      dot = i;
    } else if (content[i] === "e" || content[i] === "E") {
      e = i;
    }
  }

  if (dot !== -1) {
    validateDecimalComponent(
      content,
      start,
      dot,
      position,
      diagnostics,
      "The integer part of the number"
    );

    validateDecimalComponent(
      content,
      dot + 1,
      end,
      position,
      diagnostics,
      "The fractional part of the number"
    );
  } else if (e !== -1) {
    validateDecimalComponent(
      content,
      start,
      e,
      position,
      diagnostics,
      "The significand of the number"
    );

    validateDecimalComponent(
      content,
      e + 1,
      end,
      position,
      diagnostics,
      "The exponent of the number"
    );
  } else {
    validateDecimalComponent(
      content,
      start,
      end,
      position,
      diagnostics,
      "The number"
    );
  }
}

/**
 * Checks if the decimal component of a number can be parsed by the game's mlog
 * parser, which uses its own implementation instead of relying on java's
 * built-in parsing. This is necessary to prevent the parser from accepting
 * numbers that would be rejected by the game, which would cause discrepancies
 * between the editor and the game.
 */
function isValidDecimalNumber(
  content: string,
  start: number,
  end: number,
  positive: boolean
): boolean {
  const length = end - start;

  // avoid creating bigints in cases where its clear
  // whether or not the number is in range just by looking at its length
  if (length < maxLongValueLength) return true;
  if (length > maxLongValueLength) return false;

  const decimalPart = content.slice(start, end);
  const value = BigInt(decimalPart);

  return positive ? value < maxLongValue : value <= maxLongValue;
}

function validateDecimalComponent(
  content: string,
  start: number,
  end: number,
  position: ParserPosition,
  diagnostics: ParserDiagnostic[],
  prefix: string
): void {
  if (start === end) return;
  let positive = true;
  let parseStart = start;
  if (content[start] === "+" || content[start] === "-") {
    parseStart++;
    positive = content[start] === "+";
  }

  if (!isValidDecimalNumber(content, parseStart, end, positive)) {
    const message = `${prefix} will not be parsed correctly by the game because it is out of range.`;

    diagnostics.push({
      range: Range.create(
        {
          line: position.line,
          character: position.character + start,
        },
        {
          line: position.line,
          character: position.character + end,
        }
      ),
      message,
      code: DiagnosticCode.outOfRangeValue,
      severity: DiagnosticSeverity.Error,
    });
  }
}
