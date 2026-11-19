import React, { useEffect, useState } from "react";

interface AgentInviteModalProps {
  sessionToken: string;
  onClose: () => void;
}

export function AgentInviteModal({ sessionToken, onClose }: AgentInviteModalProps) {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/agent-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.inviteToken) {
          setInviteToken(data.inviteToken);
        } else {
          setError(data.message ?? "生成邀请 Token 失败");
        }
      })
      .catch(() => setError("网络请求失败"));
  }, [sessionToken]);

  const roomUrl = window.location.origin;
  const cmd = inviteToken
    ? `npx coagent join ${roomUrl} --token ${inviteToken} --agent codex`
    : "正在生成一次性 Token...";

  const handleCopy = async () => {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback for non-HTTPS LAN clipboard restrictions
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>接入你的本地 Coding Agent</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          在你本地项目仓库目录运行下面命令，CLI 会驱动你已登录的官方 <code>codex app-server</code> 并自动注入 6 个房间 MCP 工具（订阅与源码留在本机）：
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div className="cmd-box">{cmd}</div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="primary" disabled={!inviteToken} onClick={handleCopy}>
            {copied ? "已复制" : "复制接入命令"}
          </button>
        </div>
      </div>
    </div>
  );
}
