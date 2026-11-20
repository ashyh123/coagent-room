import { describe, expect, it } from "vitest";
import { Member } from "@coagent/protocol";
import { isCompactViewport, resolveViewMode } from "../src/utils/layout.js";
import { buildMemberLabels } from "../src/utils/members.js";
import { formatPrivateShareText } from "../src/utils/privateShare.js";

function human(id: string, name: string, online = true): Member {
  return { id, name, kind: "human", online } as Member;
}

describe("formatPrivateShareText (private answer -> room message)", () => {
  it("drops legacy visibility labels and the redundant question echo", () => {
    const text = formatPrivateShareText({
      question: "你好",
      answer:
        "[私密上下文分析 · 仅Evan可见] 针对你在房间「Coagent Demo」的提问：「你好」\n\n相关卡片：当前房间暂无共识卡片。",
    });
    expect(text).not.toContain("可见");
    expect(text).not.toContain("针对你在");
    expect(text).toBe("分享自私有参谋 · 问：你好\n相关卡片：当前房间暂无共识卡片。");
  });

  it("keeps a short quote and masks credentials", () => {
    const text = formatPrivateShareText({
      question: "怎么接入？",
      quote: "npx coagent join --token inv_68993fb279db039e31e89c34",
      answer: "运行上面的命令即可。",
    });
    expect(text).toContain("> npx coagent join --token inv_6899••••");
    expect(text).not.toContain("inv_68993fb279db039e31e89c34");
  });
});

describe("buildMemberLabels (tell same-name members apart)", () => {
  it("leaves unique names untouched", () => {
    const labels = buildMemberLabels([human("hum_a", "Evan"), human("hum_b", "Lin")]);
    expect(labels).toEqual({ hum_a: "Evan", hum_b: "Lin" });
  });

  it("numbers duplicates by join order, case- and space-insensitively", () => {
    const labels = buildMemberLabels([
      human("hum_a", "Evan", false),
      human("hum_b", "evan "),
      human("hum_c", "Evan"),
      human("hum_d", "Lin"),
    ]);
    expect(labels).toEqual({
      hum_a: "Evan",
      hum_b: "evan · 2",
      hum_c: "Evan · 3",
      hum_d: "Lin",
    });
  });
});

describe("compact (phone) layout", () => {
  it("treats widths below 768px as compact", () => {
    expect(isCompactViewport(390)).toBe(true);
    expect(isCompactViewport(767)).toBe(true);
    expect(isCompactViewport(768)).toBe(false);
  });

  it("falls back from split to chat on compact screens only", () => {
    expect(resolveViewMode("split", true)).toBe("chat");
    expect(resolveViewMode("board", true)).toBe("board");
    expect(resolveViewMode("chat", true)).toBe("chat");
    expect(resolveViewMode("split", false)).toBe("split");
  });
});
