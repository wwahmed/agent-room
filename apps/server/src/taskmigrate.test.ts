import { describe, it, expect } from 'vitest';
import { planAliasMigration, applyAliasMigration, applyBindingOverride, AliasMigrationError, type MigratableTask } from './taskmigrate.js';

const board = (): MigratableTask[] => [
  { id: 'T-30', owner: 'Claude · Foundation', ownerClient: 'cc', verifier: 'Codex', verifierClient: 'cc' },
  { id: 'T-31', owner: 'Claude · Foundation', ownerClient: 'cc', verifier: 'Codex', verifierClient: 'cc' },
  { id: 'T-28', owner: 'Claude-Web', ownerClient: 'cc', verifier: 'Codex', verifierClient: 'cc' },
  { id: 'T-14', owner: 'Codex', ownerClient: 'cc', verifier: undefined },
];

describe('alias migration — happy path', () => {
  it('rewrites owner bindings and preserves everything else', () => {
    const b = board();
    const changed = applyAliasMigration(b, { from: 'Claude · Foundation', to: 'TechLead-Claude', toClient: 'cc' });
    expect(changed).toEqual(['T-30.owner', 'T-31.owner']);
    expect(b.find(t => t.id === 'T-30')!.owner).toBe('TechLead-Claude');
    expect(b.find(t => t.id === 'T-31')!.owner).toBe('TechLead-Claude');
    // untouched bindings stay
    expect(b.find(t => t.id === 'T-30')!.verifier).toBe('Codex');
    expect(b.find(t => t.id === 'T-28')!.owner).toBe('Claude-Web');
  });

  it('rewrites verifier bindings too (Codex -> ProdMgr-Codex)', () => {
    const b = board();
    const changed = applyAliasMigration(b, { from: 'Codex', to: 'ProdMgr-Codex', toClient: 'cc' });
    expect(changed).toEqual(['T-30.verifier', 'T-31.verifier', 'T-28.verifier', 'T-14.owner']);
    expect(b.find(t => t.id === 'T-14')!.owner).toBe('ProdMgr-Codex');
    expect(b.find(t => t.id === 'T-30')!.verifier).toBe('ProdMgr-Codex');
  });

  it('is idempotent / replay-safe: second run matches nothing', () => {
    const b = board();
    applyAliasMigration(b, { from: 'Claude · Foundation', to: 'TechLead-Claude', toClient: 'cc' });
    const again = applyAliasMigration(b, { from: 'Claude · Foundation', to: 'TechLead-Claude', toClient: 'cc' });
    expect(again).toEqual([]);
  });
});

describe('alias migration — fail closed', () => {
  it('rejects empty from/to', () => {
    expect(() => planAliasMigration(board(), { from: '', to: 'X', toClient: 'cc' })).toThrow(AliasMigrationError);
    expect(() => planAliasMigration(board(), { from: 'Codex', to: '', toClient: 'cc' })).toThrow(/required/);
  });

  it('rejects from === to', () => {
    expect(() => planAliasMigration(board(), { from: 'Codex', to: 'Codex', toClient: 'cc' })).toThrow(/must differ/);
  });

  it('rejects a remap that would make owner == verifier (collision), mutating nothing', () => {
    // T-30 owner=Claude · Foundation, verifier=Codex. Migrating the owner to
    // "Codex" would collide with the verifier.
    const b = board();
    expect(() => applyAliasMigration(b, { from: 'Claude · Foundation', to: 'Codex', toClient: 'cc' }))
      .toThrow(/owner==verifier on T-30/);
    // fail-closed: nothing changed
    expect(b.find(t => t.id === 'T-30')!.owner).toBe('Claude · Foundation');
    expect(b.find(t => t.id === 'T-31')!.owner).toBe('Claude · Foundation');
  });

  it('binding override sets one task field, function-based (Claude blanket then T-25 owner override)', () => {
    const b = board();
    applyAliasMigration(b, { from: 'Claude · Foundation', to: 'TechLead-Claude', toClient: 'cc' });
    // add a task owned by bare "Claude" to mimic T-25
    b.push({ id: 'T-25', owner: 'Claude', ownerClient: 'cc', verifier: 'Codex', verifierClient: 'cc' });
    applyAliasMigration(b, { from: 'Claude', to: 'Frontend-Claude', toClient: 'cc' }); // blanket
    expect(b.find(t => t.id === 'T-25')!.owner).toBe('Frontend-Claude');
    const key = applyBindingOverride(b, { taskId: 'T-25', field: 'owner', to: 'TechLead-Claude', toClient: 'cc' });
    expect(key).toBe('T-25.owner');
    expect(b.find(t => t.id === 'T-25')!.owner).toBe('TechLead-Claude');
    expect(b.find(t => t.id === 'T-25')!.verifier).toBe('Codex'); // untouched
  });

  it('override fails closed on a missing task and on owner==verifier collision', () => {
    const b = board();
    expect(() => applyBindingOverride(b, { taskId: 'T-99', field: 'owner', to: 'X', toClient: 'cc' }))
      .toThrow(/not found/);
    // T-30 verifier=Codex; overriding owner to Codex collides
    expect(() => applyBindingOverride(b, { taskId: 'T-30', field: 'owner', to: 'Codex', toClient: 'cc' }))
      .toThrow(/owner==verifier/);
    expect(b.find(t => t.id === 'T-30')!.owner).toBe('Claude · Foundation'); // unchanged
  });

  it('CollisionError carries a distinct error code', () => {
    try {
      planAliasMigration(board(), { from: 'Claude · Foundation', to: 'Codex', toClient: 'cc' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AliasMigrationError).name).toBe('CollisionError');
    }
  });
});
