import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import type { UpdaterDependencies } from "@pablozaiden/installer";
import { LINK_VERSION } from "../version";
import { LINK_UPDATER_CONFIG, runUpdateCommand } from "./update";

type MockUpdateState = {
  outputs: string[];
  errors: string[];
  fetchedUrls: string[];
  fetchInits: Array<RequestInit | undefined>;
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

function checksumResponse(assetName: string, content = "binary"): Response {
  const checksum = createHash("sha256").update(content).digest("hex");
  return new Response(`${checksum}  ${assetName}\n`);
}

function createDependencies(
  responses: Response[],
  overrides: Partial<UpdaterDependencies> = {},
): { dependencies: Partial<UpdaterDependencies>; state: MockUpdateState } {
  const state: MockUpdateState = {
    outputs: [],
    errors: [],
    fetchedUrls: [],
    fetchInits: [],
    writes: [],
    chmods: [],
    renames: [],
    removes: [],
  };
  const queuedResponses = [...responses];
  const dependencies: Partial<UpdaterDependencies> = {
    fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
      state.fetchedUrls.push(String(input));
      state.fetchInits.push(init);
      const response = queuedResponses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${String(input)}`);
      return response;
    }) as typeof fetch,
    out: message => {
      state.outputs.push(message);
    },
    err: message => {
      state.errors.push(message);
    },
    getPlatform: () => ({ platform: "linux", arch: "x64" }),
    getExecutablePath: () => "/usr/local/bin/link-cli",
    resolveRealPath: async () => "/real/link-cli",
    fileExists: async () => true,
    createTempDirectory: async (_targetDirectory, prefix) => `/real/${prefix}test`,
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
    removeFile: async path => {
      state.removes.push(path);
    },
    statFile: async () => ({ mode: 0o100755 }),
    ...overrides,
  };

  return { dependencies, state };
}

describe("Link updater adapter", () => {
  test("uses the shared installer updater with Link config", () => {
    expect(LINK_UPDATER_CONFIG).toEqual({
      repository: "pablozaiden/link",
      binaryName: "link-cli",
      currentVersion: LINK_VERSION,
      productName: "Link",
      checksum: { required: true },
    });
  });

  test("checks for updates using Link release assets", async () => {
    const { dependencies, state } = createDependencies([
      releaseResponse("v0.2.0", ["link-cli-v0.2.0-linux-x64"]),
    ]);

    const exitCode = await runUpdateCommand({ checkOnly: true }, dependencies);

    expect(exitCode).toBe(0);
    expect(state.fetchedUrls).toEqual(["https://api.github.com/repos/pablozaiden/link/releases/latest"]);
    expect(state.fetchInits[0]?.headers).toEqual({
      accept: "application/vnd.github+json",
      "user-agent": "link-cli-updater",
      "x-github-api-version": "2022-11-28",
    });
    expect(state.outputs).toContain(`Update available: ${LINK_VERSION} -> 0.2.0`);
    expect(state.writes).toHaveLength(0);
    expect(state.renames).toHaveLength(0);
  });

  test("installs an explicit Link release after checksum verification", async () => {
    const assetName = "link-cli-v1.2.3-linux-x64";
    const { dependencies, state } = createDependencies([
      releaseResponse("v1.2.3", [assetName, `${assetName}.sha256`]),
      binaryResponse("new-binary"),
      checksumResponse(assetName, "new-binary"),
    ]);

    const exitCode = await runUpdateCommand({ checkOnly: false, version: "1.2.3" }, dependencies);

    expect(exitCode).toBe(0);
    expect(state.fetchedUrls).toEqual([
      "https://api.github.com/repos/pablozaiden/link/releases/tags/v1.2.3",
      "https://downloads.example/link-cli-v1.2.3-linux-x64",
      "https://downloads.example/link-cli-v1.2.3-linux-x64.sha256",
    ]);
    expect(state.writes).toEqual([
      { path: "/real/.link-cli-update-test/link-cli-v1.2.3-linux-x64", content: "new-binary" },
    ]);
    expect(state.chmods).toEqual([{ path: "/real/.link-cli-update-test/link-cli-v1.2.3-linux-x64", mode: 0o755 }]);
    expect(state.renames).toEqual([
      { from: "/real/link-cli", to: "/real/.link-cli-update-test/link-cli.backup" },
      { from: "/real/.link-cli-update-test/link-cli-v1.2.3-linux-x64", to: "/real/link-cli" },
    ]);
    expect(state.removes).toEqual(["/real/.link-cli-update-test"]);
    expect(state.outputs).toContain("Installed link-cli 1.2.3 at /real/link-cli.");
  });

  test("surfaces source-mode execution guidance from the shared updater", async () => {
    const { dependencies } = createDependencies(
      [releaseResponse("v0.2.0", ["link-cli-v0.2.0-linux-x64"])],
      {
        getExecutablePath: () => "/usr/bin/bun",
      },
    );

    await expect(runUpdateCommand({ checkOnly: false }, dependencies)).rejects.toThrow(
      "link-cli update only works from an installed Link binary. Use the installer script when running from source.",
    );
  });
});
