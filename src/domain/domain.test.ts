import { describe, expect, test } from "bun:test";
import { GraphError } from "./errors";
import { createId, slugify } from "./ids";
import { validateMetadata } from "./metadata";

describe("domain IDs", () => {
  test("slugifies names and handles collisions", () => {
    expect(slugify(" Project Alpha! ")).toBe("project-alpha");
    expect(createId({ name: "Project Alpha", existingIds: ["project-alpha", "project-alpha-2"] })).toBe("project-alpha-3");
  });

  test("rejects invalid explicit IDs", () => {
    expect(() => createId({ explicitId: "Bad ID", name: "Ignored", existingIds: [] })).toThrow(GraphError);
  });
});

describe("metadata validation", () => {
  test("validates declared fields and preserves unknown fields", () => {
    const metadata = validateMetadata(
      {
        status: { type: "enum", options: ["active", "blocked"], required: true },
        targetDate: { type: "date" },
        priority: { type: "number" },
      },
      { status: "active", targetDate: "2026-05-01", priority: 2, unknown: { nested: true } },
    );

    expect(metadata.unknown).toEqual({ nested: true });
  });

  test("rejects invalid enum values", () => {
    expect(() => validateMetadata({ status: { type: "enum", options: ["active"] } }, { status: "done" })).toThrow(GraphError);
  });
});

