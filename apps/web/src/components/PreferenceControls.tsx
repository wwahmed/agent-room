import { useState } from 'react';
import {
  storedThemeSetting,
  setThemeSetting,
  type ThemeSetting,
} from '../lib/theme.js';
import {
  READING_SCALES,
  currentReadingScale,
  setReadingScale,
  type ReadingScale,
} from '../lib/readingScale.js';

// T-26/T-27: the two personal preference groups, shared verbatim between the
// account-menu subpanels and the /settings page so the choices can never
// drift between surfaces. Proper radiogroup semantics with a visible active
// state; each row is a 44px target.

export const THEME_SETTINGS: { value: ThemeSetting; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follow this device' },
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
];

export function themeSettingLabel(setting: ThemeSetting): string {
  return THEME_SETTINGS.find(o => o.value === setting)?.label ?? 'System';
}

export function readingScaleLabel(scale: ReadingScale): string {
  return READING_SCALES.find(o => o.value === scale)?.label ?? 'Comfortable';
}

function ChoiceRow({ checked, label, hint, onSelect }: { checked: boolean; label: string; hint: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition hover:bg-surface-softer ${checked ? 'text-ink' : 'text-ink-soft'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-ink-faint">{hint}</span>
      </span>
      {checked && (
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-accent">
          <path d="m3 8.5 3.2 3.2L13 5" />
        </svg>
      )}
    </button>
  );
}

export function AppearanceChoices() {
  const [setting, setSetting] = useState<ThemeSetting>(() => storedThemeSetting());
  return (
    <div role="radiogroup" aria-label="Appearance">
      {THEME_SETTINGS.map(option => (
        <ChoiceRow
          key={option.value}
          checked={setting === option.value}
          label={option.label}
          hint={option.hint}
          onSelect={() => { setThemeSetting(option.value); setSetting(option.value); }}
        />
      ))}
    </div>
  );
}

export function ReadingScaleChoices() {
  const [scale, setScale] = useState<ReadingScale>(() => currentReadingScale());
  return (
    <div role="radiogroup" aria-label="Reading scale">
      {READING_SCALES.map(option => (
        <ChoiceRow
          key={option.value}
          checked={scale === option.value}
          label={option.label}
          hint={option.hint}
          onSelect={() => { setReadingScale(option.value); setScale(option.value); }}
        />
      ))}
    </div>
  );
}
