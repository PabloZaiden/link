import { describe, expect, test } from "bun:test";
import { parseCliOptions } from "./cli";

describe("parseCliOptions", () => {
  test("defaults to read-only startup without validation or seed", () => {
    expect(parseCliOptions(["bun", "src/index.ts"])).toEqual({ validate: false, seed: false });
  });

  test("detects explicit seed startup", () => {
    expect(parseCliOptions(["bun", "src/index.ts", "--seed"])).toEqual({ validate: false, seed: true });
  });

  test("keeps validate and seed flags visible so validation can remain read-only", () => {
    expect(parseCliOptions(["bun", "src/index.ts", "--validate", "--seed"])).toEqual({ validate: true, seed: true });
  });
});
