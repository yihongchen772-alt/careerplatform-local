"use client";

import { Button } from "@/components/ui/button";
import { PositionFormDialog } from "@/components/pool/position-form-dialog";

export function AddPositionDialog() {
  return (
    <PositionFormDialog mode="create" trigger={<Button>+ 添加候选岗位</Button>} />
  );
}
