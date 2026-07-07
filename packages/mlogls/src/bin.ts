import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startServer } from "./server";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
yargs(hideBin(process.argv))
  .command(
    "$0",
    "Start the language server",
    (yargs) => {
      return yargs
        .option("stdio", {
          type: "boolean",
          desc: "Use stdio for communication",
        })
        .option("node-ipc", {
          type: "boolean",
          desc: "Use node-ipc for communication",
        })
        .option("socket", {
          type: "number",
          desc: "The socket port to use for socket communication",
        })
        .option("pipe", {
          type: "string",
          desc: "The name of the pipe (Windows) or socket file (Linux, Mac) to be used as the communication channel.",
        })
        .option("clientProcessId", {
          type: "number",
          desc: "The process id of the parent process",
        })
        .conflicts("stdio", ["node-ipc", "socket", "pipe"])
        .conflicts("node-ipc", ["stdio", "socket", "pipe"])
        .conflicts("socket", ["stdio", "node-ipc", "pipe"])
        .conflicts("pipe", ["stdio", "node-ipc", "socket"])
        .check((argv) => {
          if (argv.stdio || argv["node-ipc"] || argv.socket || argv.pipe) {
            return true;
          }
          throw new Error(
            "You must specify one of --stdio, --node-ipc, --socket, or --pipe"
          );
        });
    },
    (args) => {
      const connection = createConnection(ProposedFeatures.all);

      // TODO: the svelte language server does this
      // is it enough though?
      if (args.stdio) {
        // patch to prevent logs from going to stdout
        console.log = (...args: unknown[]) => console.warn(...args);
      }

      startServer({ connection });
    }
  )
  .help()
  .scriptName("mlogls")
  .parse();
