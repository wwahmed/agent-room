import { beforeEach, describe, expect, it } from 'vitest';

import type { UpstashClient } from './client.js';
import { createRoom, getRoom, setRoomOutputInstructions } from './rooms.js';

function memoryClient(): UpstashClient {
  const store = new Map<string, string>();
  return {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      const parts = cmd.map(String);
      const op = (parts[0] ?? '').toUpperCase();
      const key = parts[1] ?? '';
      if (op === 'GET') return (store.get(key) ?? null) as T;
      if (op === 'SET') { store.set(key, parts[2] ?? ''); return 'OK' as T; }
      throw new Error(`unsupported in test client: ${op}`);
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      const out: T[] = [];
      for (const command of cmds) out.push(await this.command<T>(command));
      return out;
    },
  } as UpstashClient;
}

describe('room output instruction persistence', () => {
  let client: UpstashClient;
  const code = 'ABC-DEF-GHJ';

  beforeEach(async () => {
    client = memoryClient();
    await createRoom(client, {
      code,
      topic: 'Fluid workspace',
      createdBy: 'Waqas',
      templateId: 'fluid-interface',
    });
  });

  it('persists owner guidance on the room record and survives a fresh read', async () => {
    const saved = await setRoomOutputInstructions(client, code, 'Use one-line summaries.', 'Waqas');
    expect(saved.outputInstructions).toBe('Use one-line summaries.');
    expect(saved.outputInstructionsUpdatedBy).toBe('Waqas');
    expect(saved.outputInstructionsUpdatedAt).toEqual(expect.any(Number));

    const reread = await getRoom(client, code);
    expect(reread.outputInstructions).toBe('Use one-line summaries.');
  });

  it('clears the override and audit fields so resolution returns to the template', async () => {
    await setRoomOutputInstructions(client, code, 'Override', 'Waqas');
    const reset = await setRoomOutputInstructions(client, code, '', 'Waqas');
    expect(reset.outputInstructions).toBeUndefined();
    expect(reset.outputInstructionsUpdatedAt).toBeUndefined();
    expect(reset.outputInstructionsUpdatedBy).toBeUndefined();
  });
});
