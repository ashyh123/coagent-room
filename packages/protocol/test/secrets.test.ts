import { describe, expect, it } from "vitest";
import { containsRoomSecret, redactRoomSecrets } from "../src/index.js";

const INVITE = "inv_68993fb279db039e31e89c34";
const SESSION = "sess_0123456789abcdef0123456789abcdef";
const AGENT_SESSION = "agtsess_fedcba9876543210fedcba9876543210";

describe("room secret redaction", () => {
  it("detects invite, human session, and agent session tokens", () => {
    expect(containsRoomSecret(`npx coagent join http://h:5173 --token ${INVITE} --agent codex`)).toBe(true);
    expect(containsRoomSecret(`Bearer ${SESSION}`)).toBe(true);
    expect(containsRoomSecret(AGENT_SESSION)).toBe(true);
  });

  it("ignores ordinary text and non-secret ids", () => {
    expect(containsRoomSecret("你好，这是一个coagent的测试")).toBe(false);
    expect(containsRoomSecret("msg_0123456789ab hum_0123456789 inv_short")).toBe(false);
  });

  it("keeps the prefix and first 4 chars so people can still tell tokens apart", () => {
    const out = redactRoomSecrets(`--token ${INVITE} --agent codex`);
    expect(out).toBe("--token inv_6899•••• --agent codex");
    expect(out).not.toContain(INVITE);
  });

  it("redacts every occurrence and is idempotent", () => {
    const once = redactRoomSecrets(`${INVITE} and ${AGENT_SESSION}`);
    expect(once).toBe("inv_6899•••• and agtsess_fedc••••");
    expect(redactRoomSecrets(once)).toBe(once);
    expect(containsRoomSecret(once)).toBe(false);
  });
});
