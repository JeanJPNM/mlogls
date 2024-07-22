import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startServer } from "mlogls";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

startServer({ connection });
