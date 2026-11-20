import React, { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui/Button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog.js";

interface AgentInviteModalProps {
  open: boolean;
  sessionToken: string;
  onClose: () => void;
}

export function AgentInviteModal({ open, sessionToken, onClose }: AgentInviteModalProps) {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInviteToken(null);
    setExpiresAt(null);
    setError(null);
    fetch("/api/agent-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.inviteToken) {
          setInviteToken(data.inviteToken);
          setExpiresAt(typeof data.expiresAt === "string" ? data.expiresAt : null);
        } else {
          setError(data.message ?? "生成邀请 Token 失败");
        }
      })
      .catch(() => setError("网络请求失败"));
  }, [open, sessionToken]);

  const roomUrl = window.location.origin;
  const cmd = inviteToken
    ? `npx coagent join ${roomUrl} --token ${inviteToken} --agent codex`
    : "正在生成一次性 Token...";

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const handleCopy = async () => {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>接入你的本地 Coding Agent</DialogTitle>
          <DialogDescription>
            在本地仓库目录运行下面命令，CLI 会拉起你已登录的官方 <code>codex app-server</code>{" "}
            并自动注入 6 个房间 MCP 工具（代码与订阅留在本机）。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            className="mb-3 rounded-[10px] px-3 py-2 text-[12px]"
            style={{
              background: "var(--sem-red-bg)",
              color: "var(--sem-red)",
              border: "1px solid rgba(239, 68, 68, 0.28)",
            }}
          >
            {error}
          </div>
        )}

        <div
          className="p-3 font-mono text-[12.5px] leading-[1.55] break-all"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-input)",
          }}
        >
          {cmd}
        </div>

        {inviteToken && (
          <p className="mt-2 text-[12px] leading-[1.5]" style={{ color: "var(--text-muted)" }}>
            这条命令里的 Token 只能用一次
            {expiryLabel ? `，${expiryLabel} 前有效` : "，30 分钟内有效"}
            。它等同于房间的接入凭证，请只在自己的终端里运行，不要发到房间里。每次打开本窗口都会生成新的 Token，之前没用过的 Token 到期后自动作废。
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            关闭
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={!inviteToken}
            onClick={handleCopy}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制接入命令"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
