# mactrace

**strace for macOS** - trace system calls of any process using Instruments.

```
$ mactrace ls
 0.262    5.75 µs ls/52313          access(0x16b473548, 0) = 0
 0.262    2.25 µs ls/52313          open(0x16b473548, O_RDONLY, 0) = <fd:3>
 0.262    1.25 µs ls/52313          fstat64(<fd:3>, 0x16b472f08) = 0
 0.262     542 ns ls/52313          read(<fd:3>, 0x104e6c000, 4096) = 2293
 0.262     250 ns ls/52313          close(<fd:3>) = 0
 ...
```

## Install

```bash
bunx mactrace ls -la
```

Or install globally:

```bash
bun install -g mactrace
```

## Usage

```bash
# Basic usage - trace a command
mactrace ls -la

# Save output to file (no colors)
mactrace -o trace.log -- node app.js

# Use -- to separate mactrace flags from command flags
mactrace -- ./my-program --port 3000

# List available trace schemas (debugging)
mactrace --list-schemas -- ls
```

## Output Format

```
TIMESTAMP  DURATION  PROCESS/PID      SYSCALL(args...) = RESULT
```

- **Timestamps**: seconds since trace start
- **Duration**: time spent in syscall
- **File descriptors**: shown as `<fd:N>`
- **Flags**: decoded (e.g., `O_RDONLY|O_CLOEXEC`, `PROT_READ|PROT_WRITE`)
- **Errors**: shown in red with errno (e.g., `= -1 ENOENT no such file or directory`)

## Examples

### Trace a Node.js app

```bash
mactrace -- node server.js
```

### Trace with output to file

```bash
mactrace -o trace.log -- python script.py
```

### Find what files a program opens

```bash
mactrace ./myapp 2>&1 | grep open
```

### Debug a hanging process

```bash
mactrace -- ./hanging-program
# See which syscall it's stuck on
```

## How It Works

mactrace uses macOS Instruments under the hood:

1. Runs `xcrun xctrace record --template "System Trace"` to capture syscalls
2. Parses the `.trace` bundle's XML export
3. Formats output similar to Linux's strace/perf trace

This gives you syscall tracing without needing to disable SIP or use `dtrace` directly.

## Requirements

- macOS (uses Instruments/xctrace)
- [Bun](https://bun.sh) runtime
- Xcode Command Line Tools (`xcode-select --install`)

## Limitations

- **No file paths in arguments**: System Trace captures register values (pointers), not dereferenced strings. You'll see memory addresses instead of actual paths. For file paths, use `fs_usage` or `dtrace`.
- **macOS only**: Uses Instruments which is macOS-specific.
- **Requires Instruments**: Part of Xcode Command Line Tools.

## Comparison with Other Tools

| Tool | Pros | Cons |
|------|------|------|
| **mactrace** | Easy to use, no SIP disable, colored output, flag decoding | No file path strings |
| **dtruss** | Shows file paths | Requires SIP disabled, dated |
| **fs_usage** | Real-time, shows paths | Limited to file operations |
| **dtrace** | Most powerful | Complex, requires SIP disabled |
| **Instruments.app** | GUI, comprehensive | Heavy, not scriptable |

## License

MIT
