import React from "react";
import {
  Bot,
  Box,
  Code2,
  Compass,
  Cpu,
  Feather,
  Layers,
  Sparkles,
  Terminal,
} from "lucide-react";
import { MemberAvatar } from "@coagent/protocol";
import { getInitials } from "../../utils/chat.js";

export const INITIALS_TONES = [
  "#18181b",
  "#27272a",
  "#3f3f46",
  "#52525b",
  "#71717a",
] as const;

export const PRESET_AVATARS = [
  { id: "sparkles", label: "灵感", Icon: Sparkles },
  { id: "terminal", label: "终端", Icon: Terminal },
  { id: "code", label: "代码", Icon: Code2 },
  { id: "cpu", label: "算力", Icon: Cpu },
  { id: "layers", label: "架构", Icon: Layers },
  { id: "compass", label: "导航", Icon: Compass },
  { id: "box", label: "模块", Icon: Box },
  { id: "feather", label: "文档", Icon: Feather },
] as const;

export type PresetAvatarId = (typeof PRESET_AVATARS)[number]["id"];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface AvatarProps {
  name: string;
  avatar?: MemberAvatar;
  isAgent?: boolean;
  showAgentBadge?: boolean;
  size?: 20 | 24 | 28 | 36 | 44;
  className?: string;
  style?: React.CSSProperties;
}

export function Avatar({
  name,
  avatar,
  isAgent = false,
  showAgentBadge = false,
  size = 28,
  className = "",
  style,
}: AvatarProps) {
  const iconSize = Math.max(11, Math.round(size * 0.5));
  const badgeSize = Math.max(12, Math.round(size * 0.44));
  const fontSize = Math.max(9, Math.round(size * 0.4));

  const renderInner = () => {
    if (avatar?.kind === "image" && avatar.value) {
      return (
        <img
          src={avatar.value}
          alt={name}
          className="h-full w-full rounded-full object-cover"
        />
      );
    }

    if (avatar?.kind === "preset") {
      const preset = PRESET_AVATARS.find((p) => p.id === avatar.value);
      const Icon = preset?.Icon ?? Sparkles;
      return (
        <span
          className="flex h-full w-full items-center justify-center rounded-full"
          style={{
            background: "var(--surface-2)",
            color: "var(--text)",
          }}
        >
          <Icon size={iconSize} strokeWidth={1.8} />
        </span>
      );
    }

    if (isAgent && !avatar) {
      return (
        <span
          className="flex h-full w-full items-center justify-center rounded-full"
          style={{
            background: "var(--surface-2)",
            color: "var(--text)",
          }}
        >
          <Bot size={iconSize} strokeWidth={1.8} />
        </span>
      );
    }

    const bg =
      avatar?.kind === "initials" && /^#[0-9a-fA-F]{3,8}$/.test(avatar.value)
        ? avatar.value
        : INITIALS_TONES[hashName(name) % INITIALS_TONES.length];

    return (
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-semibold tracking-tight select-none"
        style={{
          background: bg,
          color: "#fafafa",
          fontSize,
        }}
      >
        {getInitials(name)}
      </span>
    );
  };

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        border: "1px solid var(--border)",
        ...style,
      }}
      title={name}
    >
      {renderInner()}
      {showAgentBadge && isAgent && (
        <span
          className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full"
          style={{
            width: badgeSize,
            height: badgeSize,
            background: "var(--primary-bg)",
            color: "var(--primary-text)",
            border: "1.5px solid var(--bg)",
          }}
        >
          <Bot size={Math.max(8, Math.round(badgeSize * 0.65))} strokeWidth={2.2} />
        </span>
      )}
    </span>
  );
}
