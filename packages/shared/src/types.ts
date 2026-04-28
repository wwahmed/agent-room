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
