// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { RoomBadges } from './RoomBadges.js';

// The badge exists because the unread counter structurally cannot cover this
// case: the question appears while the owner is in the room, and being in the
// room marks it read. So the rule under test is that the question badge does
// NOT behave like unread.

function render(ui: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { createRoot(host).render(ui); });
  return host;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('needs-your-answer badge', () => {
  it('shows when a question is waiting', () => {
    const host = render(<RoomBadges code="a-b-c" messageCount={0} selfName="Waqas" openQuestionCount={1} />);
    const badge = host.querySelector('[data-question-badge]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('aria-label')).toBe('1 question waiting for your answer');
  });

  it('counts multiple waiting questions', () => {
    const host = render(<RoomBadges code="a-b-c" messageCount={0} selfName="Waqas" openQuestionCount={3} />);
    const badge = host.querySelector('[data-question-badge]')!;
    expect(badge.textContent).toBe('?3');
    expect(badge.getAttribute('aria-label')).toBe('3 questions waiting for your answer');
  });

  it('is absent when nothing is waiting', () => {
    const host = render(<RoomBadges code="a-b-c" messageCount={0} selfName="Waqas" openQuestionCount={0} />);
    expect(host.querySelector('[data-question-badge]')).toBeNull();
  });

  it('is absent when the server did not send the field at all', () => {
    const host = render(<RoomBadges code="a-b-c" messageCount={0} selfName="Waqas" />);
    expect(host.querySelector('[data-question-badge]')).toBeNull();
  });

  // THE regression this feature is about.
  it('survives being the ACTIVE room — unlike unread, reading does not answer it', () => {
    const host = render(
      <RoomBadges code="a-b-c" messageCount={500} selfName="Waqas" active openQuestionCount={1} />,
    );
    expect(host.querySelector('[data-question-badge]')).not.toBeNull();
    // ...while unread is correctly suppressed for the room being read.
    expect(host.querySelector('[data-unread-badge]')).toBeNull();
  });

  it('survives a fully-read room, where unread is zero by definition', () => {
    localStorage.setItem('wakichat:read:a-b-c', '500');
    const host = render(<RoomBadges code="a-b-c" messageCount={500} selfName="Waqas" openQuestionCount={2} />);
    expect(host.querySelector('[data-question-badge]')).not.toBeNull();
    expect(host.querySelector('[data-unread-badge]')).toBeNull();
  });

  it.each([[-1], [0], [Number.NaN]])('renders nothing for a junk count (%s)', value => {
    const host = render(
      <RoomBadges code="a-b-c" messageCount={0} selfName="Waqas" openQuestionCount={value} />,
    );
    expect(host.querySelector('[data-question-badge]')).toBeNull();
  });
});
