import { CommentLine, LabelDeclaration, SyntaxNode } from "../parser/nodes";
import { LogicalScope } from "./logical_scope";

function isDocComment(node: SyntaxNode): node is CommentLine {
  return (
    node instanceof CommentLine && node.trailingComment.content.startsWith("##")
  );
}

export function getDocTextForLabel(
  nodes: SyntaxNode[],
  root: LogicalScope,
  labelName: string
): string {
  const commentEnd = nodes.findIndex(
    (node) => node instanceof LabelDeclaration && node.name === labelName
  );

  if (commentEnd === -1) return "";

  const headerStart = getLabelHeaderStart(nodes, root, commentEnd);

  let commentStart = commentEnd;

  while (commentStart > headerStart) {
    const node = nodes[commentStart - 1];
    if (!isDocComment(node)) break;
    commentStart--;
  }

  let docText = "";

  for (let i = commentStart; i < commentEnd; i++) {
    const node = nodes[i] as CommentLine;
    const content = node.trailingComment.content;

    const start = content.startsWith("## ") ? 3 : 2;
    docText += content.slice(start) + "\n";
  }

  return docText;
}

function getLabelHeaderStart(
  nodes: SyntaxNode[],
  root: LogicalScope,
  index: number
): number {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.start > index || child.end < index) continue;

    if (child.start !== index) return getLabelHeaderStart(nodes, child, index);

    if (i === 0) return index;
    const previous = root.children[i - 1];
    return previous.end;
  }

  return index;
}
