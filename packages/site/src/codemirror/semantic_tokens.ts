import {
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateEffectType,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { highlightingFor } from "@codemirror/language";
import { Tag, tags } from "@lezer/highlight";
import * as LSP from "vscode-languageserver-protocol";
import { LSPClientExtension, LSPPlugin } from "@codemirror/lsp-client";

const throttleDuration = 500;

/**
 * Use this effect to rebuild the tokens when you change the theme of the
 * editor.
 */
export const rebuildTokenDecorations = StateEffect.define();

const setDecorations = StateEffect.define<DecorationSet>();

const decorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    const effect = firstEffectOf(transaction.effects, setDecorations);

    if (effect) return effect.value;
    return value.map(transaction.changes);
  },

  provide(field) {
    // TODO: is this ok?
    return Prec.highest(EditorView.decorations.from(field));
  },
});

class TokenView {
  constructor(
    public data: Int32Array,
    public baseIndex = 0
  ) {}

  get deltaLine() {
    return this.data[this.baseIndex];
  }

  get deltaStart() {
    return this.data[this.baseIndex + 1];
  }

  get length() {
    return this.data[this.baseIndex + 2];
  }

  get tokenType() {
    return this.data[this.baseIndex + 3];
  }

  get tokenModifiers() {
    return this.data[this.baseIndex + 4];
  }

  hasModifiers(modifiers: number): boolean {
    return (this.tokenModifiers & modifiers) === modifiers;
  }
}

class SemanticTokensPlugin implements PluginValue {
  tokenData = new Int32Array();

  private intialized = false;

  private cachedLegend: LSP.SemanticTokensLegend | null = null;

  tokenTypes = createRecord(LSP.SemanticTokenTypes);

  tokenModifiers = createRecord(LSP.SemanticTokenModifiers);

  constructor(public view: EditorView) {}

  get lspPlugin() {
    return LSPPlugin.get(this.view)!;
  }

  update({ transactions }: ViewUpdate): void {
    const plugin = this.lspPlugin;
    const client = plugin.client;

    if (!client.serverCapabilities?.semanticTokensProvider?.full) return;

    this.buildTokenRecords(
      client.serverCapabilities.semanticTokensProvider.legend
    );

    this.queueRequest();

    const rebuildEffect = firstEffectOfTransactions(
      transactions,
      rebuildTokenDecorations
    );

    if (rebuildEffect) {
      // we can't dispatch a transaction while
      // an update is already in progress
      queueMicrotask(() => {
        const decorations = semanticTokensToDecorations(
          this.lspPlugin,
          this.view.state,
          this.tokenData,
          this.tokenTypes,
          this.tokenModifiers
        );

        this.view.dispatch({
          effects: [setDecorations.of(decorations)],
        });
      });
    }
  }

  private buildTokenRecords(legend: LSP.SemanticTokensLegend) {
    if (this.cachedLegend === legend) return;
    this.cachedLegend = legend;
    console.log("building");
    const { tokenTypes, tokenModifiers } = legend;

    this.tokenTypes = createRecord(LSP.SemanticTokenTypes);
    this.tokenModifiers = createRecord(LSP.SemanticTokenModifiers);

    for (let i = 0; i < tokenTypes.length; i++) {
      const type = tokenTypes[i];
      if (!(type in this.tokenTypes)) continue;
      this.tokenTypes[type as LSP.SemanticTokenTypes] = i;
    }

    for (let i = 0; i < tokenModifiers.length; i++) {
      const type = tokenModifiers[i];
      if (!(type in this.tokenModifiers)) continue;
      this.tokenModifiers[type as LSP.SemanticTokenModifiers] = 1 << i;
    }
  }

  private async requestSemanticTokens() {
    const plugin = this.lspPlugin;
    const client = plugin.client;
    const semanticTokensProvider =
      client.serverCapabilities?.semanticTokensProvider;

    if (!semanticTokensProvider) return [];

    client.sync();
    const result = await client.request<
      LSP.SemanticTokensParams,
      LSP.SemanticTokens | null
    >("textDocument/semanticTokens/full", {
      textDocument: { uri: plugin.uri },
    });

    return result?.data ?? [];
  }

  private queueRequest() {
    const plugin = this.lspPlugin;
    if (this.intialized && plugin.unsyncedChanges.empty) return;

    void this.runQueue();
  }

  private async runQueue() {
    const plugin = this.lspPlugin;
    if (this.intialized && plugin.unsyncedChanges.empty) return;
    this.intialized = true;

    this.tokenData = new Int32Array(await this.requestSemanticTokens());
    const decorations = semanticTokensToDecorations(
      this.lspPlugin,
      this.view.state,
      this.tokenData,
      this.tokenTypes,
      this.tokenModifiers
    );

    this.view.dispatch({
      effects: [setDecorations.of(decorations)],
    });

    setTimeout(() => void this.runQueue(), throttleDuration);
  }
}

function createRecord<T extends Record<string, unknown>>(type: T) {
  return Object.fromEntries(
    Object.keys(type).map((key) => [key, -1])
  ) as Record<keyof T, number>;
}

export const semanticTokensPlugin = ViewPlugin.fromClass(SemanticTokensPlugin, {
  provide() {
    return [decorationsField];
  },
});

function semanticTokensToDecorations(
  plugin: LSPPlugin,
  state: EditorState,
  data: Int32Array,
  tokenTypes: Record<LSP.SemanticTokenTypes, number>,
  tokenModifiers: Record<LSP.SemanticTokenModifiers, number>
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let line = 0;
  let character = 0;

  const token = new TokenView(data);
  for (let i = 0; i + 4 < data.length; i += 5) {
    token.baseIndex = i;

    if (token.deltaLine) {
      line += token.deltaLine;
      character = 0;
    }
    character += token.deltaStart;

    // TODO: need to see if creating the array + tag
    // objects affects performance for larger text files
    const decorationTags: Tag[] = [];

    if (token.tokenType === tokenTypes.keyword) {
      decorationTags.push(tags.controlKeyword);
    } else if (
      token.hasModifiers(tokenModifiers.readonly) ||
      token.tokenType === tokenTypes.enumMember
    ) {
      decorationTags.push(tags.constant(tags.variableName));
    } else if (token.tokenType === tokenTypes.function) {
      decorationTags.push(tags.function(tags.name));
    } else if (token.tokenType === tokenTypes.macro) {
      decorationTags.push(tags.modifier);
    }
    const style = highlightingFor(state, decorationTags);
    if (!style) continue;

    const start = Math.min(
      plugin.fromPosition({ line, character }, state.doc),
      state.doc.length
    );
    const end = Math.min(start + token.length, state.doc.length);
    if (start === end) continue;

    builder.add(start, end, Decoration.mark({ class: style }));
  }

  return builder.finish();
}

export function semanticTokensExtension(): LSPClientExtension {
  return {
    clientCapabilities: {
      semanticTokens: {
        formats: ["relative"],
        augmentsSyntaxTokens: true,
        requests: {
          full: true,
          range: false,
        },
        tokenModifiers: Object.keys(LSP.SemanticTokenModifiers),
        tokenTypes: Object.keys(LSP.SemanticTokenTypes),
      },
    } satisfies LSP.TextDocumentClientCapabilities,
    editorExtension: semanticTokensPlugin,
  };
}

function firstEffectOf<T>(
  effects: readonly StateEffect<unknown>[],
  type: StateEffectType<T>
): StateEffect<T> | null {
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];
    if (effect.is(type)) return effect;
  }

  return null;
}

function firstEffectOfTransactions<T>(
  transactions: readonly Transaction[],
  type: StateEffectType<T>
): StateEffect<T> | null {
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];

    const effect = firstEffectOf(transaction.effects, type);
    if (effect) return effect;
  }
  return null;
}
