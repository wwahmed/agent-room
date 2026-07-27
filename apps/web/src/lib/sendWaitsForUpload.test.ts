import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');

// T-21 (host bug report): Send racing an in-flight upload shipped the text
// WITHOUT its image. Send must hold until every upload lands, then fire.
describe('Send waits for in-flight uploads — text and image travel together', () => {
  it('send() holds instead of sending while any attachment job is uploading', () => {
    const guard = room.indexOf("if (attachmentJobs.some(j => j.state === 'uploading')) {");
    expect(guard).toBeGreaterThan(-1);
    const sendStart = room.indexOf('async function send(bodyOverride');
    // The hold lives INSIDE send(), after the empty/ended guard.
    expect(guard).toBeGreaterThan(sendStart);
    expect(room.slice(guard, guard + 400)).toContain('pendingSendRef.current = true');
    expect(room.slice(guard, guard + 500)).toContain('return;');
  });

  it('the hold releases when uploads land: success sends, failure holds with a retry message', () => {
    expect(room).toContain('pendingSendRef.current = false;');
    const release = room.indexOf('T-21: release a held send');
    const block = room.slice(release, release + 900);
    expect(block).toContain("attachmentJobs.some(j => j.state === 'failed')");
    expect(block).toContain('Retry or remove the attachment');
    expect(block).toContain('void send();');
  });

  it('the Send button announces the held state instead of looking ignored', () => {
    expect(room).toContain('data-gate="send-waiting-upload-state"');
    expect(room).toContain('Waiting for the upload to finish');
    expect(room).toContain('setSendWaitingOnUpload(true)');
  });
});
