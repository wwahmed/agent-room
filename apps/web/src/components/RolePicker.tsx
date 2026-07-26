import { useState } from 'react';
import { ROLE_PRESETS } from '@agent-room/shared';

// One smart role control (replaces the select + always-visible free-text
// double input that made Create/Join feel busy): a single select whose
// "Custom…" choice reveals the text input only when it's actually wanted.
// Presets write the preset's role string; custom keeps whatever is typed.

interface Props {
  value: string;
  onChange: (role: string) => void;
  /** Field label; defaults to "Your role". */
  label?: string;
  className?: string;
  fieldClass: string;
}

export function RolePicker({ value, onChange, label = 'Your role', className, fieldClass }: Props) {
  const matchesPreset = ROLE_PRESETS.some(p => p.role === value);
  // Custom stays open once chosen (or when arriving with a non-preset value),
  // so editing a custom role never bounces the input away mid-keystroke.
  const [customOpen, setCustomOpen] = useState(Boolean(value) && !matchesPreset);
  const selectValue = customOpen ? '__custom__' : matchesPreset ? value : '';

  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
        {label} <span className="font-medium text-ink-faint">optional</span>
      </span>
      <select
        value={selectValue}
        onChange={e => {
          if (e.target.value === '__custom__') {
            setCustomOpen(true);
            onChange('');
          } else {
            setCustomOpen(false);
            onChange(e.target.value);
          }
        }}
        className={fieldClass}
      >
        <option value="">No role</option>
        {ROLE_PRESETS.map(p => <option key={p.id} value={p.role}>{p.label}</option>)}
        <option value="__custom__">Custom…</option>
      </select>
      {customOpen && (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. Frontend reviewer"
          autoFocus
          className={`${fieldClass} mt-2`}
        />
      )}
    </label>
  );
}
