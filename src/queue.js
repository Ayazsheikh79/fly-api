/**
 * In-Memory Async Serial Queue for Firefly Image Generation
 * Enforces strictly 1 active generation at a time with a cooldown spacing between jobs.
 */
export class GenerationQueue {
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs ?? 5000;
    this.maxQueueSize = options.maxQueueSize ?? 25;
    this.queue = [];
    this.isProcessing = false;
    this.currentJob = null;
    this.lastCompletedAt = 0;
  }

  get stats() {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      currentJobId: this.currentJob ? this.currentJob.id : null,
      cooldownMs: this.cooldownMs,
      lastCompletedAt: this.lastCompletedAt ? new Date(this.lastCompletedAt).toISOString() : null
    };
  }

  /**
   * Enqueue a generation job
   * @param {Function} task - Async function that performs the generation
   * @param {Object} meta - Optional metadata (e.g. prompt, modelId)
   * @returns {Promise<any>}
   */
  enqueue(task, meta = {}) {
    if (this.queue.length >= this.maxQueueSize) {
      const err = new Error(`Queue is full (${this.maxQueueSize} jobs pending). Please try again shortly.`);
      err.status = 429;
      return Promise.reject(err);
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const position = this.queue.length + (this.isProcessing ? 1 : 0);

    return new Promise((resolve, reject) => {
      this.queue.push({
        id: jobId,
        meta,
        task,
        resolve,
        reject,
        enqueuedAt: Date.now()
      });

      this._processNext();
    });
  }

  async _processNext() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    const job = this.queue.shift();
    this.currentJob = job;

    // Check if we need to enforce cooldown since last generation
    const elapsedSinceLast = Date.now() - this.lastCompletedAt;
    if (this.lastCompletedAt > 0 && elapsedSinceLast < this.cooldownMs) {
      const waitTime = this.cooldownMs - elapsedSinceLast;
      console.log(`[Queue] Enforcing ${waitTime}ms cooldown before starting job ${job.id}...`);
      await new Promise(r => setTimeout(r, waitTime));
    }

    try {
      console.log(`[Queue] Processing job ${job.id} (Queue remaining: ${this.queue.length})`);
      const result = await job.task();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    } finally {
      this.lastCompletedAt = Date.now();
      this.currentJob = null;
      this.isProcessing = false;

      // Automatically trigger next job if pending
      if (this.queue.length > 0) {
        setImmediate(() => this._processNext());
      }
    }
  }
}

export const globalQueue = new GenerationQueue({ cooldownMs: 5000, maxQueueSize: 25 });
