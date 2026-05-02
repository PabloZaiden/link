import { duplicateError, validationError } from "./errors";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "record";
}

export function assertValidId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw validationError("IDs must be lowercase slugs containing letters, numbers, and single dashes.", { id });
  }
}

export function createId(input: { explicitId?: string; name: string; existingIds: Iterable<string> }): string {
  const existing = new Set(input.existingIds);
  if (input.explicitId !== undefined && input.explicitId.trim() !== "") {
    const explicitId = input.explicitId.trim();
    assertValidId(explicitId);
    if (existing.has(explicitId)) {
      throw duplicateError("A record with this ID already exists.", { id: explicitId });
    }
    return explicitId;
  }

  const base = slugify(input.name);
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

