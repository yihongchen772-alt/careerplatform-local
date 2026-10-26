"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Sets the city of the selected 投递 in one go (岗位 that never said where they are). */
export function BulkCityDialog({ count, suggestions, busy, onSubmit }: { count: number; suggestions: string[]; busy: boolean; onSubmit: (city: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");

  async function submit(value: string) {
    if (await onSubmit(value.trim())) {
      setOpen(false);
      setCity("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" disabled={busy} className="gap-1" />}>
        <MapPin className="size-3.5" />
        设置城市
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>给选中的 {count} 条投递设置城市</DialogTitle>
          <DialogDescription>多个城市用顿号隔开，例如「北京、深圳」。留空则恢复为按岗位信息自动识别。</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit(city); }} className="space-y-3">
          <Input autoFocus value={city} onChange={(event) => setCity(event.target.value)} placeholder="例如：上海" maxLength={40} aria-label="城市" />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="常用城市">
              {suggestions.map((name) => (
                <button key={name} type="button" onClick={() => void submit(name)} className="h-7 rounded-full border border-border/70 px-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">{name}</button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={busy}>{city.trim() ? "设置" : "恢复自动识别"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
