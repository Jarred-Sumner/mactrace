#!/usr/bin/env bun

import { runTrace } from "./lib/tracer";
import { exportTrace, listSchemas } from "./lib/exporter";
import { formatEvent } from "./lib/formatter";
import { rm } from "fs/promises";

const USAGE = `Usage: mactrace [options] [--] command [args...]

strace for macOS - trace system calls using Instruments.

Options:
  -o <file>        Write trace output to file (no colors)
  --no-color       Disable colored output
  --list-schemas   List available trace schemas (for debugging)
  -h, --help       Show this help message

Examples:
  mactrace ls -la
  mactrace -o trace.log -- node app.js
  mactrace -- ./my-program --flag value
`;

interface Options {
  command: string[];
  color: boolean;
  outputFile?: string;
  listSchemas: boolean;
  help: boolean;
}

function parseArgs(): Options {
  const args = Bun.argv.slice(2);

  const options: Options = {
    command: [],
    color: true,
    listSchemas: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      options.command = args.slice(i + 1);
      break;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      i++;
    } else if (arg === "-o") {
      if (i + 1 >= args.length) {
        process.stderr.write("Error: -o requires a filename\n");
        process.exit(1);
      }
      options.outputFile = args[i + 1];
      options.color = false; // No colors when writing to file
      i += 2;
    } else if (arg === "--no-color") {
      options.color = false;
      i++;
    } else if (arg === "--list-schemas") {
      options.listSchemas = true;
      i++;
    } else if (arg?.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\n`);
      process.exit(1);
    } else {
      options.command = args.slice(i);
      break;
    }
  }

  return options;
}

async function cleanupTraceFile(traceFile: string): Promise<void> {
  try {
    await rm(traceFile, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (options.command.length === 0) {
    process.stderr.write("Error: No command specified\n\n");
    process.stderr.write(USAGE);
    process.exit(1);
  }

  let traceFile: string | undefined;

  try {
    const result = await runTrace(options.command);
    traceFile = result.traceFile;

    if (options.listSchemas) {
      const schemas = await listSchemas(traceFile);
      process.stderr.write("Available schemas:\n");
      for (const schema of schemas) {
        process.stderr.write(`  - ${schema}\n`);
      }
      return;
    }

    const events = await exportTrace(traceFile);

    // Determine output destination
    let output: { write: (s: string) => void; close?: () => void };
    if (options.outputFile) {
      const file = Bun.file(options.outputFile);
      const writer = file.writer();
      output = {
        write: (s: string) => writer.write(s),
        close: () => writer.end(),
      };
    } else {
      output = { write: (s: string) => process.stderr.write(s) };
    }

    for (const event of events) {
      output.write(formatEvent(event, { color: options.color }) + "\n");
    }

    output.close?.();
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Error: ${error.message}\n`);
    } else {
      process.stderr.write("An unknown error occurred\n");
    }
    process.exit(1);
  } finally {
    if (traceFile) {
      await cleanupTraceFile(traceFile);
    }
  }
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`Fatal error: ${error.message}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  process.exit(1);
});

main();
