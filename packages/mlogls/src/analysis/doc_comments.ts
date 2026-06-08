import { CommentLine, LabelDeclaration, SyntaxNode } from "../parser/nodes";
import { LogicalScope } from "./logical_scope";

function isDocComment(node: SyntaxNode): node is CommentLine {
  return (
    node instanceof CommentLine && node.trailingComment.content.startsWith("##")
  );
}

function getDocCommentContent(node: CommentLine): string {
  const content = node.trailingComment.content;

  // strip the first whitespace character
  // from the comment's content
  // 0 and 1 are #
  const start = content[2] === " " || content[2] === "\t" ? 3 : 2;
  return content.slice(start);
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

  const headerStart = getMinimumLabelHeaderStart(nodes, root, commentEnd);

  const commentStart = getLabelDocCommentStart(nodes, headerStart, commentEnd);

  let docText = "";

  for (let i = commentStart; i < commentEnd; i++) {
    const node = nodes[i] as CommentLine;

    docText += getDocCommentContent(node) + "\n";
  }

  return docText.trim();
}

/** Returns the lowest node index that may be part of a label's doc comment */
function getMinimumLabelHeaderStart(
  nodes: SyntaxNode[],
  root: LogicalScope,
  index: number
): number {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.start > index || child.end < index) continue;

    if (child.start !== index)
      return getMinimumLabelHeaderStart(nodes, child, index);

    if (i === 0) return root.start;
    const previous = root.children[i - 1];
    return previous.end;
  }

  return index;
}

const varDocPrefix = /^##\s*@var\s+([^\s#;]+)/;

interface VarDocData {
  variableName: string;
  /**
   * The end position of the annotation (prefix + variable name) relative to the
   * token's content
   */
  annotationEnd: number;
}

function getVarDocAnnotation(node: CommentLine): VarDocData | undefined {
  const content = node.trailingComment.content;
  const match = content.match(varDocPrefix);
  if (!match) return;

  return {
    variableName: match[1],
    annotationEnd: match.index! + match[0].length,
  };
}

export function getDocTextForVariable(
  nodes: SyntaxNode[],
  variableName: string
) {
  // find first doc comment about the variable
  let start = -1;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!(node instanceof CommentLine)) continue;
    const data = getVarDocAnnotation(node);
    if (!data || data.variableName !== variableName) continue;
    start = i;
    break;
  }
  if (start === -1) return "";

  const commentEnd = getVarDocCommentEnd(nodes, start);
  let docText = "";

  for (let i = start; i < commentEnd; i++) {
    const node = nodes[i] as CommentLine;
    const data = getVarDocAnnotation(node);

    const content = node.trailingComment.content;
    docText += data
      ? content.slice(data.annotationEnd)
      : getDocCommentContent(node);
    docText += "\n";
  }

  return docText.trim();
}

/**
 * Iterates backwards through nodes to find the start of a label's documentation
 * comment. The documentation comment is expected to be immediately above the
 * label, with no empty lines in between.
 */
function getLabelDocCommentStart(
  nodes: SyntaxNode[],
  headerStart: number,
  labelIndex: number
) {
  let expectedLineNumber = nodes[labelIndex].start.line - 1;
  let commentStart = labelIndex;

  for (let i = labelIndex - 1; i >= headerStart; i--) {
    const node = nodes[i];

    if (node.start.line !== expectedLineNumber) break;
    if (!isDocComment(node)) break;

    expectedLineNumber--;
    commentStart = i;
  }

  return commentStart;
}

/** Returns the index of the last node that is part of a variable's doc comment */
function getVarDocCommentEnd(nodes: SyntaxNode[], start: number) {
  let expectedLineNumber = nodes[start].start.line;
  let commentEnd = start + 1;

  for (let i = start + 1; i < nodes.length; i++) {
    const node = nodes[i];

    if (node.start.line !== expectedLineNumber) break;
    if (!isDocComment(node)) break;
    expectedLineNumber++;

    const data = getVarDocAnnotation(node);
    if (data) break;

    commentEnd = i + 1;
  }

  return commentEnd;
}
