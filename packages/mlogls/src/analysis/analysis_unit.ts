import { SyntaxNode } from "../parser/nodes";
import { SymbolTable } from "./symbol";
import { getLogicalScopes, LogicalScope } from "./logical_scope";
import { getSymbolTable } from "./symbol_resolution";

/**
 * Contains and lazily computes data structures commonly used throughout the
 * language server.
 */
export class AnalysisUnit {
  #root?: LogicalScope;
  #symbolTable?: SymbolTable;

  constructor(
    public uri: string,
    public nodes: SyntaxNode[]
  ) {}

  get rootScope() {
    return (this.#root ??= getLogicalScopes(this.nodes));
  }

  get symbolTable() {
    return (this.#symbolTable ??= getSymbolTable(this.nodes));
  }
}
