import { describe, expect, test } from "bun:test";
import path from "path";

const root = path.resolve(import.meta.dir, "../..");

async function readRepoFile(relativePath: string): Promise<string> {
  return await Bun.file(path.join(root, relativePath)).text();
}

describe("release binary naming", () => {
  test("installer downloads and installs linkserver", async () => {
    const installScript = await readRepoFile("install.sh");

    expect(installScript).toContain('BINARY_NAME="linkserver"');
    expect(installScript).toContain('ASSET_NAME="$BINARY_NAME-$LATEST_TAG-$OS-$ARCH"');
    expect(installScript).toContain('mv "$TEMP_FILE" "$INSTALL_DIR/$BINARY_NAME"');
    expect(installScript).toContain("Run 'linkserver' to start Link.");
    expect(installScript).not.toContain('BINARY_NAME="link"');
    expect(installScript).not.toContain("Run 'link' to start Link.");
  });

  test("binary release workflow emits linkserver assets", async () => {
    const workflow = await readRepoFile(".github/workflows/binary-release.yml");

    expect(workflow).toContain("--outfile dist/linkserver-${{ github.ref_name }}-${{ matrix.target }}");
    expect(workflow).toContain("shasum -a 256 linkserver-${{ github.ref_name }}-${{ matrix.target }}");
    expect(workflow).toContain("name: linkserver-${{ github.ref_name }}-${{ matrix.target }}");
    expect(workflow).toContain("gh release upload ${{ github.ref_name }} dist/linkserver-${{ github.ref_name }}-${{ matrix.target }}");
    expect(workflow).not.toContain("dist/link-${{ github.ref_name }}-${{ matrix.target }}");
    expect(workflow).not.toContain("name: link-${{ github.ref_name }}-${{ matrix.target }}");
  });
});
