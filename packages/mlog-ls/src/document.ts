import { TextDocument } from "vscode-languageserver-textdocument";
import { type ParserDiagnostic, tokenize, TokenLine } from "./parser/tokenize";
import {
  Position,
  Range,
  TextDocumentContentChangeEvent,
} from "vscode-languageserver";
import { SyntaxNode, getSyntaxNodes } from "./parser/nodes";

export class MlogDocument implements TextDocument {
  #document: TextDocument;
  #lines: TokenLine[] = [];
  #diagnostics: ParserDiagnostic[] = [];
  #nodes: SyntaxNode[] = [];

  constructor(uri: string, languageId: string, version: number, text: string) {
    this.#document = TextDocument.create(uri, languageId, version, text);
    if (this.isMlog) {
      ({ lines: this.#lines, diagnostics: this.#diagnostics } = tokenize(text));
      this.#nodes = getSyntaxNodes(this.#lines);
    }
  }

  get lines() {
    return this.#lines;
  }

  get parserDiagnostics() {
    return this.#diagnostics;
  }

  get nodes() {
    return this.#nodes;
  }

  get uri() {
    return this.#document.uri;
  }

  get languageId() {
    return this.#document.languageId;
  }

  get version() {
    return this.#document.version;
  }

  get lineCount() {
    return this.#document.lineCount;
  }

  get isMlog() {
    return this.languageId === "mlog";
  }

  getText(range?: Range | undefined): string {
    return this.#document.getText(range);
  }
  positionAt(offset: number): Position {
    return this.#document.positionAt(offset);
  }
  offsetAt(position: Position): number {
    return this.#document.offsetAt(position);
  }

  update(changes: TextDocumentContentChangeEvent[], version: number) {
    TextDocument.update(this.#document, changes, version);
    if (this.isMlog) {
      ({ lines: this.#lines, diagnostics: this.#diagnostics } = tokenize(
        this.getText()
      ));
      this.#nodes = getSyntaxNodes(this.#lines);
    } else {
      this.#lines = [];
      this.#nodes = [];
    }
  }
}
