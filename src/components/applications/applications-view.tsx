"use client";

import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ApplicationsTable,
  type ApplicationRow,
} from "@/components/applications/applications-table";
import { ApplicationsBoard } from "@/components/applications/applications-board";

/**
 * Board and table over the same data. The board answers "where am I stuck",
 * the table answers "what did I apply to and when" — both are worth having,
 * and neither replaces the other, so this is a toggle rather than a
 * migration away from the table.
 */
export function ApplicationsView({ applications }: { applications: ApplicationRow[] }) {
  const [view, setView] = useState<"board" | "table">("board");

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Button
          type="button"
          variant={view === "board" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("board")}
        >
          <LayoutGrid className="mr-1.5 size-4" />
          看板
        </Button>
        <Button
          type="button"
          variant={view === "table" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("table")}
        >
          <List className="mr-1.5 size-4" />
          列表
        </Button>
      </div>

      {view === "board" ? (
        <ApplicationsBoard
          applications={applications.map((a) => ({
            id: a.id,
            companyName: a.company.name,
            title: a.title,
            currentStage: a.currentStage,
            appliedDate: a.appliedDate,
            currentStageDate: a.currentStageDate,
          }))}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ApplicationsTable applications={applications} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
