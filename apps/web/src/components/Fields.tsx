import { useEffect, useRef, useState } from "react";

export function NumberField({
  label,
  value,
  onChange,
  unit = "mm",
  disabled = false,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => unknown;
  unit?: string;
  disabled?: boolean;
  step?: number;
}) {
  const cancelled = useRef(false);
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label className={`number-field ${disabled ? "disabled" : ""}`}>
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (cancelled.current) {
              cancelled.current = false;
              setDraft(String(value));
              return;
            }
            const next = Number(draft);
            if (draft !== "" && Number.isFinite(next)) {
              if (next !== value && onChange(next) === false) setDraft(String(value));
            } else setDraft(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(value);
          return;
        }
        const next = draft.trim();
        if (!next || (next !== value && onChange(next) === false)) {
          setDraft(value);
        } else {
          setDraft(next);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
