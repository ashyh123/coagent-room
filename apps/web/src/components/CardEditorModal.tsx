import React, { useState } from "react";
import { CardSpec, computeCardVersionHash } from "@coagent/protocol";

interface CardEditorModalProps {
  initial?: CardSpec;
  titleText: string;
  onClose: () => void;
  onSave: (spec: CardSpec) => void;
}

export function CardEditorModal({ initial, titleText, onClose, onSave }: CardEditorModalProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [interfaceContract, setInterfaceContract] = useState(initial?.interfaceContract ?? "");
  const [globsText, setGlobsText] = useState(initial?.fileGlobs.join("\n") ?? "apps/server/src/**");
  const [criteriaText, setCriteriaText] = useState(initial?.acceptanceCriteria.join("\n") ?? "");

  const fileGlobs = globsText
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const acceptanceCriteria = criteriaText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const canSave = title.trim().length > 0 && goal.trim().length > 0 && fileGlobs.length > 0;
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
    onSave({ title, goal, interfaceContract, fileGlobs, acceptanceCriteria });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{titleText}</h2>
          <code>{previewHash}</code>
        </div>

        <div className="field">
          <label>卡片标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：实现房间口令鉴权" required />
        </div>

        <div className="field">
          <label>目标说明（Goal）</label>
          <textarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="明确要解决什么问题、做到什么程度"
            required
          />
        </div>

        <div className="field">
          <label>接口约定（Interface Contract）</label>
          <textarea
            rows={2}
            value={interfaceContract}
            onChange={(e) => setInterfaceContract(e.target.value)}
            placeholder="例如：POST /api/join { passcode, nickname } -> { memberId, sessionToken }"
          />
        </div>

        <div className="field">
          <label>锁定文件范围 fileGlobs（每行或逗号分隔，用于多 Agent 防撞车）</label>
          <textarea
            rows={2}
            value={globsText}
            onChange={(e) => setGlobsText(e.target.value)}
            placeholder="apps/server/src/**"
            required
          />
        </div>

        <div className="field">
          <label>验收标准（每行一条）</label>
          <textarea
            rows={2}
            value={criteriaText}
            onChange={(e) => setCriteriaText(e.target.value)}
            placeholder="pnpm verify 全绿"
          />
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            保存卡片草案
          </button>
        </div>
      </form>
    </div>
  );
}
