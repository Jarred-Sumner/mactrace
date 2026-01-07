import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import type { Subprocess } from "bun";

export interface TraceResult {
  traceFile: string;
  exitCode: number;
}

let activeProc: Subprocess | null = null;

// Patterns for xctrace status messages to filter out
const XCTRACE_PATTERNS = [
  /^Starting recording/,
  /^Ctrl-C to stop/,
  /^Target app exited/,
  /^Recording completed/,
  /^Recording stopped/,
  /^Recording failed/,
  /^Output file saved/,
  /^Saving output file/,
  /^Run issues were detected/,
  /^\* \[/,
];

function isXctraceMessage(line: string): boolean {
  return XCTRACE_PATTERNS.some((p) => p.test(line));
}

export async function runTrace(command: string[]): Promise<TraceResult> {
  const traceFile = join(tmpdir(), `mactrace-${randomUUID()}.trace`);

  // Resolve the command to an absolute path
  const resolvedCmd = Bun.which(command[0]);
  if (!resolvedCmd) {
    throw new Error(`Command not found: ${command[0]}`);
  }

  const xctraceArgs = [
    "xcrun",
    "xctrace",
    "record",
    "--no-prompt",
    "--template",
    "System Trace",
    "--output",
    traceFile,
    "--target-stdout",
    "-",
    "--launch",
    "--",
    resolvedCmd,
    ...command.slice(1),
  ];

  const proc = Bun.spawn(xctraceArgs, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  activeProc = proc;

  const signalHandler = () => {
    if (proc && !proc.killed) {
      proc.kill("SIGINT");
    }
  };

  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  // Stream and filter output
  async function filterStream(
    stream: ReadableStream<Uint8Array>,
    out: NodeJS.WriteStream
  ) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!isXctraceMessage(line)) {
          out.write(line + "\n");
        }
      }
    }

    // Remaining buffer
    if (buf && !isXctraceMessage(buf)) {
      out.write(buf + "\n");
    }
    reader.releaseLock();
  }

  try {
    // Start streaming filters
    const stdoutFilter = filterStream(proc.stdout, process.stdout);
    const stderrFilter = filterStream(proc.stderr, process.stderr);

    // Wait for everything
    const exitCode = await proc.exited;
    await Promise.all([stdoutFilter, stderrFilter]);

    return { traceFile, exitCode };
  } finally {
    activeProc = null;
    process.off("SIGINT", signalHandler);
    process.off("SIGTERM", signalHandler);
  }
}

export function getActiveProcess(): Subprocess | null {
  return activeProc;
}
