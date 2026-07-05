import {
  Color,
  ColorInformation,
  ColorPresentation,
  Range,
} from "vscode-languageserver";
import { MlogDocument } from "../document";
import { PackColorInstruction } from "../parser/nodes";
import { stringTemplatePattern } from "../constants";
import { containsPosition, getSelectedSyntaxNode } from "./common";

export function getDocumentColors(doc: MlogDocument): ColorInformation[] {
  const { nodes } = doc;
  const colors: ColorInformation[] = [];

  for (const node of nodes) {
    if (node instanceof PackColorInstruction) {
      if (!node.isConstant()) continue;
      const { data } = node;
      if (!data.red) continue;
      const { red, green, blue, alpha } = node.getColor();

      const last = data.alpha ?? data.blue ?? data.green ?? data.red;

      colors.push({
        color: { red, green, blue, alpha },
        range: Range.create(data.red.start, last.end),
      });
      continue;
    }

    for (const token of node.line.tokens) {
      if (token.isIdentifier()) {
        const symbol = doc.unit.symbolTable.get(token.content);
        if (!symbol?.color) continue;

        colors.push({
          range: Range.create(token.start, token.end),
          color: symbol.color,
        });
      } else if (token.isColorLiteral()) {
        colors.push({
          range: Range.create(token.start, token.end),
          color: {
            red: token.red,
            green: token.green,
            blue: token.blue,
            alpha: token.alpha,
          },
        });
      } else if (token.isString()) {
        for (const tag of token.colorTags) {
          if (!tag.color) continue;

          const tagContent = token.content.slice(tag.nameStart, tag.nameEnd);

          if (tagContent.match(stringTemplatePattern)) continue;

          const start = token.start.character + tag.nameStart;
          const end = token.start.character + tag.nameEnd;

          colors.push({
            range: Range.create(token.start.line, start, token.start.line, end),
            color: tag.color,
          });
        }
      }
    }
  }
  return colors;
}

export function getColorPresentations(
  doc: MlogDocument,
  range: Range,
  color: Color
): ColorPresentation[] {
  const node = getSelectedSyntaxNode(doc, range.start);
  if (node instanceof PackColorInstruction) {
    const { red, green, blue, alpha } = color;
    // three digits of precision is enough, since each "step" has a value of 0,255
    const r = (value: number) => Math.round(value * 10 ** 3) / 10 ** 3;
    return [
      {
        label: `${r(red)} ${r(green)} ${r(blue)} ${r(alpha)}`,
      },
    ];
  }

  const token = node?.line.tokens.find((token) =>
    containsPosition(token, range.start)
  );

  const red = Math.round(color.red * 255);
  const green = Math.round(color.green * 255);
  const blue = Math.round(color.blue * 255);
  const alpha = Math.round(color.alpha * 255);

  const c = (n: number) => n.toString(16).padStart(2, "0");
  const prefix = token?.isString() ? "#" : "%";
  const label =
    alpha === 255
      ? `${prefix}${c(red)}${c(green)}${c(blue)}`
      : `${prefix}${c(red)}${c(green)}${c(blue)}${c(alpha)}`;

  return [{ label }];
}
