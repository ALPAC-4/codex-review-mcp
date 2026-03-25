export type Role = "claude" | "codex";

export interface ReviewRequest {
  context: string;
  iteration: number;
  requestedAt: number;
}

export interface ReviewResponse {
  feedback: string;
  approved: boolean;
  iteration: number;
  reviewedAt: number;
}

type Waiter<T> = {
  resolve: (value: T) => void;
  iteration: number;
  cancelled: boolean;
};

export type CancelFn = () => void;

export class MessageBroker {
  private iteration = 0;
  private claudeQueue: ReviewResponse[] = [];
  private codexQueue: ReviewRequest[] = [];
  private claudeWaiters: Waiter<ReviewResponse>[] = [];
  private codexWaiters: Waiter<ReviewRequest>[] = [];

  getIteration(): number {
    return this.iteration;
  }

  sendToCodex(request: Omit<ReviewRequest, "iteration">): number {
    this.iteration++;
    const message: ReviewRequest = { ...request, iteration: this.iteration };

    // Skip cancelled waiters
    while (this.codexWaiters.length > 0 && this.codexWaiters[0].cancelled) {
      this.codexWaiters.shift();
    }

    const waiter = this.codexWaiters.shift();
    if (waiter) {
      waiter.resolve(message);
    } else {
      this.codexQueue.push(message);
    }

    return this.iteration;
  }

  sendToClaude(response: Omit<ReviewResponse, "iteration">, forIteration: number): "delivered" | "queued" | "dropped" {
    const message: ReviewResponse = { ...response, iteration: forIteration };

    // Find a non-cancelled waiter matching this iteration
    const idx = this.claudeWaiters.findIndex((w) => !w.cancelled && w.iteration === forIteration);
    if (idx !== -1) {
      const waiter = this.claudeWaiters.splice(idx, 1)[0];
      waiter.resolve(message);
      return "delivered";
    }

    // Clean up cancelled waiters
    this.claudeWaiters = this.claudeWaiters.filter((w) => !w.cancelled);

    // Queue if it matches the current iteration, otherwise drop stale response
    if (forIteration === this.iteration) {
      this.claudeQueue.push(message);
      return "queued";
    }

    return "dropped";
  }

  waitForReviewResponse(forIteration: number): { promise: Promise<ReviewResponse>; cancel: CancelFn } {
    // Check queue for matching iteration
    const idx = this.claudeQueue.findIndex((r) => r.iteration === forIteration);
    if (idx !== -1) {
      return {
        promise: Promise.resolve(this.claudeQueue.splice(idx, 1)[0]),
        cancel: () => {},
      };
    }

    const waiter: Waiter<ReviewResponse> = {
      resolve: () => {},
      iteration: forIteration,
      cancelled: false,
    };

    const promise = new Promise<ReviewResponse>((resolve) => {
      waiter.resolve = resolve;
    });

    this.claudeWaiters.push(waiter);

    const cancel = () => {
      waiter.cancelled = true;
    };

    return { promise, cancel };
  }

  waitForReviewRequest(): { promise: Promise<ReviewRequest>; cancel: CancelFn } {
    const queued = this.codexQueue.shift();
    if (queued) {
      return {
        promise: Promise.resolve(queued),
        cancel: () => {},
      };
    }

    const waiter: Waiter<ReviewRequest> = {
      resolve: () => {},
      iteration: 0,
      cancelled: false,
    };

    const promise = new Promise<ReviewRequest>((resolve) => {
      waiter.resolve = resolve;
    });

    this.codexWaiters.push(waiter);

    const cancel = () => {
      waiter.cancelled = true;
    };

    return { promise, cancel };
  }

  getStatus(role: Role) {
    return {
      role,
      otherRole: role === "claude" ? "codex" : "claude",
      iteration: this.iteration,
      pendingForClaude: this.claudeQueue.length,
      pendingForCodex: this.codexQueue.length,
      claudeWaiting: this.claudeWaiters.some((w) => !w.cancelled),
      codexWaiting: this.codexWaiters.some((w) => !w.cancelled),
    };
  }
}
