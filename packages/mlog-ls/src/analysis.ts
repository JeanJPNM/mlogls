import { TextToken } from "./parser/tokenize";

export class DeclarationContext {
  variables = new Set<string>();
  labels = new Set<string>();

  addVariable(token: TextToken | undefined) {
    if (token?.type !== "identifier") return;
    this.variables.add(token.content);
  }

  addLabel(name: string) {
    this.labels.add(name);
  }
}
