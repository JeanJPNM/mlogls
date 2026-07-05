import { FoldingRange } from "vscode-languageserver";
import { LogicalScope } from "../analysis/logical_scope";
import { MlogDocument } from "../document";
import { CommentLine } from "../parser/nodes";

export function getFoldingRanges(doc: MlogDocument): FoldingRange[] {
  const { nodes } = doc;

  const ranges: FoldingRange[] = [];

  const root = doc.unit.rootScope;

  function traverse(scope: LogicalScope) {
    ranges.push({
      startLine: nodes[scope.start].start.line,
      endLine: nodes[scope.end - 1].end.line,
    });

    for (const child of scope.children) {
      traverse(child);
    }
  }

  for (const child of root.children) {
    traverse(child);
  }

  // this handles #region/#endregion folding

  // the comment token includes the leading #
  // so we need to add it to the regex
  const regionPattern = /^#\s*#?region\b/;
  const endRegionPattern = /^#\s*#?endregion\b/;
  const regionStack: CommentLine[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!(node instanceof CommentLine)) continue;

    const token = node.line.tokens[0];

    if (regionPattern.test(token.content)) {
      regionStack.push(node);
      continue;
    }

    if (endRegionPattern.test(token.content)) {
      const start = regionStack.pop();
      if (start === undefined) continue;
      // syntax nodes only span a single line
      ranges.push({
        startLine: start.start.line,
        endLine: node.start.line,
      });
    }
  }

  return ranges;
}
