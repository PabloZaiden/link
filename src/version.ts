import packageJson from "../package.json";

export const LINK_VERSION = packageJson.version;

export function formatLinkVersion(binaryName = "link-cli"): string {
  return `${binaryName} ${LINK_VERSION}`;
}
