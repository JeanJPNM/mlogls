import { CompletionItem } from "vscode-languageserver";
import { TextToken } from "../parser/tokens";

export interface TokenSemanticData {
  token: TextToken;
  type: number;
  modifiers?: number;
}

export interface CompletionContext {
  getVariableCompletions(): CompletionItem[];
  getLabelCompletions(): CompletionItem[];
}
