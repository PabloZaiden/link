import {
  runUpdateCommand as runInstallerUpdateCommand,
  type UpdateCommandOptions,
  type UpdaterConfig,
  type UpdaterDependencies,
} from "@pablozaiden/installer";
import { LINK_VERSION } from "../version";

export type { UpdateCommandOptions };

export const LINK_UPDATER_CONFIG = {
  repository: "pablozaiden/link",
  binaryName: "link-cli",
  currentVersion: LINK_VERSION,
  productName: "Link",
  checksum: { required: true },
} satisfies UpdaterConfig;

export async function runUpdateCommand(
  command: UpdateCommandOptions,
  dependencyOverrides: Partial<UpdaterDependencies> = {},
): Promise<number> {
  return await runInstallerUpdateCommand(command, LINK_UPDATER_CONFIG, dependencyOverrides);
}
