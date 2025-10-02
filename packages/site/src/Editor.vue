<script setup lang="ts">
import { basicSetup, EditorView } from "codemirror";
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import LanguageServerWorker from "./codemirror/worker?worker";
import { Store } from "./store";
import { debounce } from "./utils";
import { Compartment, EditorState, Text } from "@codemirror/state";
import { vscodeDarkInit, vscodeLightInit } from "@uiw/codemirror-theme-vscode";
import { useData } from "vitepress";
import { mlogLanguage } from "./codemirror/lang";
import { tags } from "@lezer/highlight";
import {
  findReferencesKeymap,
  formatKeymap,
  jumpToDefinitionKeymap,
  languageServerExtensions,
  LSPClient,
  renameKeymap,
  signatureKeymap,
  Transport,
} from "@codemirror/lsp-client";
import {
  rebuildTokenDecorations,
  semanticTokensExtension,
} from "./codemirror/semantic_tokens";
import { keymap } from "@codemirror/view";
import { insertTab } from "@codemirror/commands";

const { isDark } = useData();
const divRef = ref<HTMLElement>();
const store = new Store();

const view = shallowRef<EditorView>();
const theme = new Compartment();
const currentTheme = computed(() =>
  isDark.value
    ? vscodeDarkInit({
        styles: [
          {
            tag: [tags.constant(tags.variableName)],
            color: "#4FC1FF",
          },
          {
            tag: [tags.function(tags.name)],
            color: "#DCDCAA",
          },
        ],
      })
    : vscodeLightInit({
        styles: [
          {
            tag: [tags.variableName],
            color: "#001080",
          },
          {
            tag: [tags.constant(tags.variableName)],
            color: "#0070c1",
          },
          {
            tag: [tags.function(tags.name)],
            color: "#795E26",
          },
        ],
      })
);

const onChange = debounce((doc: Text) => {
  store.code = doc.toString();
}, 150);

watch(
  () => store.code,
  () => {
    history.replaceState({}, "", store.serialize());
  }
);

watch([view, isDark], ([view, isDark], [, prevIsDark]) => {
  if (!view) return;
  if (prevIsDark === isDark) return;

  view.dispatch({
    effects: [
      theme.reconfigure(currentTheme.value),
      rebuildTokenDecorations.of(null),
    ],
  });
});

onMounted(() => {
  const url = new URL(location.href);
  store.load(url.hash);

  const transport = workerTransport();
  const client = new LSPClient({
    extensions: [...languageServerExtensions(), semanticTokensExtension()],
  }).connect(transport);

  view.value = new EditorView({
    parent: divRef.value,
    doc: store.code,

    extensions: [
      EditorState.tabSize.of(2),
      basicSetup,
      theme.of(currentTheme.value),
      EditorView.theme({
        "&": { height: "var(--editor-height)" },
      }),
      mlogLanguage(),
      keymap.of(jumpToDefinitionKeymap),
      keymap.of(findReferencesKeymap),
      keymap.of(renameKeymap),
      keymap.of(formatKeymap),
      keymap.of(signatureKeymap),
      keymap.of([
        {
          key: "Tab",
          run: insertTab,
        },
      ]),
      client.plugin("file://script.mlog"),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        onChange(update.state.doc);
      }),
    ],
  });
});

onUnmounted(() => {
  view.value?.destroy();
});

function workerTransport(): Transport {
  let handlers: ((value: string) => void)[] = [];
  const worker = new LanguageServerWorker({ name: "mlogls" });

  worker.onmessage = (e) => {
    for (const handler of handlers) {
      handler(JSON.stringify(e.data));
    }
  };

  return {
    send(message: string) {
      worker.postMessage(JSON.parse(message));
    },
    subscribe(handler: (value: string) => void) {
      handlers.push(handler);
    },
    unsubscribe(handler: (value: string) => void) {
      handlers = handlers.filter((h) => h != handler);
    },
  };
}
</script>

<template>
  <div class="editor-wrapper">
    <div class="cm-wrapper" ref="divRef"></div>
  </div>
</template>

<style>
.editor-wrapper {
  --editor-height: calc(100vh - var(--vp-nav-height));
}
</style>
