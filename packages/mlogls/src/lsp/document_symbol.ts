import { DocumentSymbol, SymbolKind, Range } from "vscode-languageserver";
import { LogicalScope } from "../analysis/logical_scope";
import { labelDeclarationNameRange } from "../analysis/symbol_resolution";
import { MlogDocument } from "../document";
import { ParameterType, ParameterUsage } from "../parser/descriptors";
import { InstructionNode, LabelDeclaration, SyntaxNode } from "../parser/nodes";

export function getDocumentSymbols(doc: MlogDocument): DocumentSymbol[] {
  const { nodes } = doc;
  const root = doc.unit.rootScope;
  const symbols: DocumentSymbol[] = [];

  const end = root.children[0]?.start ?? root.end;
  for (let i = 0; i < end; i++) {
    const node = nodes[i];
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type === ParameterType.variable &&
        param.usage === ParameterUsage.write
      ) {
        symbols.push({
          name: param.token.content,
          kind: SymbolKind.Variable,
          range: param.token,
          selectionRange: param.token,
        });
      }
    }
  }

  for (const child of root.children) {
    symbols.push(getBlockSymbols(nodes, child));
  }

  return symbols;
}

function getBlockSymbols(
  nodes: SyntaxNode[],
  block: LogicalScope
): DocumentSymbol {
  const label = nodes[block.start] as LabelDeclaration;
  const lastNode = nodes[block.end - 1];
  const end = block.children[0]?.start ?? block.end;
  const symbols: DocumentSymbol[] = [];
  for (let i = block.start; i < end; i++) {
    const node = nodes[i];
    if (!(node instanceof InstructionNode)) continue;

    for (const param of node.parameters) {
      if (
        param.type === ParameterType.variable &&
        param.usage === ParameterUsage.write
      ) {
        symbols.push({
          name: param.token.content,
          kind: SymbolKind.Variable,
          range: param.token,
          selectionRange: param.token,
        });
      }
    }
  }

  for (const child of block.children) {
    symbols.push(getBlockSymbols(nodes, child));
  }

  return {
    name: label.name,
    kind: SymbolKind.Function,
    range: Range.create(label.start, lastNode.end),
    selectionRange: labelDeclarationNameRange(label.nameToken),
    children: symbols,
  };
}
