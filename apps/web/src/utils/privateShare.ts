import { redactRoomSecrets } from "@coagent/protocol";

const MAX_SHARE_LENGTH = 3900;

// Older private answers started with "[私密上下文分析 · 仅X可见] 针对你在…的提问：「…」".
// Once shared, that label is false and the question echo duplicates our own header.
const LEGACY_LABEL = /^\s*\[私密上下文分析[^\]]*\]\s*/;
const QUESTION_ECHO = /^\s*针对你在.*的提问：「.*」\s*$/;

function cleanAnswer(answer: string): string {
  return answer
    .replace(LEGACY_LABEL, "")
    .split("\n")
    .filter((line) => !QUESTION_ECHO.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatPrivateShareText(item: {
  question: string;
  answer: string;
  quote?: string;
}): string {
  const lines: string[] = [];
  if (item.quote) {
    lines.push(`> ${item.quote.replace(/\s+/g, " ").slice(0, 240)}`);
  }
  lines.push(`分享自私有参谋 · 问：${item.question.trim()}`);
  const answer = cleanAnswer(item.answer);
  if (answer) lines.push(answer);
  return redactRoomSecrets(lines.join("\n")).slice(0, MAX_SHARE_LENGTH);
}
