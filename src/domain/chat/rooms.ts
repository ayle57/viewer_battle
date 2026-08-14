import type { ChatChannel } from "./schemas";

/** Socket.IO room name for a given session + chat channel. */
export function chatRoomName(sessionId: string, channel: ChatChannel): string {
  return `session:${sessionId}:chat:${channel.toLowerCase()}`;
}
