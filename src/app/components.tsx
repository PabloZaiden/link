import { useEffect, useMemo, useState, type ReactNode } from "react";
import { metadataToEntries, serializeMetadataEntries } from "./utils";
import type { Metadata, MetadataEntry, TypeFilterControlProps } from "./types";

export function TypeFilterControl(props: TypeFilterControlProps) {
  const selectedOptions = props.options.filter(option => props.selectedIds.includes(option.id));
  const summary =
    selectedOptions.length === 0
      ? props.allLabel
      : selectedOptions.length === 1
        ? selectedOptions[0]?.name ?? props.allLabel
        : `${selectedOptions.length} selected`;

  const toggleOption = (optionId: string) => {
    const nextSelection = props.selectedIds.includes(optionId)
      ? props.selectedIds.filter(currentId => currentId !== optionId)
      : [...props.selectedIds, optionId];

    props.onChange(nextSelection);
  };

  return (
    <details className="filter-menu group">
      <summary className="filter-menu__summary">
        <span className="filter-menu__label">{props.label}</span>
        <span className="filter-menu__value">{summary}</span>
      </summary>
      <div className="filter-menu__panel">
        <div className="filter-menu__actions">
          <button type="button" onClick={() => props.onChange([])} disabled={props.selectedIds.length === 0}>
            All
          </button>
          <button
            type="button"
            onClick={() => props.onChange(props.options.map(option => option.id))}
            disabled={props.options.length === 0 || props.selectedIds.length === props.options.length}
          >
            Select all
          </button>
        </div>
        {props.options.length === 0 ? (
          <p className="filter-menu__empty">No types available yet.</p>
        ) : (
          <div className="filter-menu__options">
            {props.options.map(option => {
              const checked = props.selectedIds.includes(option.id);
              return (
                <label key={option.id} className="filter-menu__option">
                  <input type="checkbox" checked={checked} onChange={() => toggleOption(option.id)} />
                  <span>{option.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

export function Panel(props: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl shadow-black/20 ${props.className ?? ""}`.trim()}>
      {props.title && <h2 className="mb-4 text-lg font-semibold">{props.title}</h2>}
      {props.children}
    </section>
  );
}

export function TabButton(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={props.active ? "tab active" : "tab"} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function MetadataEditor(props: { name: string; initialMetadata?: Metadata }) {
  const [entries, setEntries] = useState<MetadataEntry[]>(() => metadataToEntries(props.initialMetadata ?? {}));

  useEffect(() => {
    setEntries(metadataToEntries(props.initialMetadata ?? {}));
  }, [props.initialMetadata]);

  const validation = useMemo(() => {
    try {
      return { serializedValue: serializeMetadataEntries(entries), error: "" };
    } catch (err) {
      return {
        serializedValue: JSON.stringify({ __metadataEditorInvalid: true, entries }),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [entries]);

  const updateEntry = (id: string, field: "key" | "value", value: string) => {
    setEntries(current => current.map(entry => (entry.id === id ? { ...entry, [field]: value } : entry)));
  };

  const addEntry = () => {
    setEntries(current => [...current, { id: `metadata-row-${crypto.randomUUID()}`, key: "", value: "" }]);
  };

  const removeEntry = (id: string) => {
    setEntries(current => current.filter(entry => entry.id !== id));
  };

  return (
    <div className="space-y-3">
      <input name={props.name} type="hidden" value={validation.serializedValue} readOnly />
      <input name={`${props.name}ValidationError`} type="hidden" value={validation.error} readOnly />
      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <small className="!mb-0">Extra properties</small>
          <button
            type="button"
            onClick={addEntry}
            className="inline-flex h-8 w-8 items-center justify-center p-0 text-lg leading-none"
            aria-label="Add property"
            title="Add property"
          >
            +
          </button>
        </div>
        {entries.length === 0 && <small>No extra properties yet.</small>}
        {entries.map(entry => (
          <div key={entry.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-start">
            <input value={entry.key} onChange={event => updateEntry(entry.id, "key", event.target.value)} placeholder="Key" />
            <input
              value={entry.value}
              onChange={event => updateEntry(entry.id, "value", event.target.value)}
              placeholder='Value, e.g. active, 3, true, or {"tier":"gold"}'
            />
            <button type="button" className="danger" onClick={() => removeEntry(entry.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      {validation.error ? (
        <p className="rounded-lg border border-violet-500/20 bg-zinc-900 p-3 text-sm text-zinc-200">{validation.error}</p>
      ) : (
        <small>Values are stored as JSON. Numbers, booleans, arrays, and objects are parsed automatically.</small>
      )}
    </div>
  );
}