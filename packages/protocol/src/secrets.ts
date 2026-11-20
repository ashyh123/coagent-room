// Room credentials (invite tokens, human/agent session tokens) are `${prefix}_${hex}`.
// They must never be shown in full once they land in shared text such as room messages.
const ROOM_SECRET_PATTERN = /\b(inv|sess|agtsess)_([0-9a-f]{16,})\b/gi;
const VISIBLE_CHARS = 4;

export function containsRoomSecret(text: string): boolean {
  ROOM_SECRET_PATTERN.lastIndex = 0;
  return ROOM_SECRET_PATTERN.test(text);
}

export function redactRoomSecrets(text: string): string {
  return text.replace(
    ROOM_SECRET_PATTERN,
    (_match, prefix: string, body: string) => `${prefix}_${body.slice(0, VISIBLE_CHARS)}••••`,
  );
}
