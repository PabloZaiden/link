import { createHash } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { validateGraphPath } from "../storage/json";
import type { RealtimeHub } from "../realtime/hub";

export interface GraphMonitor {
  stop(): void;
  checkNow(): void;
}

const graphCollectionDirs = ["node-types", "edge-types", "nodes", "edges"] as const;

function isManagedGraphFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    fileName.endsWith(".json") &&
    !fileName.startsWith(".") &&
    !fileName.endsWith("~") &&
    !lowerName.endsWith(".tmp") &&
    !lowerName.endsWith(".swp") &&
    !lowerName.endsWith(".swo")
  );
}

function collectManagedGraphFiles(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const files: string[] = [];
  for (const dirName of graphCollectionDirs) {
    const dirPath = path.join(root, dirName);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue;
    for (const entry of readdirSync(dirPath).sort()) {
      if (!isManagedGraphFile(entry)) continue;
      const entryPath = path.join(dirPath, entry);
      if (statSync(entryPath).isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

export function fingerprintGraphPath(graphPath: string): string {
  const hash = createHash("sha256");
  for (const filePath of collectManagedGraphFiles(graphPath)) {
    const stat = statSync(filePath);
    const relativePath = path.relative(graphPath, filePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(stat.size));
    hash.update("\0");
    hash.update(String(stat.mtimeMs));
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
