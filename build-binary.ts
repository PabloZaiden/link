#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";

const workspaceDir = import.meta.dir;
const outputDir = `${workspaceDir}/dist`;
const tempOutputDir = await Bun.$`mktemp -d`.text().then(value => value.trim());
const originalCwd = process.cwd();
const targetArg = process.argv.find(arg => arg.startsWith("--target="));
const target = targetArg?.split("=")[1] as
  | "bun-linux-x64"
  | "bun-linux-arm64"
  | "bun-darwin-x64"
  | "bun-darwin-arm64"
  | "bun-windows-x64"
  | undefined;
const outfileArg = process.argv.find(arg => arg.startsWith("--outfile="));
const explicitOutfile = outfileArg?.split("=")[1];
const tempBinaryPath = target?.startsWith("bun-windows")
  ? `${tempOutputDir}/link-cli.exe`
  : `${tempOutputDir}/link-cli`;
const destPath = explicitOutfile ?? `${outputDir}/${target ? `link-cli-${target.replace("bun-", "")}` : "link-cli"}`;

let buildSucceeded = false;

try {
  process.chdir(tempOutputDir);

  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [`${workspaceDir}/src/index.ts`],
      compile: target ? { outfile: tempBinaryPath, target } : { outfile: tempBinaryPath },
      plugins: [plugin],
      minify: true,
      sourcemap: true,
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
    });
  } finally {
    process.chdir(originalCwd);
  }

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exitCode = 1;
  } else {
    await Bun.$`mkdir -p ${outputDir}`.quiet();
    await Bun.write(destPath, Bun.file(tempBinaryPath));
    if (!target?.startsWith("bun-windows")) {
      await Bun.$`chmod +x ${destPath}`.quiet();
    }
    buildSucceeded = true;
  }
} finally {
  process.chdir(originalCwd);
  await Bun.$`rm -rf ${tempOutputDir}`.quiet();
}

if (!buildSucceeded) {
  process.exit(process.exitCode ?? 1);
}
