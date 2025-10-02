import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
  ProposedFeatures,
} from "vscode-languageserver/browser";
import { startServer } from "mlogls";

const reader = new BrowserMessageReader(self);
const writer = new BrowserMessageWriter(self);
const connection = createConnection(ProposedFeatures.all, reader, writer);

startServer({ connection });
