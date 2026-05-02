import type { GraphEdge, Metadata, MetadataEntry } from "./types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  return body;
}

export function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

export function edgeDirectionFormValue(form: HTMLFormElement): GraphEdge["direction"] {
  return new FormData(form).get("bidirectional") ? "bidirectional" : "directed";
}

export function metadataFormValue(form: HTMLFormElement, name: string): Metadata {
  const validationError = formValue(form, `${name}ValidationError`);
  if (validationError) {
    throw new Error(validationError);
  }

  return parseJsonObject(formValue(form, name));
}

export function parseJsonObject(value: string): Metadata {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON fields must contain an object.");
  }
  return parsed as Metadata;
}

export function parseMetadataValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export function metadataToEntries(metadata: Metadata): MetadataEntry[] {
  return Object.entries(metadata).map(([key, value], index) => ({
    id: `metadata-${index}-${key}`,
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

export function serializeMetadataEntries(entries: MetadataEntry[]): string {
  const metadata: Metadata = {};

  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value.trim();

    if (!key && !value) {
      continue;
    }

    if (!key) {
      throw new Error("Metadata property keys are required when a value is provided.");
    }

    if (key in metadata) {
      throw new Error(`Duplicate metadata property: ${key}`);
    }

    metadata[key] = parseMetadataValue(entry.value);
  }

  return JSON.stringify(metadata);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}