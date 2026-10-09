/** Small concurrency helpers: per-key ordering and a drainable set of running tasks. */

/** Runs tasks with the same key one after another; different keys run concurrently. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(task, task)
    const tail = result.then(
      () => {},
      () => {},
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }
}

/** Tracks detached work so plugin disposal can wait for it. */
export class TaskTracker {
  private readonly running = new Set<Promise<unknown>>()

  track(task: Promise<unknown>): void {
    const settled = task.then(
      () => {},
      () => {},
    )
    this.running.add(settled)
    void settled.then(() => this.running.delete(settled))
  }

  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running])
  }
}
