// T-40 (T-38b): Home's list organization. Active is the default view; Ended
// renders lazily behind the segmented control; convention-named auto-test
// rooms (the T-xx smoke/probe rooms agents mint while verifying) collapse
// into one quiet summary row instead of burying real work.

export interface SectionableRoom {
  status: string;
  topic: string;
  archived?: boolean;
}

// Explicit convention first ("auto test room", "safe to ignore" — the words
// agents already put in throwaway topics), then the task-probe shape
// "T-32 rev3 credential smoke" / "T32 verifier probe" / "T-32 rev4 live check".
// Matching stays conservative: a real room must never be collapsed, so only
// topics that BOTH start with a task id AND end in probe vocabulary qualify
// for the second branch.
const EXPLICIT_TEST = /auto[- ]?test room|safe to ignore/i;
const TASK_PROBE = /^t-?\d+\b.*\b(smoke|probe|live check)\b/i;

export function isAutoTestRoom(topic: string): boolean {
  return EXPLICIT_TEST.test(topic) || TASK_PROBE.test(topic);
}

export interface RoomSections<T> {
  active: T[];
  ended: T[];
  activeTest: T[];
  endedTest: T[];
  archived: T[];
}

export function splitRooms<T extends SectionableRoom>(rooms: T[]): RoomSections<T> {
  const sections: RoomSections<T> = { active: [], ended: [], activeTest: [], endedTest: [], archived: [] };
  for (const room of rooms) {
    // Archived is orthogonal to status and wins: an archived room leaves the
    // Active/Ended views entirely and lives only in the Archived view.
    if (room.archived) { sections.archived.push(room); continue; }
    const test = isAutoTestRoom(room.topic);
    if (room.status === 'active') (test ? sections.activeTest : sections.active).push(room);
    else (test ? sections.endedTest : sections.ended).push(room);
  }
  return sections;
}
