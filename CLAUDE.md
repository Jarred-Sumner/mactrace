# mactrace

strace for macOS - trace system calls using Instruments.

## Quick Start

```bash
bunx mactrace ls -la                   # Run directly via bunx
bun run index.ts -- /bin/ls -la        # Dev: trace a command
bun run index.ts -o trace.log -- cmd   # Dev: output to file (no colors)
```

## Architecture

```
index.ts          CLI entry point, arg parsing, output destination
lib/
  tracer.ts       Runs xctrace, streams stdout/stderr, filters noise
  exporter.ts     Parses XML from xctrace export, resolves id/ref system
  formatter.ts    Formats events: decodes args, styles output, dims punctuation
  syscalls.ts     Constants: O_FLAGS, PROT_FLAGS, MAP_FLAGS, FCNTL_CMDS, ERRNO_NAMES
```

## Trace Flow

1. `tracer.ts` spawns `xcrun xctrace record --template "System Trace" --launch -- <cmd>`
2. Streams stdout/stderr in real-time, filtering xctrace noise (patterns in `XCTRACE_PATTERNS`)
3. After process exits, xctrace saves `.trace` bundle to temp dir
4. `exporter.ts` runs `xctrace export --xpath '/trace-toc/run[@number="1"]/data/table[@schema="syscall"]'`
5. Parses XML, resolves id/ref references with `buildRefMap()` / `resolveValue()`
6. `formatter.ts` decodes args per syscall type, applies colors, dims punctuation
7. `index.ts` cleans up temp `.trace` file

## XML Reference System

The trace XML uses `id="N"` and `ref="N"` for deduplication:
```xml
<process id="5" fmt="cat">...</process>
<row><process ref="5"/>...</row>  <!-- references id=5 -->
```

Key functions in `exporter.ts`:
- `buildRefMap(obj)` - recursively builds Map<id, element>
- `resolveValue(obj, refMap)` - follows `@_ref` to get actual element
- `getFmt(obj, refMap)` - gets the `@_fmt` attribute (formatted display value)
- `getText(obj, refMap)` - gets text content or fmt

## Syscall Arg Decoding

`formatter.ts` has a `decoders` map with per-syscall formatters:

```typescript
const decoders: Record<string, ArgDecoder> = {
  openat: (args) => {
    const [dirfd, path, flags, mode] = args;
    const f = parseHex(flags || "0");
    const dir = dirfd === "0xfffffffffffffffe" ? "AT_FDCWD" : fd(dirfd);
    return `(${dir}, ${path}, ${formatOpenFlags(f)}, ${int(mode)})`;
  },
  // ...
};
```

Helpers:
- `fd(s)` - formats as `<fd:N>` if valid fd range
- `int(s)` - decimal for small values, hex for large
- `formatOpenFlags(n)` - decodes O_RDONLY|O_CREAT|... from `syscalls.ts`
- `formatProtFlags(n)` - PROT_READ|PROT_WRITE|...
- `formatMapFlags(n)` - MAP_SHARED|MAP_ANON|...
- `formatFcntlCmd(n)` - F_GETFL, F_SETFD, ...

## Return Value Formatting

`formatResult(syscall, result, hasError)` in `formatter.ts`:

- **Errors**: returns `-1` (not formatted as fd)
- **fd-returning syscalls** (`open`, `socket`, `dup`, etc.): `<fd:N>`
- **Address-returning** (`mmap`): keep hex
- **Byte counts** (`read`, `write`, `getdirentries64`): decimal
- **Small ints**: decimal
- **Large values**: hex (probably addresses)

Sets controlling this: `fdReturnSyscalls`, `addrReturnSyscalls`, `byteCountReturnSyscalls`

## Output Styling

Colors in `formatter.ts`:
- Timestamp: gray
- Duration: yellow
- Process/pid: cyan
- Syscall name: **bold** (or **bold red** if error)
- Punctuation `()` and `,`: dimmed
- Return value: dimmed (or red if error with errno)

Error detection: checks `event.errno` exists and isn't "success" / "Operation not supported" / etc.

## Adding New Syscall Decoders

1. Add decoder function to `decoders` map in `formatter.ts`
2. If syscall returns fd/address/bytes, add to appropriate Set
3. If new flags needed, add constants to `syscalls.ts` and format function

## Limitations

- **No file paths**: System Trace captures raw register values (pointer addresses), not dereferenced strings. For paths, use `fs_usage` or `dtrace`.
- **No mach thread create**: Only BSD layer syscalls (bsdthread_create), not Mach traps that create threads.
- **File Activity template**: xctrace hangs during save - don't use it.

## Bun Notes

- `Bun.spawn()` for process control with streaming
- `Bun.$\`cmd\`` for simple shell commands
- `Bun.file().writer()` for file output
- Run: `bun run index.ts` or `bun --hot index.ts` for dev
