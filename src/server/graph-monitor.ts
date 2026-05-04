import { createHash } from "crypto";
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "fs";
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
  watchDebounceMs: number;
  onError?: (error: unknown) => void;
}): GraphMonitor | undefined {
  if (deps.watchDebounceMs === 0) return undefined;

  let lastFingerprint = fingerprintGraphPath(deps.graphPath);
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const watchers = new Map<string, FSWatcher>();

  const checkNow = (): void => {
    const nextFingerprint = fingerprintGraphPath(deps.graphPath);
    if (nextFingerprint === lastFingerprint) return;
    lastFingerprint = nextFingerprint;
    validateGraphPath(deps.graphPath);
    deps.realtime.broadcast({ type: "graph.changed", recordType: "graph", recordId: "graph", operation: "external-change" });
  };

  const reportError = (error: unknown): void => {
    deps.onError?.(error);
    if (deps.onError === undefined) console.error(error);
  };

  const runCheck = (): void => {
    try {
      checkNow();
    } catch (error) {
      reportError(error);
    }
  };

  const scheduleCheck = (): void => {
    if (stopped) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runCheck();
    }, deps.watchDebounceMs);
  };

  const watchTargets = (): string[] => [
    deps.graphPath,
    ...graphCollectionDirs.map(dirName => path.join(deps.graphPath, dirName)),
  ];

  const nearestExistingDirectory = (targetPath: string): string | undefined => {
    let currentPath = targetPath;
    while (true) {
      try {
        if (existsSync(currentPath) && statSync(currentPath).isDirectory()) return currentPath;
      } catch (error) {
        reportError(error);
        return undefined;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) return undefined;
      currentPath = parentPath;
    }
  };

  const refreshWatchers = (): void => {
    if (stopped) return;
    const nextWatchRoots = new Set(watchTargets().map(nearestExistingDirectory).filter((watchRoot): watchRoot is string => watchRoot !== undefined));

    for (const [watchRoot, watcher] of watchers) {
      if (nextWatchRoots.has(watchRoot)) continue;
      watcher.close();
      watchers.delete(watchRoot);
    }

    for (const watchRoot of nextWatchRoots) {
      if (watchers.has(watchRoot)) continue;
      try {
        const watcher = watch(watchRoot, { persistent: false }, () => {
          refreshWatchers();
          scheduleCheck();
        });
        watcher.on("error", reportError);
        watchers.set(watchRoot, watcher);
      } catch (error) {
        reportError(error);
      }
    }
  };

  refreshWatchers();

  return {
    stop: () => {
      stopped = true;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
    checkNow,
  };
}
