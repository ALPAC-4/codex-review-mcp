import fs from "node:fs";
import path from "node:path";

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

/**
 * Recover claimed files from dead processes (skip if .done exists).
 */
function recoverOrphaned(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      const match = f.match(/^(.+)\.claimed\.(\d+)$/);
      if (!match) continue;
      const baseName = match[1];
      const pid = parseInt(match[2], 10);
      if (pid === MY_PID) continue;
      if (isPidAlive(pid)) continue;

      const claimedPath = path.join(dir, f);
      if (isDone(dir, baseName)) {
        try { fs.unlinkSync(claimedPath); } catch {}
        continue;
      }
      const jsonPath = path.join(dir, `${baseName}.json`);
      try { fs.renameSync(claimedPath, jsonPath); } catch {}
    }
  } catch {}
}

/**
 * Atomic increment with lock file.
 */
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
  fs.writeFileSync(
    path.join(requestsDir(channel), `${padIteration(iteration)}.json`),
    JSON.stringify(request, null, 2),
    "utf-8"
  );
  return iteration;
}

export function writeResponse(feedback: string, approved: boolean, iteration: number, channel: string): void {
  ensureDirs(channel);
  const response: ReviewResponse = { feedback, approved, iteration, reviewedAt: Date.now() };
  fs.writeFileSync(
    path.join(responsesDir(channel), `${padIteration(iteration)}.json`),
    JSON.stringify(response, null, 2),
    "utf-8"
  );
}

/**
 * Mark a request as consumed. Called by submit_review when the reviewer
 * submits feedback — this proves the reviewer received and used the request.
 */
export function markRequestConsumed(iteration: number, channel: string): void {
  const dir = requestsDir(channel);
  const baseName = padIteration(iteration);
  markDone(dir, baseName);
  // Clean up claimed file if it exists
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(baseName) && f.includes(".claimed.")) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

/**
 * Mark a response as consumed. Called explicitly after the implementer
 * has durably received the review feedback.
 */
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
 * Claim a request file: .json → .claimed.{pid}
 * Does NOT mark as consumed — that happens when submit_review is called.
 */
export function pollForRequest(
  channel: string,
  signal?: AbortSignal
): Promise<{ data: ReviewRequest; nack: () => void }> {
  const dir = requestsDir(channel);

  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      recoverOrphaned(dir);

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

          const data = JSON.parse(fs.readFileSync(claimedPath, "utf-8")) as ReviewRequest;
          resolve({
            data,
            nack: () => { try { fs.renameSync(claimedPath, jsonPath); } catch {} },
          });
          return;
        }
      } catch {}

      setTimeout(check, POLL_INTERVAL);
    };

    check();
  });
}

/**
 * Claim a response file: .json → .claimed.{pid}
 * Does NOT mark as consumed — caller must explicitly call markResponseConsumed.
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

  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      recoverOrphaned(dir);

      try {
        if (fs.existsSync(jsonPath)) {
          try {
            fs.renameSync(jsonPath, claimedPath);
          } catch {
            setTimeout(check, POLL_INTERVAL);
            return;
          }

          const data = JSON.parse(fs.readFileSync(claimedPath, "utf-8")) as ReviewResponse;
          resolve({
            data,
            nack: () => { try { fs.renameSync(claimedPath, jsonPath); } catch {} },
          });
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
