import {
  BrowserMessageReader,
  BrowserMessageWriter,
  ProposedFeatures,
  createConnection,
} from "vscode-languageserver/browser";
import { startServer } from "mlog-ls";

const reader = new BrowserMessageReader(self);
const writer = new BrowserMessageWriter(self);
const connection = createConnection(ProposedFeatures.all, reader, writer);

startServer({ connection });
