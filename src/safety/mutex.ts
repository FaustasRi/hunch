/**
 * A minimal in-process async mutex: serializes critical sections in this single
 * long-lived server process. Used to close the place_order daily-cap TOCTOU — the
 * read-spend → cap-check → POST → audit-append sequence must run atomically so two
 * concurrent placements (e.g. parallel tool calls) cannot both pass a near-limit cap.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /** Run `fn` after all previously-queued work settles; returns fn's result. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // Advance the tail to fn's settlement, swallowing value/error so the chain never breaks.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
