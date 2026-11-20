import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className = "",
  children,
  ...props
}: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-50 backdrop-blur-[3px]"
        style={{ background: "var(--backdrop)" }}
      />
      <DialogPrimitive.Content
        className={`fixed top-1/2 left-1/2 z-50 w-[calc(100vw-32px)] max-w-[560px] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 focus:outline-none ${className}`}
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-popover)",
        }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="关闭弹窗"
          className="absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full cursor-pointer transition-opacity hover:opacity-75"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
          }}
        >
          <X size={14} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`mb-4 flex flex-col gap-1 pr-8 ${className}`} {...props} />;
}

export function DialogTitle({
  className = "",
  ...props
}: DialogPrimitive.DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      className={`m-0 text-[16px] leading-[1.35] font-semibold tracking-[-0.01em] ${className}`}
      {...props}
    />
  );
}

export function DialogDescription({
  className = "",
  ...props
}: DialogPrimitive.DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={`m-0 text-[13px] leading-[1.45] ${className}`}
      style={{ color: "var(--text-muted)" }}
      {...props}
    />
  );
}

export function DialogFooter({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`mt-5 flex items-center justify-end gap-2 ${className}`} {...props} />;
}
