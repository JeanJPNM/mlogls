import { Position } from "vscode-languageserver";
import { TokenSemanticData } from "../analysis/types";
import { MlogDocument } from "../document";

export function getSemanticTokens(doc: MlogDocument): number[] {
  const data: number[] = [];

  if (doc.nodes.length === 0) return data;

  const tokens: TokenSemanticData[] = [];

  for (const node of doc.nodes) {
    node.provideTokenSemantics(doc.unit, tokens);
  }

  let previous = Position.create(0, 0);

  for (const { token, type, modifiers } of tokens) {
    const current = token.start;

    const deltaLine = current.line - previous.line;
    const deltaStart =
      deltaLine === 0
        ? current.character - previous.character
        : current.character;
    const length = token.end.character - token.start.character;

    const tokenModifiers = modifiers ?? 0;

    data.push(deltaLine);
    data.push(deltaStart);
    data.push(length);
    data.push(type);
    data.push(tokenModifiers);

    previous = current;
  }

  return data;
}
