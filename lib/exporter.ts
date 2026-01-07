import { XMLParser } from "fast-xml-parser";

export interface TraceEvent {
  timestamp: string;
  duration?: string;
  syscall: string;
  signature: string;
  pid?: number;
  tid?: number;
  process?: string;
  result?: string;
  errno?: string;
  args?: string[];  // Raw syscall arguments (formatted hex values)
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false, // Keep as strings to preserve formatting
  trimValues: true,
});

async function runXctraceExport(
  traceFile: string,
  args: string[]
): Promise<string> {
  const result = await Bun.$`xcrun xctrace export --input ${traceFile} ${args}`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    throw new Error(`xctrace export failed: ${stderr}`);
  }

  return result.stdout.toString();
}

// Build a map of id -> element for resolving references
function buildRefMap(obj: unknown, map: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (obj === null || typeof obj !== "object") return map;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      buildRefMap(item, map);
    }
  } else {
    const rec = obj as Record<string, unknown>;
    const id = rec["@_id"];
    if (id !== undefined) {
      map.set(String(id), rec);
    }
    for (const value of Object.values(rec)) {
      buildRefMap(value, map);
    }
  }

  return map;
}

// Get a value, resolving refs if needed
function resolveValue(obj: unknown, refMap: Map<string, unknown>): unknown {
  if (obj === null || typeof obj !== "object") return obj;

  const rec = obj as Record<string, unknown>;
  const ref = rec["@_ref"];
  if (ref !== undefined) {
    return refMap.get(String(ref)) ?? obj;
  }
  return obj;
}

// Extract the fmt attribute from an element
function getFmt(obj: unknown, refMap: Map<string, unknown>): string | undefined {
  const resolved = resolveValue(obj, refMap);
  if (resolved && typeof resolved === "object") {
    const rec = resolved as Record<string, unknown>;
    return rec["@_fmt"] as string | undefined;
  }
  return undefined;
}

// Extract text content from an element
function getText(obj: unknown, refMap: Map<string, unknown>): string | undefined {
  const resolved = resolveValue(obj, refMap);
  if (typeof resolved === "string") return resolved;
  if (resolved && typeof resolved === "object") {
    const rec = resolved as Record<string, unknown>;
    return (rec["#text"] as string) ?? (rec["@_fmt"] as string);
  }
  return undefined;
}

export async function exportTrace(traceFile: string): Promise<TraceEvent[]> {
  // Export syscall data
  const xpath = '/trace-toc/run[@number="1"]/data/table[@schema="syscall"]';

  let dataXml: string;
  try {
    dataXml = await runXctraceExport(traceFile, ["--xpath", xpath]);
  } catch (e) {
    // Try without the target-pid filter
    const tocXml = await runXctraceExport(traceFile, ["--toc"]);
    if (!tocXml.includes('schema="syscall"')) {
      console.error("No syscall data in trace. Available schemas:");
      const schemas = tocXml.match(/schema="([^"]+)"/g);
      if (schemas) {
        for (const s of schemas) {
          console.error(`  - ${s}`);
        }
      }
      return [];
    }
    throw e;
  }

  const data = parser.parse(dataXml);
  const events: TraceEvent[] = [];

  // Navigate to the rows
  const queryResult = data?.["trace-query-result"];
  if (!queryResult) return events;

  const node = queryResult?.node;
  if (!node) return events;

  // Build reference map
  const refMap = buildRefMap(node);

  // Get rows
  const rows = node?.row;
  if (!rows) return events;

  const rowList = Array.isArray(rows) ? rows : [rows];

  for (const row of rowList) {
    if (!row || typeof row !== "object") continue;

    // Extract formatted-label (the nicely formatted syscall signature)
    const formattedLabel = row["formatted-label"];
    const signature = getFmt(formattedLabel, refMap) ?? "";

    // Extract syscall name
    const syscallEl = row["syscall"];
    const syscall = getFmt(syscallEl, refMap) ?? getText(syscallEl, refMap) ?? "unknown";

    // Extract timestamp
    const startTime = row["start-time"];
    const timestamp = getFmt(startTime, refMap) ?? "";

    // Extract duration
    const durationEl = row["duration"];
    const duration = getFmt(durationEl, refMap);

    // Extract process info
    const processEl = resolveValue(row["process"], refMap) as Record<string, unknown> | undefined;
    const process = getFmt(processEl, refMap);

    const pidEl = processEl?.pid;
    const pidStr = getFmt(pidEl, refMap) ?? getText(pidEl, refMap);
    const pid = pidStr ? parseInt(pidStr, 10) : undefined;

    // Extract thread info
    const threadEl = resolveValue(row["thread"], refMap) as Record<string, unknown> | undefined;
    const tidEl = threadEl?.tid;
    const tidStr = getFmt(tidEl, refMap) ?? getText(tidEl, refMap);
    const tid = tidStr ? parseInt(tidStr.replace("0x", ""), 16) : undefined;

    // Extract return value (may be array with multiple elements)
    const returnEl = row["syscall-return"];
    let result: string | undefined;
    if (Array.isArray(returnEl)) {
      // First element usually has the actual return value
      for (const el of returnEl) {
        const val = getFmt(el, refMap);
        if (val) {
          result = val;
          break;
        }
      }
    } else {
      result = getFmt(returnEl, refMap);
    }

    // Extract errno if present
    const narrativeEl = row["narrative"];
    let errno: string | undefined;
    if (narrativeEl) {
      const resolved = resolveValue(narrativeEl, refMap) as Record<string, unknown> | undefined;
      const errnoEl = resolved?.errno;
      errno = getFmt(errnoEl, refMap) ?? getText(errnoEl, refMap);
    }

    // Extract raw syscall arguments
    const args: string[] = [];
    const argEls = row["syscall-arg"];
    if (argEls) {
      const argList = Array.isArray(argEls) ? argEls : [argEls];
      for (const argEl of argList) {
        const val = getFmt(argEl, refMap);
        if (val) args.push(val);
      }
    }

    events.push({
      timestamp,
      duration,
      syscall: syscall.replace(/^[BM]SC_/, ""), // Remove BSC_/MSC_ prefix
      signature: signature || syscall.replace(/^[BM]SC_/, ""),
      pid,
      tid,
      process,
      result,
      errno,
      args,
    });
  }

  return events;
}

export async function listSchemas(traceFile: string): Promise<string[]> {
  const tocXml = await runXctraceExport(traceFile, ["--toc"]);
  const schemas = tocXml.match(/schema="([^"]+)"/g) ?? [];
  return schemas.map(s => s.replace(/schema="|"/g, ""));
}
