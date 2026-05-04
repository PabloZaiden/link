import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { validateGraphPath } from "../storage/json";
import type { RealtimeHub } from "../realtime/hub";

export interface GraphMonitor {
  stop(): void;
  checkNow(): void;
}

function collectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (!stat.isDirectory()) return [root];

  const files: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const entryPath = path.join(root, entry);
    const entryStat = statSync(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entryStat.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export function fingerprintGraphPath(graphPath: string): string {
  const hash = createHash("sha256");
  for (const filePath of collectFiles(graphPath)) {
    const relativePath = path.relative(graphPath, filePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function startGraphMonitor(deps: {
  graphPath: string;
  realtime: RealtimeHub;
  intervalMs: number;
  onError?: (error: unknown) => void;
}): GraphMonitor | undefined {
  if (deps.intervalMs === 0) return undefined;

  let lastFingerprint = fingerprintGraphPath(deps.graphPath);

  const checkNow = (): void => {
    const nextFingerprint = fingerprintGraphPath(deps.graphPath);
    if (nextFingerprint === lastFingerprint) return;
    lastFingerprint = nextFingerprint;
    validateGraphPath(deps.graphPath);
    deps.realtime.broadcast({ type: "graph.changed", recordType: "graph", recordId: "graph", operation: "external-change" });
  };

  const timer = setInterval(() => {
    try {
      checkNow();
    } catch (error) {
      deps.onError?.(error);
      if (deps.onError === undefined) console.error(error);
    }
  }, deps.intervalMs);

  return {
    stop: () => clearInterval(timer),
    checkNow,
  };
}
