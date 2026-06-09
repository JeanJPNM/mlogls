import { CommentLine, LabelDeclaration, SyntaxNode } from "../parser/nodes";
import { ParserPosition } from "../parser/tokens";

export interface LogicalScope {
  /**
   * The indentation of the label of this node. If this is the root node, this
   * value is -1.
   */
  labelIndentation: number;
  /**
   * The index of the label of this indentation node, unless `this` is the root
   * node.
   */
  start: number;
  end: number;
  level: number;
  children: LogicalScope[];
}

export function getLogicalScopes(nodes: SyntaxNode[]) {
  const root: LogicalScope = {
    labelIndentation: -1, // makes sure the root is always a parent
    start: 0,
    end: nodes.length,
    level: 0,
    children: [],
  };

  /**
   * Used to track the indentation of the current token line, handles cases
   * where the ; separator is used to put multiple instructions on the same text
   * line
   */
  let lineStart = new ParserPosition(-1, 0);

  let current = root;
  const parents: LogicalScope[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (lineStart.line !== node.start.line) {
      lineStart = node.start;
    }

    if (node instanceof CommentLine) {
      // only add the comment to the current block
      // if it's indentation is greater than the block's label
      if (
        node.start.character > current.labelIndentation &&
        // only add this comment if no previous comment
        // has been skipped
        current.end === i
      ) {
        current.end = i + 1;
      }
      continue;
    }

    if (node instanceof LabelDeclaration) {
      // if this label is less indented than the current block
      // we walk up the tree to find the most fitting parent
      //
      // no need to check if there are parents left
      // because the root has a labelIndentation of -1
      while (node.start.character < current.labelIndentation) {
        const parent = parents.pop()!;

        // expand the parent to include comments
        // that are outside the current block
        let j = current.end;
        while (j < i) {
          const n = nodes[j];
          if (!(n instanceof CommentLine)) break;
          if (n.start.character <= parent.labelIndentation) break;
          j++;
        }

        parent.end = j;
        current = parent;
      }

      // either child or sibling
      const isChild = node.start.character > current.labelIndentation;
      const block: LogicalScope = {
        labelIndentation: lineStart.character,
        start: i,
        end: i + 1,
        level: isChild ? current.level + 1 : current.level,
        children: [],
      };

      if (isChild) {
        current.children.push(block);
        parents.push(current);
      } else {
        parents[parents.length - 1].children.push(block);
      }

      current = block;
      continue;
    }

    // the node is an instruction, so
    // we add it to the current block
    current.end = i + 1;
  }

  // update the end of the blocks that haven't been popped
  while (current.level > 0) {
    const parent = parents.pop()!;

    // expand the parent to include comments
    // that are outside the current block
    let i = current.end;

    while (i < nodes.length) {
      const n = nodes[i];
      if (!(n instanceof CommentLine)) break;
      if (n.start.character <= parent.labelIndentation) break;
      i++;
    }

    parent.end = i;
    current = parent;
  }

  root.end = nodes.length;

  return root;
}

/**
 * Returns a set of label names that are accessible in the logical scope of the
 * node at the provided index.
 *
 * Only top-level labels and all labels part of the top-level block that
 * contains the index are returned.
 */
export function findLabelsInScope(
  nodes: SyntaxNode[],
  currentNodeIndex: number
) {
  const labels = new Set<string>();
  const root = getLogicalScopes(nodes);

  let parent: LogicalScope | undefined = root;
  while (parent) {
    const block: LogicalScope = parent;
    parent = undefined;

    for (const child of block.children) {
      const label = nodes[child.start] as LabelDeclaration;
      labels.add(label.name);

      if (child.start > currentNodeIndex || child.end < currentNodeIndex) {
        continue;
      }

      parent = child;
    }
  }

  return labels;
}
