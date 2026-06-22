"use client";

import type React from "react";
import { AlertTriangle, CheckCircle2, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

export function ActionPreviewDialog({
  action,
  title,
  description,
  disabled,
  disabledLabel = "Real support coming",
  safetyNote = "RangeGuard will not execute this automatically. Review pool state, quotes, slippage, and wallet prompts before signing.",
  onPrimaryAction,
  preview,
  trigger,
}: {
  action: string;
  title: string;
  description: string;
  disabled?: boolean;
  disabledLabel?: string;
  safetyNote?: string;
  onPrimaryAction?: () => void;
  preview: Array<{ label: string; value: string }>;
  trigger: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-[#d9e1ec] bg-[#f8fafc] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#101828]">
            <WalletCards className="h-4 w-4 text-[#006d77]" />
            Transaction preview
          </div>
          <div className="space-y-3">
            {preview.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-[#667085]">{item.label}</span>
                <span className="text-right font-medium text-[#101828]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border border-[#fde9a2] bg-[#fff9e8] p-4 text-sm leading-6 text-[#7a4e00]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{safetyNote}</p>
        </div>
        <Separator />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary">Keep monitoring</Button>
          </DialogClose>
          <Button disabled={disabled} onClick={onPrimaryAction}>
            <CheckCircle2 className="h-4 w-4" />
            {disabled ? disabledLabel : action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
