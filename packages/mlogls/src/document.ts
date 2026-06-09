import { TextDocument } from "vscode-languageserver-textdocument";
import { type ParserDiagnostic, tokenize } from "./parser/tokenize";
import {
  Position,
  Range,
  TextDocumentContentChangeEvent,
} from "vscode-languageserver";
import { getSyntaxNodes } from "./parser/nodes";
import { AnalysisUnit } from "./analysis/analysis_unit";

export class MlogDocument implements TextDocument {
  #document: TextDocument;
  #diagnostics: ParserDiagnostic[] = [];
  #unit: AnalysisUnit;

  constructor(uri: string, languageId: string, version: number, text: string) {
    this.#document = TextDocument.create(uri, languageId, version, text);
    if (this.isMlog) {
      const { lines, diagnostics } = tokenize(text);
      const nodes = getSyntaxNodes(lines);

      this.#diagnostics = diagnostics;
      this.#unit = new AnalysisUnit(uri, nodes);
    } else {
      this.#unit = new AnalysisUnit(uri, []);
    }
  }

  get parserDiagnostics() {
    return this.#diagnostics;
  }

  get nodes() {
    return this.#unit.nodes;
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

  get unit() {
    return this.#unit;
  }

  getText(range?: Range): string {
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
      const { lines, diagnostics } = tokenize(this.getText());
      const nodes = getSyntaxNodes(lines);

      this.#diagnostics = diagnostics;
      this.#unit = new AnalysisUnit(this.uri, nodes);
    } else {
      this.#unit = new AnalysisUnit(this.uri, []);
    }
  }
}
