import React, { useEffect, useState } from "react";
import { SessionInfo } from "../store/useRoom.js";

interface JoinScreenProps {
  onJoined: (session: SessionInfo) => void;
}

export function JoinScreen({ onJoined }: JoinScreenProps) {
  const [roomInfo, setRoomInfo] = useState<{ id: string; name: string; minConfirmations: number } | null>(
    null,
  );
  const [passcode, setPasscode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("passcode") ?? "";
  });
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/room")
      .then((r) => r.json())
      .then((data) => setRoomInfo(data))
      .catch(() => setError("无法连接到房间服务，请确认 coagent host 已启动"));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, nickname }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "进入房间失败");
        return;
      }
      onJoined({
        roomId: data.roomId,
        roomName: data.roomName,
        memberId: data.memberId,
        sessionToken: data.sessionToken,
        minConfirmations: roomInfo?.minConfirmations ?? 1,
      });
    } catch {
      setError("网络请求失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="join-shell">
      <form className="join-card" onSubmit={handleSubmit}>
        <h1>{roomInfo?.name ?? "coagent-room"}</h1>
        <p>本地优先多人 Agent 共创工作台 · 输入房间口令与昵称即可进房</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label>你的昵称</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="例如：Evan"
            required
          />
        </div>

        <div className="field">
          <label>房间口令</label>
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="查看 coagent host 终端输出"
            required
          />
        </div>

        <button type="submit" className="primary" disabled={loading || !nickname.trim() || !passcode.trim()}>
          {loading ? "正在进入..." : "进入共创房间"}
        </button>
      </form>
    </div>
  );
}
