import React from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] leading-[1.4] rounded-[8px] gap-1.5",
  md: "h-9 px-3.5 text-[13px] leading-[1.45] rounded-[10px] gap-2",
  icon: "h-8 w-8 p-0 rounded-full justify-center",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", style, disabled, children, ...props }, ref) => {
    const variantStyle: React.CSSProperties =
      variant === "primary"
        ? {
            background: "var(--primary-bg)",
            color: "var(--primary-text)",
            border: "1px solid var(--primary-bg)",
          }
        : variant === "outline"
          ? {
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border-strong)",
            }
          : variant === "ghost"
            ? {
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid transparent",
              }
            : variant === "danger"
              ? {
                  background: "var(--sem-red-bg)",
                  color: "var(--sem-red)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }
              : {
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`inline-flex items-center justify-center font-medium whitespace-nowrap transition-opacity duration-150 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed hover:opacity-88 ${SIZE_CLASSES[size]} ${className}`}
        style={{ ...variantStyle, ...style }}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
