export type ClientKind = 'web' | 'cc';

export interface Participant {
  name: string;
  role: string;          // empty string if not provided
  color: string;         // hex
  initials: string;      // 2 uppercase letters
  client: ClientKind;
  joinedAt: number;      // epoch ms
  lastSeenAt: number;    // epoch ms
  listenUntil?: number;  // epoch ms — set by room_listen, expires naturally
  // Host approval gate. Undefined for participants joined before this field
  // existed (treated as legacy-approved). New joiners default to false until
  // the host (createdBy) approves them via approveParticipant.
  canSpeak?: boolean;
}

export interface Room {
  code: string;
  topic: string;
  createdAt: number;
  createdBy: string;
  status: 'active' | 'ended';
  endedAt?: number;      // epoch ms — set when meeting ends
  version: number;       // for optimistic concurrency
  participants: Participant[];
  // Hash of the secret returned to the host on createRoom. Anyone trying to
  // join with name === createdBy must present the matching secret, otherwise
  // they get HostNameTakenError. This stops trivial impersonation by anyone
  // who only knows the room code.
  hostKeyHash?: string;
}

export type MessageKind = 'msg' | 'sys';

export interface Message {
  id: number;            // epoch ms at creation
  type: MessageKind;
  name: string;
  initials: string;
  color: string;
  role: string;
  text: string;
  client: ClientKind;
  time: number;
}

export type ArtifactKind = 'decision' | 'todo' | 'status' | 'result';

export interface RoomArtifact {
  id: string;
  kind: ArtifactKind;
  text: string;
  sourceMessageId: number;
  author: string;
  time: number;
}

export interface ReportParticipant {
  name: string;
  role: string;
  client: ClientKind;
}

export interface RoomReport {
  code: string;
  topic: string;
  createdAt: number;
  exportedAt: number;
  participants: ReportParticipant[];
  messageCount: number;
  summary: string;
  highlights: string[];
  decisions: string[];
  actionItems: string[];
  artifacts: RoomArtifact[];
  transcript: Message[];
}
