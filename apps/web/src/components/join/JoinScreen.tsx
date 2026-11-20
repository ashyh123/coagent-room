import React, { useEffect, useState } from "react";
import { MemberAvatar } from "@coagent/protocol";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { ThemeMode } from "../../hooks/useTheme.js";
import { SessionInfo } from "../../store/useRoom.js";
import { Button } from "../ui/Button.js";
import { INITIALS_TONES } from "../ui/Avatar.js";
import { AvatarPicker } from "./AvatarPicker.js";

interface JoinScreenProps {
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  onJoined: (session: SessionInfo) => void;
}

export function JoinScreen({ theme, onChangeTheme, onJoined }: JoinScreenProps) {
  const [roomInfo, setRoomInfo] = useState<{
    id: string;
    name: string;
    minConfirmations: number;
  } | null>(null);
  const [passcode, setPasscode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("passcode") ?? "";
  });
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<MemberAvatar>({
    kind: "initials",
    value: INITIALS_TONES[0],
  });
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
        body: JSON.stringify({ passcode, nickname, avatar }),
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
    <div
      className="relative flex min-h-full items-center justify-center p-5"
      style={{ background: "var(--bg)" }}
    >
      {/* Top-right theme switcher */}
      <div
        className="absolute top-4 right-4 inline-flex items-center rounded-full p-0.5"
        role="group"
        aria-label="深浅主题切换"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          aria-label="浅色模式"
          onClick={() => onChangeTheme("light")}
          className="flex h-7 w-7 items-center justify-center rounded-full cursor-pointer"
          style={
            theme === "light"
              ? { background: "var(--primary-bg)", color: "var(--primary-text)" }
              : { color: "var(--text-muted)" }
          }
        >
          <Sun size={14} />
        </button>
        <button
          type="button"
          aria-label="深色模式"
          onClick={() => onChangeTheme("dark")}
          className="flex h-7 w-7 items-center justify-center rounded-full cursor-pointer"
          style={
            theme === "dark"
              ? { background: "var(--primary-bg)", color: "var(--primary-text)" }
              : { color: "var(--text-muted)" }
          }
        >
          <Moon size={14} />
        </button>
      </div>

      <form
        className="join-card flex w-full max-w-[460px] flex-col gap-4 p-6"
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-popover)",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              background: "var(--primary-bg)",
              color: "var(--primary-text)",
            }}
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.9" />
              <circle cx="11.2" cy="11.2" r="1.4" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h1 className="m-0 text-[22px] leading-[1.2] font-semibold tracking-[-0.025em]">
              {roomInfo?.name ?? "coagent-room"}
            </h1>
            <p className="m-0 mt-1 text-[13px] leading-[1.45]" style={{ color: "var(--text-muted)" }}>
              本地优先多人 Agent 共创工作台 · 输入口令与昵称进房
            </p>
          </div>
        </div>

        {error && (
          <div
            className="error-banner rounded-[10px] px-3 py-2 text-[12px]"
            style={{
              background: "var(--sem-red-bg)",
              color: "var(--sem-red)",
              border: "1px solid rgba(239, 68, 68, 0.28)",
            }}
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              你的昵称
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="例如：Evan"
              required
              className="w-full px-3 py-2 text-[13px]"
              style={{
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-input)",
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
              房间口令
            </label>
            <input
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="查看 host 终端输出"
              required
              className="w-full px-3 py-2 text-[13px]"
              style={{
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-input)",
              }}
            />
          </div>
        </div>

        <AvatarPicker nickname={nickname} value={avatar} onChange={setAvatar} />

        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={loading || !nickname.trim() || !passcode.trim()}
          className="h-10 w-full rounded-[12px]"
        >
          {loading ? "正在进入..." : "进入共创房间"}
          <ArrowRight size={15} />
        </Button>
      </form>
    </div>
  );
}
