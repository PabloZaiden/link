import { validationError } from "./errors";
import type { Metadata, MetadataFieldSchema, MetadataSchema, MetadataValue } from "./types";

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function validateField(key: string, field: MetadataFieldSchema, value: MetadataValue | undefined): void {
  if (value === undefined || value === null || value === "") {
    if (field.required) {
      throw validationError("Required metadata field is missing.", { field: key });
    }
    return;
  }

  switch (field.type) {
    case "string":
      if (typeof value !== "string") throw validationError("Metadata field must be a string.", { field: key, value });
      return;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw validationError("Metadata field must be a number.", { field: key, value });
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") throw validationError("Metadata field must be a boolean.", { field: key, value });
      return;
    case "date":
      if (typeof value !== "string" || !isDateString(value)) {
        throw validationError("Metadata field must be a date in YYYY-MM-DD format.", { field: key, value });
      }
      return;
    case "enum":
      if (typeof value !== "string" || !field.options?.includes(value)) {
        throw validationError("Metadata field must match one of the configured options.", {
          field: key,
          value,
          options: field.options ?? [],
        });
      }
      return;
  }
}

export function validateMetadata(schema: MetadataSchema, metadata: Metadata): Metadata {
  for (const [key, field] of Object.entries(schema)) {
    validateField(key, field, metadata[key]);
  }
  return metadata;
}

export function validateMetadataSchema(schema: MetadataSchema): MetadataSchema {
  for (const [key, field] of Object.entries(schema)) {
    if (!key.trim()) throw validationError("Metadata schema field names cannot be empty.");
    if (field.type === "enum" && (!field.options || field.options.length === 0)) {
      throw validationError("Enum metadata fields must define at least one option.", { field: key });
    }
  }
  return schema;
}

export function parseMetadata(value: unknown): Metadata {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Metadata must be an object.");
  }
  return value as Metadata;
}

export function parseMetadataSchema(value: unknown): MetadataSchema {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Metadata schema must be an object.");
  }
  return validateMetadataSchema(value as MetadataSchema);
}

