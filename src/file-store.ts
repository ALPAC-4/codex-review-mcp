import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const BASE_DIR = ".codex-review";
const POLL_INTERVAL = 1000;
const LOCK_TTL_MS = 5000;
const MY_PID = process.pid;

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

function channelDir(channel: string): string {
  return path.join(BASE_DIR, channel);
}

function requestsDir(channel: string): string {
  return path.join(channelDir(channel), "requests");
}

function responsesDir(channel: string): string {
  return path.join(channelDir(channel), "responses");
}

function iterationFile(channel: string): string {
  return path.join(channelDir(channel), "iteration");
}

function lockFilePath(channel: string): string {
  return path.join(channelDir(channel), "iteration.lock");
}

export function ensureDirs(channel: string): void {
  fs.mkdirSync(requestsDir(channel), { recursive: true });
  fs.mkdirSync(responsesDir(channel), { recursive: true });
}

function padIteration(n: number): string {
  return String(n).padStart(10, "0");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isDone(dir: string, baseName: string): boolean {
  return fs.existsSync(path.join(dir, `${baseName}.done`));
}

function markDone(dir: string, baseName: string): void {
  try { fs.writeFileSync(path.join(dir, `${baseName}.done`), "", "utf-8"); } catch {}
}

function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp.${randomUUID()}`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Recover orphaned claimed files:
 * - If .done exists for this iteration: delete the .claimed file (cleanup)
 * - If owning PID is dead: rename .claimed → .json (redelivery)
 * - If owning PID is alive but it's our own PID: rename .claimed → .json
 *   (our own stale claims from previous tool calls that were never acked)
 * - If owning PID is alive and it's another process: skip (they're working on it)
 */
function recoverOrphaned(dir: string, currentlyPolling?: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      const match = f.match(/^(.+)\.claimed\.(\d+)$/);
      if (!match) continue;
      const baseName = match[1];
      const pid = parseInt(match[2], 10);
      const claimedPath = path.join(dir, f);

      // Don't recover the file we're actively polling for right now
      if (currentlyPolling && claimedPath === currentlyPolling) continue;

      // If already done, just clean up
      if (isDone(dir, baseName)) {
        try { fs.unlinkSync(claimedPath); } catch {}
        continue;
      }

      // Another live process owns it — skip
      if (pid !== MY_PID && isPidAlive(pid)) continue;

      // Dead PID or our own stale claim — recover
      const jsonPath = path.join(dir, `${baseName}.json`);
      try { fs.renameSync(claimedPath, jsonPath); } catch {}
    }
  } catch {}
}

/**
 * Scan request/response dirs for the highest iteration number on disk.
 * Covers .json, .claimed.*, and .done files.
 */
function getMaxIterationOnDisk(channel: string): number {
  let max = 0;
  for (const dir of [requestsDir(channel), responsesDir(channel)]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        const match = f.match(/^(\d+)\./);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > max) max = n;
        }
      }
    } catch {}
  }
  return max;
}

function nextIteration(channel: string): number {
  const lock = lockFilePath(channel);
  const iterFile = iterationFile(channel);

  const deadline = Date.now() + LOCK_TTL_MS;
  while (true) {
    try {
      fs.writeFileSync(lock, `${MY_PID}:${Date.now()}`, { flag: "wx" });
      break;
    } catch {
      try {
        const content = fs.readFileSync(lock, "utf-8");
        const [pidStr, timeStr] = content.split(":");
        const lockPid = parseInt(pidStr, 10);
        const lockTime = parseInt(timeStr, 10);
        if (!isPidAlive(lockPid) || Date.now() - lockTime > LOCK_TTL_MS) {
          try { fs.unlinkSync(lock); } catch {}
          continue;
        }
      } catch {}
      if (Date.now() > deadline) {
        try { fs.unlinkSync(lock); } catch {}
        continue;
      }
      const start = Date.now();
      while (Date.now() - start < 10) { /* spin */ }
    }
  }

  try {
    let n = 0;
    try {
      n = parseInt(fs.readFileSync(iterFile, "utf-8").trim(), 10) || 0;
    } catch {}

    // Ensure monotonicity: scan for max existing iteration across requests/responses
    const maxOnDisk = getMaxIterationOnDisk(channel);
    if (maxOnDisk > n) {
      n = maxOnDisk;
    }

    n++;
    fs.writeFileSync(iterFile, String(n), "utf-8");
    return n;
  } finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

export function writeRequest(context: string, channel: string): number {
  ensureDirs(channel);
  const iteration = nextIteration(channel);
  const request: ReviewRequest = { context, iteration, requestedAt: Date.now() };
  const filePath = path.join(requestsDir(channel), `${padIteration(iteration)}.json`);
  atomicWriteFile(filePath, JSON.stringify(request, null, 2));
  console.error(`[write-request] Wrote iteration ${iteration} to ${path.resolve(filePath)}`);
  return iteration;
}

export function writeResponse(feedback: string, approved: boolean, iteration: number, channel: string): void {
  ensureDirs(channel);
  const response: ReviewResponse = { feedback, approved, iteration, reviewedAt: Date.now() };
  const filePath = path.join(responsesDir(channel), `${padIteration(iteration)}.json`);
  atomicWriteFile(filePath, JSON.stringify(response, null, 2));
  console.error(`[write-response] Wrote iteration ${iteration} to ${path.resolve(filePath)}`);
}

export function markRequestConsumed(iteration: number, channel: string): void {
  const dir = requestsDir(channel);
  const baseName = padIteration(iteration);
  markDone(dir, baseName);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(baseName) && f.includes(".claimed.")) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

export function markResponseConsumed(iteration: number, channel: string): void {
  const dir = responsesDir(channel);
  const baseName = padIteration(iteration);
  markDone(dir, baseName);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(baseName) && f.includes(".claimed.")) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

/**
 * Poll for a request file. Claims via .json → .claimed.{pid}.
 * Same-PID stale claims are recovered on each poll cycle.
 * The `currentlyPolling` path is excluded from recovery.
 */
export function pollForRequest(
  channel: string,
  signal?: AbortSignal
): Promise<{ data: ReviewRequest; nack: () => void }> {
  const dir = requestsDir(channel);
  let myClaimedPath: string | undefined;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal?.aborted) {
        // Unclaim if we had claimed something
        if (myClaimedPath) {
          const jsonPath = myClaimedPath.replace(`.claimed.${MY_PID}`, ".json");
          try { fs.renameSync(myClaimedPath, jsonPath); } catch {}
          myClaimedPath = undefined;
        }
        reject(new Error("aborted"));
        return;
      }

      recoverOrphaned(dir, myClaimedPath);

      try {
        const files = fs.readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .sort();

        for (const file of files) {
          const baseName = file.replace(".json", "");
          if (isDone(dir, baseName)) continue;

          const jsonPath = path.join(dir, file);
          const claimedPath = path.join(dir, `${baseName}.claimed.${MY_PID}`);

          try {
            fs.renameSync(jsonPath, claimedPath);
          } catch {
            continue;
          }

          myClaimedPath = claimedPath;

          if (signal?.aborted) {
            try { fs.renameSync(claimedPath, jsonPath); } catch {}
            myClaimedPath = undefined;
            reject(new Error("aborted"));
            return;
          }

          let data: ReviewRequest;
          try {
            data = JSON.parse(fs.readFileSync(claimedPath, "utf-8")) as ReviewRequest;
          } catch {
            try { fs.renameSync(claimedPath, jsonPath); } catch {}
            myClaimedPath = undefined;
            continue;
          }

          const nack = () => {
            try { fs.renameSync(claimedPath, jsonPath); } catch {}
            myClaimedPath = undefined;
          };

          signal?.addEventListener("abort", nack, { once: true });
          resolve({ data, nack });
          return;
        }
      } catch {}

      setTimeout(check, POLL_INTERVAL);
    };

    check();
  });
}

/**
 * Poll for a response file. Same claim semantics as pollForRequest.
 */
export function pollForResponse(
  iteration: number,
  channel: string,
  signal?: AbortSignal
): Promise<{ data: ReviewResponse; nack: () => void }> {
  const dir = responsesDir(channel);
  const fileName = padIteration(iteration);
  const jsonPath = path.join(dir, `${fileName}.json`);
  const claimedPath = path.join(dir, `${fileName}.claimed.${MY_PID}`);

  console.error(`[poll-response] Waiting for iteration ${iteration} at ${path.resolve(jsonPath)}`);

  let claimed = false;

  return new Promise((resolve, reject) => {
    let pollCount = 0;
    const check = () => {
      if (signal?.aborted) {
        if (claimed) {
          try { fs.renameSync(claimedPath, jsonPath); } catch {}
          claimed = false;
        }
        console.error(`[poll-response] Aborted for iteration ${iteration}`);
        reject(new Error("aborted"));
        return;
      }

      recoverOrphaned(dir, claimed ? claimedPath : undefined);

      try {
        if (pollCount % 10 === 0) {
          const files = fs.readdirSync(dir);
          console.error(`[poll-response] Poll #${pollCount}, dir contents: [${files.join(", ")}]`);
        }
        pollCount++;

        if (fs.existsSync(jsonPath)) {
          try {
            fs.renameSync(jsonPath, claimedPath);
          } catch {
            setTimeout(check, POLL_INTERVAL);
            return;
          }

          claimed = true;

          if (signal?.aborted) {
            try { fs.renameSync(claimedPath, jsonPath); } catch {}
            claimed = false;
            console.error(`[poll-response] Aborted after claim for iteration ${iteration}`);
            reject(new Error("aborted"));
            return;
          }

          let data: ReviewResponse;
          try {
            data = JSON.parse(fs.readFileSync(claimedPath, "utf-8")) as ReviewResponse;
          } catch {
            try { fs.renameSync(claimedPath, jsonPath); } catch {}
            claimed = false;
            setTimeout(check, POLL_INTERVAL);
            return;
          }

          const nack = () => {
            try { fs.renameSync(claimedPath, jsonPath); } catch {}
            claimed = false;
          };

          signal?.addEventListener("abort", nack, { once: true });

          resolve({ data, nack });
          return;
        }
      } catch {}

      setTimeout(check, POLL_INTERVAL);
    };

    check();
  });
}

export function getStatus(channel: string) {
  ensureDirs(channel);
  const requests = fs.readdirSync(requestsDir(channel)).filter((f) => f.endsWith(".json"));
  const responses = fs.readdirSync(responsesDir(channel)).filter((f) => f.endsWith(".json"));
  let iteration = 0;
  try {
    iteration = parseInt(fs.readFileSync(iterationFile(channel), "utf-8").trim(), 10) || 0;
  } catch {}
  return {
    channel,
    iteration,
    pendingRequests: requests.length,
    pendingResponses: responses.length,
  };
}
