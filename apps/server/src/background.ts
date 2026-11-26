// Work that goes on after a request has been answered, such as reading an invoice. The
// server waits for it before it closes, so nothing writes to a closed database.
import type { FastifyBaseLogger } from "fastify";

export class BackgroundTasks {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly log: FastifyBaseLogger) {}

  /** Starts `work`. A failure is logged: there is no request left to answer. */
  run(name: string, work: () => Promise<void>): void {
    const task: Promise<void> = work()
      .catch((error: unknown) => this.log.error({ err: error, task: name }, "background task"))
      .finally(() => this.running.delete(task));
    this.running.add(task);
  }

  /** Settles once everything started has finished. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
  }
}
