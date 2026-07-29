// T-46: the structured view contract — a fluid interface without executing model output.
//
// The host wants an interface that changes shape per turn: "give me a list of all
// the emails today" renders a list, "show me ONE of the emails" renders that one,
// "compose a response" renders a draft. His sketch had the agent emit HTML. That
// would mean executing model-authored markup inside an authenticated session that
// holds a live mailbox token, which is an XSS hole with his email behind it.
//
// So the agent emits DATA and the app renders it with its own components. Fluid
// because the agent chooses the view each turn; safe because nothing authored by a
// model is ever executed; consistent because the rendering is first-party.
//
// Everything below is deliberately strict. This parser is a trust boundary: its
// input is model output, which means it is untrusted input that will sometimes be
// malformed by accident and occasionally malicious on purpose.

export const STRUCTURED_VIEW_VERSION = 1;

/** Hard caps. A view is a summary, not a payload — and an unbounded one is both a
 *  rendering hazard and a way to push a wall of text past a reader. */
export const VIEW_LIMITS = {
  items: 50,
  fields: 30,
  actions: 6,
  shortText: 200,
  bodyText: 20_000,
  totalJson: 64 * 1024,
} as const;

export type ViewKind = 'list' | 'detail' | 'draft' | 'confirm';

export interface ViewAction {
  /** Opaque id the app echoes back; never a URL, never code. */
  id: string;
  label: string;
}

export interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badges?: string[];
}

export interface ListView { v: number; kind: 'list'; title?: string; empty?: string; items: ListItem[] }
export interface DetailField { label: string; value: string }
export interface DetailView { v: number; kind: 'detail'; title: string; fields: DetailField[]; body?: string; actions?: ViewAction[] }
export interface DraftView { v: number; kind: 'draft'; to?: string; subject?: string; body: string; note?: string; actions?: ViewAction[] }
export interface ConfirmView { v: number; kind: 'confirm'; prompt: string; confirmLabel: string; cancelLabel?: string }
export type StructuredView = ListView | DetailView | DraftView | ConfirmView;

export type ParseResult =
  | { ok: true; view: StructuredView }
  | { ok: false; reason: string; unsupportedVersion?: number };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function text(value: unknown, max: number, field: string): string | { error: string } {
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  if (value.length > max) return { error: `${field} exceeds ${max} characters` };
  // Control characters are stripped rather than rejected: they carry no meaning in
  // a rendered view, and a stray one should not throw away an otherwise good view.
  // \n and \t survive because multi-line bodies are the point of a draft.
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function strArray(value: unknown, max: number, field: string): string[] | { error: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: `${field} must be an array` };
  if (value.length > max) return { error: `${field} exceeds ${max} entries` };
  const out: string[] = [];
  for (const [i, entry] of value.entries()) {
    const t = text(entry, VIEW_LIMITS.shortText, `${field}[${i}]`);
    if (typeof t !== 'string') return t;
    out.push(t);
  }
  return out;
}

function actions(value: unknown): ViewAction[] | { error: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: 'actions must be an array' };
  if (value.length > VIEW_LIMITS.actions) return { error: `actions exceeds ${VIEW_LIMITS.actions} entries` };
  const out: ViewAction[] = [];
  for (const [i, raw] of value.entries()) {
    if (!isRecord(raw)) return { error: `actions[${i}] must be an object` };
    const id = text(raw.id, VIEW_LIMITS.shortText, `actions[${i}].id`);
    const label = text(raw.label, VIEW_LIMITS.shortText, `actions[${i}].label`);
    if (typeof id !== 'string') return id;
    if (typeof label !== 'string') return label;
    if (!id || !label) return { error: `actions[${i}] needs a non-empty id and label` };
    out.push({ id, label });
  }
  return out;
}

/**
 * Validate untrusted input into a renderable view.
 *
 * An unknown VERSION is reported separately from a malformed view, because the two
 * need different words in front of the user: "this agent is emitting a newer view
 * than this app understands" is a stale-client problem (see T-30), not corruption,
 * and the honest response is to show the raw text rather than a broken panel.
 */
export function parseStructuredView(input: unknown): ParseResult {
  if (typeof input === 'string') {
    if (input.length > VIEW_LIMITS.totalJson) return { ok: false, reason: 'view payload too large' };
    try { return parseStructuredView(JSON.parse(input) as unknown); }
    catch { return { ok: false, reason: 'view is not valid JSON' }; }
  }
  if (!isRecord(input)) return { ok: false, reason: 'view must be a JSON object' };

  const v = Number(input.v);
  if (!Number.isFinite(v)) return { ok: false, reason: 'view is missing a numeric "v" version' };
  if (v !== STRUCTURED_VIEW_VERSION) {
    return { ok: false, reason: `view version ${v} is not supported by this app`, unsupportedVersion: v };
  }

  const kind = input.kind;
  if (kind !== 'list' && kind !== 'detail' && kind !== 'draft' && kind !== 'confirm') {
    return { ok: false, reason: `unknown view kind ${JSON.stringify(kind)}` };
  }

  const fail = (r: string | { error: string }): ParseResult =>
    ({ ok: false, reason: typeof r === 'string' ? r : r.error });

  if (kind === 'list') {
    if (!Array.isArray(input.items)) return fail('list.items must be an array');
    if (input.items.length > VIEW_LIMITS.items) return fail(`list.items exceeds ${VIEW_LIMITS.items} entries`);
    const items: ListItem[] = [];
    for (const [i, raw] of input.items.entries()) {
      if (!isRecord(raw)) return fail(`list.items[${i}] must be an object`);
      const id = text(raw.id, VIEW_LIMITS.shortText, `items[${i}].id`);
      const title = text(raw.title, VIEW_LIMITS.shortText, `items[${i}].title`);
      if (typeof id !== 'string') return fail(id);
      if (typeof title !== 'string') return fail(title);
      const item: ListItem = { id, title };
      for (const key of ['subtitle', 'meta'] as const) {
        if (raw[key] !== undefined) {
          const t = text(raw[key], VIEW_LIMITS.shortText, `items[${i}].${key}`);
          if (typeof t !== 'string') return fail(t);
          item[key] = t;
        }
      }
      const badges = strArray(raw.badges, 6, `items[${i}].badges`);
      if (!Array.isArray(badges)) return fail(badges);
      if (badges.length) item.badges = badges;
      items.push(item);
    }
    const view: ListView = { v, kind, items };
    for (const key of ['title', 'empty'] as const) {
      if (input[key] !== undefined) {
        const t = text(input[key], VIEW_LIMITS.shortText, key);
        if (typeof t !== 'string') return fail(t);
        view[key] = t;
      }
    }
    return { ok: true, view };
  }

  if (kind === 'detail') {
    const title = text(input.title, VIEW_LIMITS.shortText, 'title');
    if (typeof title !== 'string') return fail(title);
    if (!Array.isArray(input.fields)) return fail('detail.fields must be an array');
    if (input.fields.length > VIEW_LIMITS.fields) return fail(`detail.fields exceeds ${VIEW_LIMITS.fields} entries`);
    const fields: DetailField[] = [];
    for (const [i, raw] of input.fields.entries()) {
      if (!isRecord(raw)) return fail(`detail.fields[${i}] must be an object`);
      const label = text(raw.label, VIEW_LIMITS.shortText, `fields[${i}].label`);
      const value = text(raw.value, VIEW_LIMITS.shortText, `fields[${i}].value`);
      if (typeof label !== 'string') return fail(label);
      if (typeof value !== 'string') return fail(value);
      fields.push({ label, value });
    }
    const acts = actions(input.actions);
    if (!Array.isArray(acts)) return fail(acts);
    const view: DetailView = { v, kind, title, fields };
    if (input.body !== undefined) {
      const b = text(input.body, VIEW_LIMITS.bodyText, 'body');
      if (typeof b !== 'string') return fail(b);
      view.body = b;
    }
    if (acts.length) view.actions = acts;
    return { ok: true, view };
  }

  if (kind === 'draft') {
    const body = text(input.body, VIEW_LIMITS.bodyText, 'body');
    if (typeof body !== 'string') return fail(body);
    const acts = actions(input.actions);
    if (!Array.isArray(acts)) return fail(acts);
    const view: DraftView = { v, kind, body };
    for (const key of ['to', 'subject', 'note'] as const) {
      if (input[key] !== undefined) {
        const t = text(input[key], VIEW_LIMITS.shortText, key);
        if (typeof t !== 'string') return fail(t);
        view[key] = t;
      }
    }
    if (acts.length) view.actions = acts;
    return { ok: true, view };
  }

  const prompt = text(input.prompt, VIEW_LIMITS.bodyText, 'prompt');
  const confirmLabel = text(input.confirmLabel, VIEW_LIMITS.shortText, 'confirmLabel');
  if (typeof prompt !== 'string') return fail(prompt);
  if (typeof confirmLabel !== 'string') return fail(confirmLabel);
  if (!confirmLabel) return fail('confirm.confirmLabel must be non-empty');
  const view: ConfirmView = { v, kind: 'confirm', prompt, confirmLabel };
  if (input.cancelLabel !== undefined) {
    const c = text(input.cancelLabel, VIEW_LIMITS.shortText, 'cancelLabel');
    if (typeof c !== 'string') return fail(c);
    view.cancelLabel = c;
  }
  return { ok: true, view };
}

/** Fence an agent uses to emit a view. A fenced block needs no protocol change —
 *  any agent on any client can emit one today, which is what makes T-47's
 *  "teach a new agent the contract" achievable with instructions alone. */
export const VIEW_FENCE_TAG = 'wakiview';

/** Extract the FIRST view block from message text, with the text around it.
 *  Returns null when there is none, so ordinary messages take no new path. */
export function extractViewBlock(text: string): { json: string; before: string; after: string } | null {
  if (typeof text !== 'string') return null;
  const re = new RegExp('```' + VIEW_FENCE_TAG + '\\s*\\n([\\s\\S]*?)```', 'i');
  const m = re.exec(text);
  if (!m || m[1] === undefined) return null;
  return {
    json: m[1],
    before: text.slice(0, m.index).trim(),
    after: text.slice(m.index + m[0].length).trim(),
  };
}
