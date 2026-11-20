import React, { useRef, useState } from "react";
import { MemberAvatar } from "@coagent/protocol";
import { Upload } from "lucide-react";
import { Avatar, INITIALS_TONES, PRESET_AVATARS } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";

interface AvatarPickerProps {
  nickname: string;
  value: MemberAvatar;
  onChange: (avatar: MemberAvatar) => void;
}

type PickerTab = "initials" | "preset" | "image";

async function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("不支持的图片格式"));
      img.onload = () => {
        const size = 96;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法初始化画布"));
          return;
        }
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function AvatarPicker({ nickname, value, onChange }: AvatarPickerProps) {
  const [tab, setTab] = useState<PickerTab>(value.kind);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const displayName = nickname.trim() || "你";

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      onChange({ kind: "image", value: dataUrl });
      setTab("image");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div
      className="flex flex-col gap-3 p-3"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-input)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
          头像与群聊预览
        </span>
        <div
          className="inline-flex items-center gap-0.5 p-0.5"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
          }}
        >
          {(
            [
              { id: "initials", label: "首字母" },
              { id: "preset", label: "符号" },
              { id: "image", label: "图片" },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium cursor-pointer"
                style={
                  active
                    ? { background: "var(--primary-bg)", color: "var(--primary-text)" }
                    : { background: "transparent", color: "var(--text-muted)" }
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode Selector */}
      {tab === "initials" && (
        <div className="flex items-center gap-2">
          {INITIALS_TONES.map((tone) => {
            const active = value.kind === "initials" && value.value === tone;
            return (
              <button
                key={tone}
                type="button"
                onClick={() => onChange({ kind: "initials", value: tone })}
                className="rounded-full p-0.5 cursor-pointer transition-transform"
                style={{
                  border: active ? "2px solid var(--text)" : "2px solid transparent",
                }}
                aria-label={`选择单色头像 ${tone}`}
              >
                <Avatar name={displayName} avatar={{ kind: "initials", value: tone }} size={28} />
              </button>
            );
          })}
        </div>
      )}

      {tab === "preset" && (
        <div className="grid grid-cols-8 gap-1.5">
          {PRESET_AVATARS.map((preset) => {
            const active = value.kind === "preset" && value.value === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                onClick={() => onChange({ kind: "preset", value: preset.id })}
                className="flex items-center justify-center rounded-full p-0.5 cursor-pointer"
                style={{
                  border: active ? "2px solid var(--text)" : "2px solid transparent",
                }}
              >
                <Avatar
                  name={displayName}
                  avatar={{ kind: "preset", value: preset.id }}
                  size={28}
                />
              </button>
            );
          })}
        </div>
      )}

      {tab === "image" && (
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={13} />
            选择本地图片
          </Button>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            自动裁剪为 96×96 黑白房间头像
          </span>
        </div>
      )}

      {uploadError && (
        <div className="text-[11px]" style={{ color: "var(--sem-red)" }}>
          {uploadError}
        </div>
      )}

      {/* Live Bubble Preview */}
      <div
        className="flex items-start justify-end gap-2 pt-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {displayName} · 刚刚
          </span>
          <div
            className="px-3 py-2 text-[13px] leading-[1.45]"
            style={{
              background: "var(--bubble-self)",
              color: "var(--bubble-self-text)",
              borderRadius: "20px",
              borderTopRightRadius: "6px",
            }}
          >
            大家好，我来负责联调与 Spec 确认。
          </div>
        </div>
        <Avatar name={displayName} avatar={value} size={28} />
      </div>
    </div>
  );
}
