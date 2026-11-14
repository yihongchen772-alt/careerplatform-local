"use client";

import { useState } from "react";

export type BatchResumeOption = { id: string; name: string; isDefault?: boolean };
export type BatchVariantOption = { id: string; name: string; resumeVersionId: string | null };

export function useBatchProfileSelection(
  resumeVersions: BatchResumeOption[] = [],
  profileVariants: BatchVariantOption[] = [],
  defaultResumeVersionId?: string | null
) {
  const initialResume =
    defaultResumeVersionId ??
    resumeVersions.find((r) => r.isDefault)?.id ??
    resumeVersions[0]?.id ??
    "";
  const [resumeVersionId, setResumeVersionId] = useState(initialResume);
  const [variantId, setVariantId] = useState("");
  const linked = profileVariants.find((v) => v.resumeVersionId && v.resumeVersionId === resumeVersionId);
  return {
    resumeVersionId,
    setResumeVersionId,
    variantId,
    setVariantId,
    linkedVariantName: linked?.name ?? null,
    launchOptions: {
      resumeVersionId: resumeVersionId || undefined,
      variantId: variantId || undefined,
    },
  };
}

export function BatchProfileSelect({
  resumeVersions,
  profileVariants,
  resumeVersionId,
  onResumeChange,
  variantId,
  onVariantChange,
  linkedVariantName,
}: {
  resumeVersions: BatchResumeOption[];
  profileVariants: BatchVariantOption[];
  resumeVersionId: string;
  onResumeChange: (value: string) => void;
  variantId: string;
  onVariantChange: (value: string) => void;
  linkedVariantName: string | null;
}) {
  if (!resumeVersions.length && !profileVariants.length) return null;
  const selectCls =
    "h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-ring";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {resumeVersions.length > 0 && (
        <select
          aria-label="批量投递使用简历"
          value={resumeVersionId || "none"}
          onChange={(e) => onResumeChange(e.target.value === "none" ? "" : e.target.value)}
          className={selectCls}
        >
          {resumeVersions.map((r) => (
            <option key={r.id} value={r.id}>
              简历：{r.name}
              {r.isDefault ? "（默认）" : ""}
            </option>
          ))}
          <option value="none">不用简历，只填资料</option>
        </select>
      )}
      {profileVariants.length > 0 && (
        <select
          aria-label="批量投递使用资料方案"
          value={variantId || "auto"}
          onChange={(e) => onVariantChange(e.target.value === "auto" ? "" : e.target.value)}
          className={selectCls}
        >
          <option value="auto">方案：跟随简历（{linkedVariantName ?? "默认资料"}）</option>
          <option value="default">方案：默认资料</option>
          {profileVariants.map((v) => (
            <option key={v.id} value={v.id}>
              方案：{v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
