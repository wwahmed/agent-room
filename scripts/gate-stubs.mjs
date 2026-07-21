// T-95 slice 2: fixture tenancy for the visual gate.
//
// The gate previously seeded a REAL fixture room through the live API and
// photographed the REAL work room - live reads, live writes, shared backing
// state. This module replaces all of it: every state renders from the frozen
// dataset (scripts/gate-fixtures.json, captured once read-only with
// authoritative server shapes), served through Playwright route stubs.
//
// Tenancy is enforced fail-closed, not promised: any request a fixture makes
// that is not a known read-only stub - every mutating /api/room action, any
// unknown /api path - is refused AND recorded as a violation. The gate turns
// violations into CAPTURE-INCOMPLETE (exit 5), so a fixture that so much as
// tries to touch real state cannot produce a green run. The before/after
// store diff the verifier runs should find zero changes because zero
// requests escape.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const DATASET = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'gate-fixtures.json'), 'utf8'));

// Read-only /api/room actions the app legitimately issues while rendering.
const READ_ACTIONS = {
  get: () => DATASET.room,
  messages: () => DATASET.messages,
  messageCount: () => DATASET.messageCount,
  health: () => DATASET.health,
  taskBoard: () => DATASET.taskBoard,
  turnState: () => DATASET.turnState,
  questionList: () => ({ questions: [] }),
  listenerCount: () => ({ count: 2 }),
};

export async function installGateStubs(page, { violations }) {
  const violate = (route, why) => {
    violations.push(why);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'GateTenancyViolation', message: why }) });
  };
  const json = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });

  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    if (path === '/api/room' && method === 'POST') {
      let action = '(unparseable)';
      try {
        action = JSON.parse(route.request().postData() || '{}').action ?? '(missing)';
      } catch {
        /* fall through to violation */
      }
      const read = READ_ACTIONS[action];
      if (read) return json(route, read());
      return violate(route, `mutating or unknown /api/room action "${action}" attempted by a gate fixture`);
    }
    if (path === '/api/me') return json(route, DATASET.me);
    if (path === '/api/rooms' && method === 'GET') return json(route, DATASET.rooms);
    if (path === '/api/projects' && method === 'GET') return json(route, { projects: [] });
    if (path === '/api/project/candidates' && method === 'GET') return json(route, { candidates: [] });
    // The composer-attach fixture pushes a real file through the real input;
    // the upload lands HERE instead of any server, and the deterministic
    // attachment lets the pending chip render exactly as in production.
    if (path === '/api/upload' && method === 'POST')
      return json(route, {
        id: 'gate-fixture-upload-1',
        type: 'image',
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGD4DwABBAEAX2At1QAAAABJRU5ErkJggg==',
        name: 'gate-fixture.png',
        size: 68,
        mime: 'image/png',
        uploadedAt: 1700000000000,
        width: 1,
        height: 1,
      });
    if (path === '/api/artifacts' && method === 'GET') return json(route, DATASET.artifacts);
    if (path === '/api/search' && method === 'GET') return json(route, { query: url.searchParams.get('q') ?? '', hits: [] });
    // The update banner compares the served bundle: pass this ONE read-only
    // endpoint through so the gate never photographs a false update prompt.
    if (path === '/api/version' && method === 'GET') return route.continue();
    return violate(route, `unstubbed ${method} ${path} attempted by a gate fixture`);
  });
}
