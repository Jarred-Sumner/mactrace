import type { TraceEvent } from "./exporter";
import { formatOpenFlags, formatProtFlags, formatMapFlags, formatFcntlCmd } from "./syscalls";

// ANSI color codes
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

export interface FormatOptions {
  color?: boolean;
}

function pad(s: string, len: number, left = true): string {
  if (s.length >= len) return s;
  const spaces = " ".repeat(len - s.length);
  return left ? spaces + s : s + spaces;
}

// Parse hex string to number
function parseHex(s: string): number {
  if (s.startsWith("0x")) {
    return parseInt(s, 16);
  }
  return parseInt(s, 10);
}

// Format a file descriptor argument
function fd(s: string | undefined): string {
  if (!s) return "?";
  const val = parseHex(s);
  if (val < 0 || val > 0xFFFF) return s; // Not a valid fd
  return `<fd:${val}>`;
}

// Format an integer argument
function int(s: string | undefined): string {
  if (!s) return "?";
  const val = parseHex(s);
  // Small values as decimal, large as hex
  if (val >= 0 && val <= 0xFFFF) return String(val);
  return s;
}

// Syscall argument decoders
type ArgDecoder = (args: string[], result?: string) => string;

const decoders: Record<string, ArgDecoder> = {
  // File operations
  open: (args) => {
    const [path, flags, mode] = args;
    const f = parseHex(flags || "0");
    return `(${path}, ${formatOpenFlags(f)}, ${int(mode)})`;
  },
  openat: (args) => {
    const [dirfd, path, flags, mode] = args;
    const f = parseHex(flags || "0");
    const dir = dirfd === "0xfffffffffffffffe" ? "AT_FDCWD" : fd(dirfd);
    return `(${dir}, ${path}, ${formatOpenFlags(f)}, ${int(mode)})`;
  },
  open_nocancel: (args) => decoders.open(args),
  openat_nocancel: (args) => decoders.openat(args),

  // Close
  sys_close: (args) => `(${fd(args[0])})`,
  close: (args) => `(${fd(args[0])})`,
  close_nocancel: (args) => `(${fd(args[0])})`,
  sys_close_nocancel: (args) => `(${fd(args[0])})`,

  // Read/Write
  read: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])})`,
  write: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])})`,
  read_nocancel: (args) => decoders.read(args),
  write_nocancel: (args) => decoders.write(args),
  pread: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])}, ${int(args[3])})`,
  pwrite: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])}, ${int(args[3])})`,

  // Memory
  mmap: (args) => {
    const [addr, len, prot, flags, fdArg, offset] = args;
    const p = parseHex(prot || "0");
    const f = parseHex(flags || "0");
    return `(${addr}, ${len}, ${formatProtFlags(p)}, ${formatMapFlags(f)}, ${fd(fdArg)}, ${offset})`;
  },
  mprotect: (args) => {
    const [addr, len, prot] = args;
    const p = parseHex(prot || "0");
    return `(${addr}, ${len}, ${formatProtFlags(p)})`;
  },
  munmap: (args) => `(${args[0]}, ${args[1]})`,
  madvise: (args) => `(${args[0]}, ${args[1]}, ${int(args[2])})`,

  // fcntl
  sys_fcntl: (args) => {
    const c = parseHex(args[1] || "0");
    return `(${fd(args[0])}, ${formatFcntlCmd(c)}, ${args[2] || "0"})`;
  },
  fcntl: (args) => decoders.sys_fcntl(args),
  fcntl_nocancel: (args) => decoders.sys_fcntl(args),

  // dup
  sys_dup: (args) => `(${fd(args[0])})`,
  dup: (args) => `(${fd(args[0])})`,
  dup2: (args) => `(${fd(args[0])}, ${fd(args[1])})`,

  // stat family
  stat64: (args) => `(${args[0]}, ${args[1]})`,
  fstat64: (args) => `(${fd(args[0])}, ${args[1]})`,
  lstat64: (args) => `(${args[0]}, ${args[1]})`,
  fstatat64: (args) => {
    const dir = args[0] === "0xfffffffffffffffe" ? "AT_FDCWD" : fd(args[0]);
    return `(${dir}, ${args[1]}, ${args[2]}, ${int(args[3])})`;
  },
  stat: (args) => `(${args[0]}, ${args[1]})`,
  fstat: (args) => `(${fd(args[0])}, ${args[1]})`,
  lstat: (args) => `(${args[0]}, ${args[1]})`,

  // Directory
  getdirentries64: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])}, ${args[3]})`,

  // ioctl
  ioctl: (args) => `(${fd(args[0])}, ${args[1]}, ${args[2] || "0"})`,

  // Socket
  socket: (args) => `(${int(args[0])}, ${int(args[1])}, ${int(args[2])})`,
  connect: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])})`,
  bind: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])})`,
  listen: (args) => `(${fd(args[0])}, ${int(args[1])})`,
  accept: (args) => `(${fd(args[0])}, ${args[1]}, ${args[2]})`,
  sendto: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])}, ${int(args[3])}, ${args[4]}, ${int(args[5])})`,
  recvfrom: (args) => `(${fd(args[0])}, ${args[1]}, ${int(args[2])}, ${int(args[3])}, ${args[4]}, ${args[5]})`,

  // Process
  execve: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,
  fork: () => "()",
  vfork: () => "()",
  exit: (args) => `(${args[0] || "0"})`,
  wait4: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  getpid: () => "()",
  getppid: () => "()",
  getuid: () => "()",
  geteuid: () => "()",
  getgid: () => "()",
  getegid: () => "()",

  // Thread
  bsdthread_create: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  bsdthread_terminate: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  thread_selfid: () => "()",

  // Signals
  sigaction: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,
  sigprocmask: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,
  __pthread_kill: (args) => `(${args[0]}, ${args[1]})`,

  // kqueue
  kqueue: () => "()",
  kevent: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,
  kevent64: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,
  kevent_qos: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,

  // Misc
  sysctl: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,
  sysctlbyname: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]})`,
  access: (args) => `(${args[0]}, ${args[1]})`,
  faccessat: (args) => {
    const [dirfd, path, mode, flags] = args;
    const dir = dirfd === "0xfffffffffffffffe" ? "AT_FDCWD" : dirfd;
    return `(${dir}, ${path}, ${mode}, ${flags || "0"})`;
  },
  getattrlist: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  fgetattrlist: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  setattrlist: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  getxattr: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,
  fgetxattr: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,
  listxattr: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  csops: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  csops_audittoken: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]})`,
  proc_info: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})`,
  shared_region_check_np: (args) => `(${args[0]})`,
  getfsstat64: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,
  statfs64: (args) => `(${args[0]}, ${args[1]})`,
  fstatfs64: (args) => `(${args[0]}, ${args[1]})`,
  getentropy: (args) => `(${args[0]}, ${args[1]})`,
  guarded_open_np: (args) => {
    const [path, guard, guardflags, flags] = args;
    const f = parseHex(flags || "0");
    return `(${path}, ${guard}, ${guardflags}, ${formatOpenFlags(f)})`;
  },

  // Mach traps
  mach_msg_trap: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  mach_msg: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  mach_vm_map_trap: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  mach_vm_allocate_trap: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  mach_vm_deallocate_trap: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,
  mach_port_deallocate_trap: (args) => `(${args[0]}, ${args[1]})`,
  task_self_trap: () => "()",
  host_self_trap: () => "()",
  thread_self_trap: () => "()",
  mach_reply_port: () => "()",
  semaphore_wait_trap: (args) => `(${args[0]})`,
  semaphore_signal_trap: (args) => `(${args[0]})`,
  semaphore_timedwait_trap: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,
  mk_timer_create: () => "()",
  mk_timer_arm: (args) => `(${args[0]}, ${args[1]})`,
  mk_timer_cancel: (args) => `(${args[0]}, ${args[1]})`,
  mk_timer_destroy: (args) => `(${args[0]})`,

  // psynch
  psynch_mutexwait: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  psynch_mutexdrop: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  psynch_cvwait: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  psynch_cvsignal: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  psynch_cvbroad: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,

  // ulock
  ulock_wait: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  ulock_wait2: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]})`,
  ulock_wake: (args) => `(${args[0]}, ${args[1]}, ${args[2]})`,

  // workq
  workq_kernreturn: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
  workq_open: () => "()",
  bsdthread_ctl: (args) => `(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`,
};

// Default decoder - just show raw args
function defaultDecoder(args: string[]): string {
  if (args.length === 0) return "()";
  return `(${args.join(", ")})`;
}

// Syscalls that return file descriptors
const fdReturnSyscalls = new Set([
  "open", "openat", "open_nocancel", "openat_nocancel",
  "socket", "accept", "accept_nocancel",
  "dup", "dup2", "sys_dup",
  "kqueue", "shm_open", "sem_open",
  "pipe", "socketpair",
  "guarded_open_np", "guarded_open_dprotected_np",
  "open_dprotected_np", "openbyid_np",
  "fileport_makefd",
]);

// Syscalls that return memory addresses
const addrReturnSyscalls = new Set([
  "mmap", "mremap_encrypted", "shmat",
]);

// Syscalls that return byte counts
const byteCountReturnSyscalls = new Set([
  "read", "write", "pread", "pwrite",
  "read_nocancel", "write_nocancel",
  "pread_nocancel", "pwrite_nocancel",
  "readv", "writev", "readv_nocancel", "writev_nocancel",
  "sendto", "recvfrom", "sendmsg", "recvmsg",
  "sendto_nocancel", "recvfrom_nocancel",
  "getdirentries64", "getxattr", "fgetxattr", "listxattr",
]);

// Format return value based on syscall type
function formatResult(syscall: string, result: string, hasError: boolean): string {
  const val = parseHex(result);

  // Error returns - just show the value, not as fd
  if (hasError) {
    // -1 is typically shown as 0x0 or 0xffffffff in traces
    if (val === 0 || val === -1 || val > 0xFFFFFFFF00000000) {
      return "-1";
    }
    return String(val);
  }

  // Error returns are typically -1 or very large (negative as unsigned)
  if (val < 0 || val > 0xFFFFFFFF00000000) {
    return result; // Keep as-is for errors
  }

  if (fdReturnSyscalls.has(syscall)) {
    return `<fd:${val}>`;
  }

  if (addrReturnSyscalls.has(syscall)) {
    return result; // Keep hex for addresses
  }

  if (byteCountReturnSyscalls.has(syscall)) {
    return String(val);
  }

  // For most syscalls, 0 = success, small numbers = int, large = probably address
  if (val === 0) {
    return "0";
  }

  // If it looks like an address (large number), keep hex
  if (val > 0xFFFF) {
    return result;
  }

  // Otherwise show as decimal
  return String(val);
}

export function formatEvent(
  event: TraceEvent,
  options: FormatOptions = {}
): string {
  const useColor = options.color ?? process.stderr.isTTY;

  const col = useColor ? c : {
    reset: "", bold: "", dim: "", red: "", green: "",
    yellow: "", blue: "", magenta: "", cyan: "", white: "", gray: "",
  };

  // Compact timestamp - just show seconds.milliseconds
  let ts = event.timestamp || "";
  const tsMatch = ts.match(/(\d+)\.(\d+)\.(\d+)$/);
  if (tsMatch) {
    ts = `${tsMatch[1]}.${tsMatch[2]}`;
  }

  // Format duration - normalize to consistent width
  let dur = "";
  if (event.duration) {
    dur = event.duration.replace(" ", "");
  }

  // Process info
  const procName = event.process?.split(" ")[0]?.slice(0, 10) || "?";
  const pid = event.pid || 0;
  const proc = `${procName}/${pid}`;

  // Decode args based on syscall type
  const decoder = decoders[event.syscall] || defaultDecoder;
  const args = event.args || [];
  let decodedArgs = decoder(args, event.result);

  // Dim the punctuation (parentheses and commas)
  decodedArgs = decodedArgs
    .replace(/^\(/, `${col.dim}(${col.reset}`)
    .replace(/\)$/, `${col.dim})${col.reset}`)
    .replace(/, /g, `${col.dim}, ${col.reset}`);

  // Check if this is an error
  const errno = event.errno;
  const isRealError = errno &&
    !errno.includes("success") &&
    !errno.includes("unknown error code") &&
    !errno.includes("reachable") &&
    !errno.includes("Operation not supported");

  // Result
  let result = "";
  if (event.result) {
    const formattedVal = formatResult(event.syscall, event.result, isRealError);

    if (isRealError) {
      result = `${col.red}= ${formattedVal} ${errno}${col.reset}`;
    } else {
      result = `${col.dim}= ${formattedVal}${col.reset}`;
    }
  }

  // Aligned format
  const tsCol = `${col.gray}${pad(ts, 6)}${col.reset}`;
  const durCol = `${col.yellow}${pad(dur, 9)}${col.reset}`;
  const procCol = `${col.cyan}${pad(proc, 16, false)}${col.reset}`;

  // Syscall name: bold red for errors, just bold otherwise
  const syscallCol = isRealError
    ? `${col.bold}${col.red}${event.syscall}${col.reset}`
    : `${col.bold}${event.syscall}${col.reset}`;
  const callCol = `${syscallCol}${decodedArgs}`;

  return `${tsCol} ${durCol} ${procCol} ${callCol} ${result}`.trimEnd();
}

export function formatEvents(
  events: TraceEvent[],
  options: FormatOptions = {}
): string[] {
  return events.map((event) => formatEvent(event, options));
}
