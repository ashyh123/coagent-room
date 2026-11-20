import React, { useEffect, useState } from "react";
import { CardSpec, computeCardVersionHash } from "@coagent/protocol";
import { Button } from "../ui/Button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog.js";

interface CardEditorModalProps {
  open: boolean;
  initial?: Partial<CardSpec>;
  titleText: string;
  onClose: () => void;
  onSave: (spec: CardSpec) => void;
}

export function CardEditorModal({
  open,
  initial,
  titleText,
  onClose,
  onSave,
}: CardEditorModalProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [interfaceContract, setInterfaceContract] = useState(
    initial?.interfaceContract ?? "",
  );
  const [globsText, setGlobsText] = useState(
    initial?.fileGlobs && initial.fileGlobs.length > 0
      ? initial.fileGlobs.join("\n")
      : "apps/server/src/**",
  );
  const [criteriaText, setCriteriaText] = useState(
    initial?.acceptanceCriteria?.join("\n") ?? "",
  );

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setGoal(initial?.goal ?? "");
    setInterfaceContract(initial?.interfaceContract ?? "");
    setGlobsText(
      initial?.fileGlobs && initial.fileGlobs.length > 0
        ? initial.fileGlobs.join("\n")
        : "apps/server/src/**",
    );
    setCriteriaText(initial?.acceptanceCriteria?.join("\n") ?? "");
  }, [open, initial]);

  const fileGlobs = globsText
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const acceptanceCriteria = criteriaText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const canSave =
    title.trim().length > 0 && goal.trim().length > 0 && fileGlobs.length > 0;
  const previewHash = canSave
    ? computeCardVersionHash({
        title,
        goal,
        interfaceContract,
        fileGlobs,
        acceptanceCriteria,
      })
    : "—";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave({
      title: title.trim(),
      goal: goal.trim(),
      interfaceContract: interfaceContract.trim(),
      fileGlobs,
      acceptanceCriteria,
    });
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-input)",
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{titleText}</DialogTitle>
            <code
              className="rounded-[6px] px-2 py-0.5 text-[11px]"
              style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
            >
              {previewHash}
            </code>
          </div>
          <DialogDescription>
            用结构化 Spec 锁定目标与 fileGlobs，多 Agent 认领时由宿主自动防撞车。
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              卡片标题
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：实现房间口令鉴权"
              maxLength={120}
              required
              className="w-full px-3 py-2 text-[13px]"
              style={inputStyle}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              目标说明（Goal）
            </label>
            <textarea
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="明确要解决什么问题、做到什么程度"
              required
              className="min-h-[68px] w-full resize-y px-3 py-2 text-[13px]"
              style={inputStyle}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              接口约定（Interface Contract）
            </label>
            <textarea
              rows={2}
              value={interfaceContract}
              onChange={(e) => setInterfaceContract(e.target.value)}
              placeholder="例如：POST /api/join { passcode, nickname } -> { memberId, sessionToken }"
              className="min-h-[54px] w-full resize-y px-3 py-2 font-mono text-[12.5px]"
              style={inputStyle}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              锁定文件范围 fileGlobs（每行或逗号分隔）
            </label>
            <textarea
              rows={2}
              value={globsText}
              onChange={(e) => setGlobsText(e.target.value)}
              placeholder="apps/server/src/**"
              required
              className="min-h-[54px] w-full resize-y px-3 py-2 font-mono text-[12.5px]"
              style={inputStyle}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              验收标准（每行一条）
            </label>
            <textarea
              rows={2}
              value={criteriaText}
              onChange={(e) => setCriteriaText(e.target.value)}
              placeholder="pnpm verify 全绿"
              className="min-h-[54px] w-full resize-y px-3 py-2 text-[13px]"
              style={inputStyle}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="md" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={!canSave}>
              保存卡片草案
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
