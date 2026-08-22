"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useThemeSettings } from "@/components/theme-provider";
import { PALETTES, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Laptop },
];

export function AppearanceForm() {
  const { mode, palette, setMode, setPalette } = useThemeSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">模式</p>
          <div className="flex gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <Button
                  key={m.id}
                  type="button"
                  variant={mode === m.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode(m.id)}
                >
                  <Icon />
                  {m.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">配色</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPalette(p.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
                  palette === p.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                )}
              >
                <span
                  className="size-6 shrink-0 rounded-full border"
                  style={{ backgroundColor: p.swatch }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
                {palette === p.id && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
