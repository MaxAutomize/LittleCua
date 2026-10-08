import { AsyncLocalStorage } from "node:async_hooks";

export type NativeFailureKind = "timeout" | "cancelled" | "unsupported" | "queue_full" | "failed";

export class NativeOperationError extends Error {
  readonly kind: NativeFailureKind;
  readonly phase: string;
  readonly deadlineUnixMilliseconds?: number;
  readonly dispatchState: "not-dispatched" | "possibly-dispatched";

  constructor(kind: NativeFailureKind, message: string, options: {
    phase: string;
    deadlineUnixMilliseconds?: number;
    dispatchState?: "not-dispatched" | "possibly-dispatched";
    cause?: unknown;
  }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "NativeOperationError";
    this.kind = kind;
    this.phase = options.phase;
    this.deadlineUnixMilliseconds = options.deadlineUnixMilliseconds;
    this.dispatchState = options.dispatchState ?? "not-dispatched";
  }
}

const nativeDeadlineScope = new AsyncLocalStorage<NativeDeadline>();

export class NativeDeadline {
  readonly startedUnixMilliseconds: number;
  readonly deadlineUnixMilliseconds: number;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Native workflow timeout must be a positive finite number.");
    this.startedUnixMilliseconds = Date.now();
    this.timeoutMs = Math.floor(timeoutMs);
    this.deadlineUnixMilliseconds = this.startedUnixMilliseconds + this.timeoutMs;
  }

  remaining(phase: string, capMs = Number.POSITIVE_INFINITY): number {
    const remaining = this.deadlineUnixMilliseconds - Date.now();
    if (remaining <= 0) {
      throw new NativeOperationError("timeout", `Native workflow deadline expired during ${phase}.`, {
        phase,
        deadlineUnixMilliseconds: this.deadlineUnixMilliseconds,
      });
    }
    return Math.max(1, Math.floor(Math.min(remaining, capMs)));
  }

  assert(phase: string, signal?: AbortSignal) {
    throwIfNativeAborted(signal, phase, this.deadlineUnixMilliseconds);
    this.remaining(phase);
  }
}

export function withNativeDeadline<T>(deadline: NativeDeadline, operation: () => Promise<T>) {
  return nativeDeadlineScope.run(deadline, operation);
}

export function scopedNativeDeadline() {
  return nativeDeadlineScope.getStore();
}

export function throwIfNativeAborted(signal: AbortSignal | undefined, phase: string, deadlineUnixMilliseconds?: number) {
  if (!signal?.aborted) return;
  throw new NativeOperationError("cancelled", `Native workflow cancelled during ${phase}.`, {
    phase,
    deadlineUnixMilliseconds,
    cause: signal.reason,
  });
}

export async function nativeDelay(ms: number, signal: AbortSignal | undefined, deadline: NativeDeadline, phase: string) {
  deadline.assert(phase, signal);
  const waitMs = Math.min(Math.max(0, ms), deadline.remaining(phase));
  if (waitMs < ms) {
    await nativeDelay(waitMs, signal, deadline, phase);
    deadline.remaining(phase);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error === undefined ? resolve() : reject(error);
    };
    const abort = () => finish(new NativeOperationError("cancelled", `Native workflow cancelled during ${phase}.`, {
      phase,
      deadlineUnixMilliseconds: deadline.deadlineUnixMilliseconds,
      cause: signal?.reason,
    }));
    const timer = setTimeout(() => finish(), waitMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

type PendingLease = {
  id: number;
  keys: string[];
  phase: string;
  deadline: NativeDeadline;
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  abort?: () => void;
  settled: boolean;
};

function uniqueSorted(keys: string[]) {
  return [...new Set(keys.filter(Boolean))].sort();
}

/**
 * Process-local native-operation coordination only. This deliberately does not
 * claim to coordinate other Pi processes, shell invocations, web_cli, or users.
 * Independent key sets can run concurrently; `native:*` is an explicit global
 * barrier for unscoped native programs/raw mutations.
 */
type VisualCaptureScope = { keys: Set<string>; releases: Array<() => void> };

export class NativeOperationCoordinator {
  private readonly active = new Set<string>();
  private readonly pending: PendingLease[] = [];
  private readonly held = new AsyncLocalStorage<Set<string>>();
  private readonly visualCaptureScope = new AsyncLocalStorage<VisualCaptureScope>();
  private nextId = 1;
  readonly maxPending: number;

  constructor(maxPending = Number(process.env.NATIVE_COORDINATOR_MAX_PENDING ?? 32)) {
    this.maxPending = Math.max(1, Math.min(256, Math.floor(maxPending)));
  }

  private conflicts(keys: string[]) {
    if (keys.includes("native:*") && this.active.size > 0) return true;
    if (this.active.has("native:*")) return true;
    return keys.some((key) => this.active.has(key));
  }

  private cleanup(item: PendingLease) {
    if (item.timer) clearTimeout(item.timer);
    if (item.abort) item.signal?.removeEventListener("abort", item.abort);
  }

  private reject(item: PendingLease, error: unknown) {
    if (item.settled) return;
    item.settled = true;
    this.cleanup(item);
    const index = this.pending.indexOf(item);
    if (index >= 0) this.pending.splice(index, 1);
    item.reject(error);
  }

  private drain() {
    for (let index = 0; index < this.pending.length;) {
      const item = this.pending[index];
      if (item.signal?.aborted) {
        this.reject(item, new NativeOperationError("cancelled", `Native workflow cancelled while waiting for ${item.phase}.`, {
          phase: item.phase,
          deadlineUnixMilliseconds: item.deadline.deadlineUnixMilliseconds,
          cause: item.signal.reason,
        }));
        continue;
      }
      if (Date.now() >= item.deadline.deadlineUnixMilliseconds) {
        this.reject(item, new NativeOperationError("timeout", `Native workflow deadline expired while waiting for ${item.phase}.`, {
          phase: item.phase,
          deadlineUnixMilliseconds: item.deadline.deadlineUnixMilliseconds,
        }));
        continue;
      }
      if (this.conflicts(item.keys)) {
        index++;
        continue;
      }
      this.pending.splice(index, 1);
      item.settled = true;
      this.cleanup(item);
      for (const key of item.keys) this.active.add(key);
      let released = false;
      item.resolve(() => {
        if (released) return;
        released = true;
        for (const key of item.keys) this.active.delete(key);
        this.drain();
      });
    }
  }

  private acquire(keys: string[], deadline: NativeDeadline, signal: AbortSignal | undefined, phase: string): Promise<() => void> {
    deadline.assert(phase, signal);
    if (this.pending.length >= this.maxPending) {
      throw new NativeOperationError("queue_full", `Native operation queue is full (${this.maxPending} pending); retry after current workflows finish.`, {
        phase,
        deadlineUnixMilliseconds: deadline.deadlineUnixMilliseconds,
      });
    }
    return new Promise((resolve, reject) => {
      const item: PendingLease = {
        id: this.nextId++, keys, phase, deadline, signal, resolve, reject, settled: false,
      };
      item.abort = () => this.reject(item, new NativeOperationError("cancelled", `Native workflow cancelled while waiting for ${phase}.`, {
        phase,
        deadlineUnixMilliseconds: deadline.deadlineUnixMilliseconds,
        cause: signal?.reason,
      }));
      signal?.addEventListener("abort", item.abort, { once: true });
      item.timer = setTimeout(() => this.reject(item, new NativeOperationError("timeout", `Native workflow deadline expired while waiting for ${phase}.`, {
        phase,
        deadlineUnixMilliseconds: deadline.deadlineUnixMilliseconds,
      })), deadline.remaining(phase));
      this.pending.push(item);
      this.drain();
    });
  }

  async runExclusive<T>(keys: string[], deadline: NativeDeadline, signal: AbortSignal | undefined, phase: string, operation: () => Promise<T>): Promise<T> {
    const requested = uniqueSorted(keys);
    const inherited = new Set([
      ...(this.held.getStore() ?? new Set<string>()),
      ...(this.visualCaptureScope.getStore()?.keys ?? new Set<string>()),
    ]);
    const missing = requested.filter((key) => !inherited.has(key) && !inherited.has("native:*"));
    if (!missing.length) {
      deadline.assert(phase, signal);
      return operation();
    }
    const release = await this.acquire(missing, deadline, signal, phase);
    const combined = new Set([...inherited, ...missing]);
    try {
      return await this.held.run(combined, operation);
    } finally {
      release();
    }
  }

  /** Hold an exact target through an opt-in screenshotAfter capture. The scope is
   * async-context-local, bounded by the existing workflow deadline, and released
   * even if the action batch or capture fails. */
  async withVisualCaptureScope<T>(operation: () => Promise<T>): Promise<T> {
    const scope: VisualCaptureScope = { keys: new Set(), releases: [] };
    return this.visualCaptureScope.run(scope, async () => {
      try {
        return await operation();
      } finally {
        for (const release of scope.releases.reverse()) release();
      }
    });
  }

  async holdForVisualCapture(keys: string[], deadline: NativeDeadline, signal: AbortSignal | undefined, phase: string) {
    const scope = this.visualCaptureScope.getStore();
    if (!scope) return;
    const requested = uniqueSorted(keys);
    const missing = requested.filter((key) => !scope.keys.has(key) && !scope.keys.has("native:*"));
    if (!missing.length) return;
    const release = await this.acquire(missing, deadline, signal, phase);
    for (const key of missing) scope.keys.add(key);
    scope.releases.push(release);
  }

  status() {
    return { activeKeys: [...this.active].sort(), pending: this.pending.length, maxPending: this.maxPending };
  }

  resetForTests() {
    if (this.active.size || this.pending.length) throw new Error("Cannot reset a busy native coordinator.");
    this.nextId = 1;
  }
}

export const nativeOperationCoordinator = new NativeOperationCoordinator();

export function targetOperationKeys(target: { pid: number; windowId: number }, pointer = false) {
  return [`native:target:${target.pid}:${target.windowId}`, ...(pointer ? [`native:pointer-pid:${target.pid}`] : [])];
}

export function classifyNativeFailure(error: unknown): NativeFailureKind {
  if (error instanceof NativeOperationError) return error.kind;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /\bcancel(?:led|ed|lation)?\b|\babort(?:ed)?\b/i.test(message)) return "cancelled";
  if (/\btimeout\b|timed out|deadline/i.test(message)) return "timeout";
  if (/-25206|AXErrorActionUnsupported|action (?:is )?not supported|unsupported (?:AX )?action/i.test(message)) return "unsupported";
  if (/queue is full/i.test(message)) return "queue_full";
  return "failed";
}
