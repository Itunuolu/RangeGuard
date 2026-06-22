import type React from "react";

export function PageHeader({
  title,
  eyebrow,
  description,
  action,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#006d77]">{eyebrow}</p> : null}
        <h1 className="text-3xl font-semibold text-[#101828]">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
