import { describe, expect, test } from "bun:test";
import {
  buildReleaseAssetName,
  compareReleaseVersions,
  normalizeReleaseTag,
  normalizeReleaseVersion,
  resolveReleasePlatform,
  runUpdateCommand,
  type CliUpdateDependencies,
} from "./update";

type MockUpdateState = {
  outputs: string[];
  fetchedUrls: string[];
  writes: Array<{ path: string; content: string }>;
  chmods: Array<{ path: string; mode: number }>;
  renames: Array<{ from: string; to: string }>;
  removes: string[];
};

function releaseResponse(tagName: string, assetNames: string[]): Response {
  return Response.json({
    tag_name: tagName,
    assets: assetNames.map(name => ({
      name,
      browser_download_url: `https://downloads.example/${name}`,
    })),
  });
}

function binaryResponse(content = "binary"): Response {
  return new Response(content);
}

function createDependencies(
  responses: Response[],
  overrides: Partial<CliUpdateDependencies> = {},
): { dependencies: CliUpdateDependencies; state: MockUpdateState } {
  const state: MockUpdateState = {
    outputs: [],
    fetchedUrls: [],
    writes: [],
    chmods: [],
    renames: [],
    removes: [],
  };
  const queuedResponses = [...responses];
  const dependencies: CliUpdateDependencies = {
    fetchFn: (async (input: RequestInfo | URL) => {
      state.fetchedUrls.push(String(input));
      const response = queuedResponses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${String(input)}`);
      return response;
    }) as typeof fetch,
    out: (message: string) => {
      state.outputs.push(message);
    },
    currentVersion: "0.1.0",
    getPlatform: () => ({ platform: "linux", arch: "x64" }),
    getExecutablePath: () => "/usr/local/bin/link-cli",
    resolveRealPath: async () => "/real/link-cli",
    fileExists: async () => true,
    createTempDirectory: async () => "/real/.link-update-test",
    writeBinary: async (path, content) => {
      const text = typeof content === "string" ? content : new TextDecoder().decode(content);
      state.writes.push({ path, content: text });
    },
    chmodFile: async (path, mode) => {
      state.chmods.push({ path, mode });
    },
    renameFile: async (from, to) => {
      state.renames.push({ from, to });
    },
    removeFile: async (path) => {
      state.removes.push(path);
    },
    statFile: async () => ({ mode: 0o100755 }),
    ...overrides,
  };

  return { dependencies, state };
}

describe("release version helpers", () => {
  test("normalizes release versions and tags", () => {
    expect(normalizeReleaseVersion(" v1.2.3 ")).toBe("1.2.3");
    expect(normalizeReleaseTag("1.2.3")).toBe("v1.2.3");
    expect(() => normalizeReleaseVersion(" ")).toThrow("Missing release version");
  });

  test("compares semantic versions and prereleases", () => {
    expect(compareReleaseVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareReleaseVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareReleaseVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareReleaseVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBeGreaterThan(0);
  });

  test("resolves supported platforms and asset names", () => {
    expect(resolveReleasePlatform("linux", "x64")).toEqual({ os: "linux", arch: "x64" });
    expect(resolveReleasePlatform("darwin", "arm64")).toEqual({ os: "darwin", arch: "arm64" });
    expect(buildReleaseAssetName("v1.2.3", { os: "linux", arch: "x64" })).toBe("link-cli-v1.2.3-linux-x64");
    expect(() => resolveReleasePlatform("win32", "x64")).toThrow("Unsupported platform");
  });
});

describe("runUpdateCommand", () => {
  test("checks for updates without replacing the binary", async () => {
    const { dependencies, state } = createDependencies([
      releaseResponse("v0.2.0", ["link-cli-v0.2.0-linux-x64"]),
    ]);

    const exitCode = await runUpdateCommand({ checkOnly: true }, dependencies);

    expect(exitCode).toBe(0);
    expect(state.outputs).toContain("Update available: 0.1.0 -> 0.2.0");
    expect(state.writes).toHaveLength(0);
    expect(state.renames).toHaveLength(0);
  });

  test("does not replace when latest release is already installed", async () => {
    const { dependencies, state } = createDependencies(
      [releaseResponse("v0.1.0", ["link-cli-v0.1.0-linux-x64"])],
      {
        getExecutablePath: () => "/usr/bin/bun",
      },
    );

    const exitCode = await runUpdateCommand({ checkOnly: false }, dependencies);

    expect(exitCode).toBe(0);
    expect(state.outputs).toContain("link-cli 0.1.0 is up to date.");
    expect(state.renames).toHaveLength(0);
  });

  test("installs an explicit release version", async () => {
    const { dependencies, state } = createDependencies([
      releaseResponse("v1.2.3", ["link-cli-v1.2.3-linux-x64"]),
      binaryResponse("new-binary"),
    ]);

    const exitCode = await runUpdateCommand({ checkOnly: false, version: "1.2.3" }, dependencies);

    expect(exitCode).toBe(0);
    expect(state.fetchedUrls).toEqual([
      "https://api.github.com/repos/pablozaiden/link/releases/tags/v1.2.3",
      "https://downloads.example/link-cli-v1.2.3-linux-x64",
    ]);
    expect(state.writes).toEqual([
      { path: "/real/.link-update-test/link-cli-v1.2.3-linux-x64", content: "new-binary" },
    ]);
    expect(state.chmods).toEqual([{ path: "/real/.link-update-test/link-cli-v1.2.3-linux-x64", mode: 0o755 }]);
    expect(state.renames).toEqual([
      { from: "/real/.link-update-test/link-cli-v1.2.3-linux-x64", to: "/real/link-cli" },
    ]);
    expect(state.removes).toEqual([
      "/real/.link-update-test/link-cli-v1.2.3-linux-x64",
      "/real/.link-update-test",
    ]);
    expect(state.outputs).toContain("Installed link-cli 1.2.3 at /real/link-cli.");
  });

  test("rejects source-mode execution for installs", async () => {
    const { dependencies } = createDependencies(
      [releaseResponse("v0.2.0", ["link-cli-v0.2.0-linux-x64"])],
      {
        getExecutablePath: () => "/usr/bin/bun",
      },
    );

    await expect(runUpdateCommand({ checkOnly: false }, dependencies)).rejects.toThrow(
      "link-cli update only works from an installed Link CLI binary",
    );
  });

  test("fails clearly when a release asset is missing", async () => {
    const { dependencies } = createDependencies([releaseResponse("v0.2.0", [])]);

    await expect(runUpdateCommand({ checkOnly: true }, dependencies)).rejects.toThrow(
      "Release v0.2.0 does not include asset link-cli-v0.2.0-linux-x64",
    );
  });

  test("fails clearly on metadata and download errors", async () => {
    const metadataFailure = createDependencies([new Response("missing", { status: 404 })]);
    await expect(runUpdateCommand({ checkOnly: false, version: "9.9.9" }, metadataFailure.dependencies)).rejects.toThrow(
      "Release not found: v9.9.9",
    );

    const downloadFailure = createDependencies([
      releaseResponse("v0.2.0", ["link-cli-v0.2.0-linux-x64"]),
      new Response("nope", { status: 500 }),
    ]);
    await expect(runUpdateCommand({ checkOnly: false }, downloadFailure.dependencies)).rejects.toThrow(
      "Failed to update /real/link-cli",
    );
  });

  test("surfaces permission errors with an actionable message", async () => {
    const { dependencies } = createDependencies(
      [
        releaseResponse("v0.2.0", ["link-cli-v0.2.0-linux-x64"]),
        binaryResponse(),
      ],
      {
        renameFile: async () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        },
      },
    );

    await expect(runUpdateCommand({ checkOnly: false }, dependencies)).rejects.toThrow("permission denied");
  });
});
