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
          default: true,
        })
        .option("node-ipc", {
          type: "boolean",
          desc: "Use node-ipc for communication",
          default: false,
        })
        .option("socket", {
          type: "boolean",
          desc: "The socket port to use for socket communication",
          default: false,
        })
        .option("pipe", {
          type: "string",
          desc: "The name of the pipe (Windows) or socket file (Linux, Mac) to be used as the communication channel.",
        })
        .option("clientProcessId", {
          type: "number",
          desc: "The process id of the parent process",
        });
    },
    (args) => {
      // the language server package already
      // detects the communication method based on the
      // arguments passed to the process
      //
      // we are doing this check because we are setting
      // stdio as the default method
      const connection = args.stdio
        ? createConnection(ProposedFeatures.all, process.stdin, process.stdout)
        : createConnection(ProposedFeatures.all);

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
