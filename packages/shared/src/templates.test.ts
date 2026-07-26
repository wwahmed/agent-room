import { describe, expect, it } from 'vitest';
import { ROOM_TEMPLATES_SHARED, isKnownTemplateId, templateInfo } from './templates.js';

describe('shared room-template registry', () => {
  it('ids are unique, slug-shaped, and include the seven launch templates', () => {
    const ids = ROOM_TEMPLATES_SHARED.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
    for (const known of ['blank', 'code-review', 'feature-build', 'bug-fix', 'incident', 'strategy', 'delivery']) {
      expect(ids).toContain(known);
    }
  });

  it('every template carries a non-empty label and a one-line agent brief', () => {
    for (const t of ROOM_TEMPLATES_SHARED) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.brief.length).toBeGreaterThan(20);
      expect(t.brief).not.toContain('\n'); // one line — it rides in join responses
    }
  });

  it('templateInfo resolves known ids and returns null otherwise', () => {
    expect(templateInfo('incident')?.label).toBe('Incident Response');
    expect(templateInfo('nope')).toBe(null);
    expect(templateInfo(undefined)).toBe(null);
    expect(templateInfo('')).toBe(null);
  });

  it('isKnownTemplateId is strict — unknown ids must 400 at the API, not normalize', () => {
    expect(isKnownTemplateId('bug-fix')).toBe(true);
    expect(isKnownTemplateId('Bug-Fix')).toBe(false);
    expect(isKnownTemplateId(42)).toBe(false);
    expect(isKnownTemplateId(undefined)).toBe(false);
  });
});
