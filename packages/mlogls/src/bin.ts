import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
} from "vscode-languageserver/node";
import { startServer } from "./server";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";
import { MlogDocument } from "./document";
import { pathToFileURL } from "url";
import { getDocumentDiagnostics } from "./lsp/diagnostics";
import pc from "picocolors";

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
  .command(
    "check <file>",
    "Check a file for errors",
    (yargs) => {
      return yargs
        .positional("file", {
          type: "string",
          desc: "The file to check",
          demandOption: true,
        })
        .option("level", {
          type: "string",
          desc: "The level of diagnostics to report",
          default: "info",
          choices: ["hint", "info", "warning", "error"],
        });
    },
    (args) => {
      const { file } = args;

      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        console.error(pc.red(`Error: File does not exist at path: ${file}`));
        process.exit(1);
      }

      const uri = pathToFileURL(file).toString();
      const content = fs.readFileSync(file, "utf8");
      const doc = new MlogDocument(uri, "mlog", 0, content);

      const diagnostics = getDocumentDiagnostics(doc);

      // diagnostics are not perfectly sorted because some are only
      // added on later phases, such as diagnostics about
      // diagnostic suppression
      diagnostics.sort((a, b) => {
        const aStart = a.range.start;
        const bStart = b.range.start;
        if (aStart.line === bStart.line) {
          return aStart.character - bStart.character;
        }
        return aStart.line - bStart.line;
      });

      const filterLevel = stringToDiagnosticSeverity(args.level);
      let hasErrors = false;

      for (const diagnostic of diagnostics) {
        const severity = diagnostic.severity ?? DiagnosticSeverity.Error;

        if (severity > filterLevel) continue;
        if (severity === DiagnosticSeverity.Error) {
          hasErrors = true;
        }

        formatDiagnostic(doc, file, diagnostic);
      }

      process.exit(hasErrors ? 1 : 0);
    }
  )
  .version()
  .help()
  .scriptName("mlogls")
  .parse();

function stringToDiagnosticSeverity(level: string): DiagnosticSeverity {
  switch (level) {
    case "hint":
      return DiagnosticSeverity.Hint;
    case "info":
      return DiagnosticSeverity.Information;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "error":
      return DiagnosticSeverity.Error;
    default:
      return DiagnosticSeverity.Information;
  }
}

function formatDiagnostic(
  doc: MlogDocument,
  filepath: string,
  diagnostic: Diagnostic
): void {
  const location =
    pc.blue(filepath) +
    ":" +
    pc.yellow(diagnostic.range.start.line + 1) +
    ":" +
    pc.yellow(diagnostic.range.start.character + 1);

  let severity = pc.red("error");
  if (diagnostic.severity === DiagnosticSeverity.Warning) {
    severity = pc.yellow("warning");
  } else if (diagnostic.severity === DiagnosticSeverity.Information) {
    severity = pc.blue("info");
  } else if (diagnostic.severity === DiagnosticSeverity.Hint) {
    severity = pc.cyan("hint");
  }

  const code = pc.gray(diagnostic.code ? ` [${diagnostic.code}]` : "");
  const line = doc
    .getText({
      start: { line: diagnostic.range.start.line, character: 0 },
      end: { line: diagnostic.range.start.line + 1, character: 0 },
    })
    .trimEnd();
  const markerLength =
    diagnostic.range.start.line === diagnostic.range.end.line
      ? diagnostic.range.end.character - diagnostic.range.start.character
      : line.length - diagnostic.range.start.character;
  const marker = "^".repeat(Math.max(1, markerLength));
  // preserve tabs and replace everything else with spaces
  // to keep the marker aligned with the code
  const padding = line
    .substring(0, diagnostic.range.start.character)
    .replace(/[^\t]/g, " ");

  console.log(`${location} - ${severity}${code}: ${diagnostic.message}`);
  console.log(pc.gray(line));
  console.log(pc.gray(padding + marker + "\n"));
}
