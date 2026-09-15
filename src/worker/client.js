// Page side of the browser adapter: sends build requests to the worker and
// decides which answers are still worth showing.
//
// Every request carries a key (the serialized description) and a fresh id.
// At most one build runs; of the requests typed meanwhile only the latest waits,
// older ones are dropped. An answer is delivered only when its key is still the
// latest one, so a slow build can never overwrite a newer part. A crashed or
// silent worker is terminated and replaced on the next request. No DOM here: the
// worker comes from a factory, so tests drive a fake one.

export class BuildClient {
  /**
   * @param {object} options
   * @param {() => Worker} options.createWorker
   * @param {(answer: { key: string, reply: object }) => void} options.onResult  called for current keys only
   * @param {number} [options.timeoutMs]  a build taking longer is treated as a worker failure
   * @param {number} [options.supersedeAfterMs]  a newer request cancels a build running this long
   * @param {{ setTimeout: Function, clearTimeout: Function, now: () => number }} [options.clock]
   */
  constructor({ createWorker, onResult, timeoutMs = 20000, supersedeAfterMs = 1500, clock = defaultClock() }) {
    Object.assign(this, { createWorker, onResult, timeoutMs, supersedeAfterMs, clock });
    this.worker = null;
    this.inFlight = null; // { id, key, started, timer }
    this.pending = null; // { key, description }
    this.latestKey = null;
    this.nextId = 0;
    this.supersedeTimer = null;
  }

  /** True while the latest key is being built or waits for the worker. */
  get busy() {
    return this.pending !== null || (this.inFlight !== null && this.inFlight.key === this.latestKey);
  }

  /**
   * Ask for the part described by `key`. A null description means the current
   * parameters cannot be built: nothing is queued, and a running build becomes stale.
   */
  request(key, description) {
    this.latestKey = key;
    this.pending = null;
    this.clearSupersede();
    if (description === null || this.inFlight?.key === key) return;
    if (!this.inFlight) {
      this.send(key, description);
      return;
    }
    this.pending = { key, description };
    const left = this.inFlight.started + this.supersedeAfterMs - this.clock.now();
    this.supersedeTimer = this.clock.setTimeout(() => this.supersede(), Math.max(0, left));
  }

  send(key, description) {
    const id = ++this.nextId;
    try {
      this.worker ??= this.spawn();
    } catch (error) {
      // no worker at all (old browser, blocked module): report instead of hanging
      this.clock.setTimeout(() => this.deliver(key, { type: "crashed", id, message: String(error?.message ?? error) }), 0);
      return;
    }
    const timer = this.clock.setTimeout(() => this.fail(id, "timeout"), this.timeoutMs);
    this.inFlight = { id, key, started: this.clock.now(), timer };
    this.worker.postMessage({ type: "build", id, description });
  }

  spawn() {
    const worker = this.createWorker();
    worker.addEventListener("message", ({ data }) => this.receive(data));
    worker.addEventListener("error", (event) => {
      event.preventDefault?.();
      this.fail(this.inFlight?.id, event.message || "worker error");
    });
    worker.addEventListener("messageerror", () => this.fail(this.inFlight?.id, "messageerror"));
    return worker;
  }

  receive(reply) {
    if (!this.inFlight || reply?.id !== this.inFlight.id) return; // answer to a request already given up
    const done = this.finish();
    this.sendPending();
    this.deliver(done.key, reply);
  }

  /** The worker crashed, stayed silent too long or failed to load. */
  fail(id, message) {
    if (!this.inFlight || id !== this.inFlight.id) return;
    const done = this.finish();
    this.terminate();
    this.sendPending();
    this.deliver(done.key, { type: "crashed", id, message });
  }

  /** A newer request waited long enough: drop the running build instead of waiting for it. */
  supersede() {
    this.supersedeTimer = null;
    if (!this.inFlight || !this.pending) return;
    this.finish();
    this.terminate();
    this.sendPending();
  }

  finish() {
    const done = this.inFlight;
    this.clock.clearTimeout(done.timer);
    this.clearSupersede();
    this.inFlight = null;
    return done;
  }

  sendPending() {
    if (!this.pending) return;
    const { key, description } = this.pending;
    this.pending = null;
    this.send(key, description);
  }

  deliver(key, reply) {
    if (key === this.latestKey) this.onResult({ key, reply });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }

  clearSupersede() {
    if (this.supersedeTimer !== null) this.clock.clearTimeout(this.supersedeTimer);
    this.supersedeTimer = null;
  }
}

function defaultClock() {
  return {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
    now: () => globalThis.performance.now()
  };
}
