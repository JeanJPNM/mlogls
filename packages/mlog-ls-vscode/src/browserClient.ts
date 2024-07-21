/// <reference lib="WebWorker" />

import { ExtensionContext, Uri } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
} from "vscode-languageclient/browser";

let client: LanguageClient;

export async function activate(context: ExtensionContext) {
  console.log("lsp-web-extension-sample activated!");

  const serverModule = Uri.joinPath(
    context.extensionUri,
    "dist/browserServer.js"
  );

  const url = serverModule.toString(true);
  const worker = new Worker(url, {
    name: "mlog-ls server",
  });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "mlog" },
      {
        scheme: "untitled",
        language: "mlog",
      },
    ],
  };

  client = new LanguageClient(
    "REPLACE_ME language-server-id",
    "REPLACE_ME language server name",
    clientOptions,
    worker
  );

  await client.start();
  console.log("lsp-web-extension-sample server is ready");
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
