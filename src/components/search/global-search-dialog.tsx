"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ListChecks, Send } from "lucide-react";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { globalSearch, type GlobalSearchResults } from "@/lib/actions/search";

const EMPTY: GlobalSearchResults = { positions: [], applications: [], companies: [] };

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResults>(EMPTY);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const r = await globalSearch(query);
      setResults(r);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  const hasResults =
    results.positions.length > 0 ||
    results.applications.length > 0 ||
    results.companies.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="全局搜索"
      description="搜索候选岗位、投递记录、企业名录"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="搜索候选岗位 / 投递记录 / 企业名录..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {query.trim().length < 2 ? (
            <CommandEmpty>输入至少 2 个字符开始搜索</CommandEmpty>
          ) : !hasResults ? (
            <CommandEmpty>没有找到匹配结果</CommandEmpty>
          ) : (
            <>
              {results.applications.length > 0 && (
                <CommandGroup heading="投递记录">
                  {results.applications.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`application-${r.id}`}
                      onSelect={() => go(r.href)}
                    >
                      <Send />
                      <span>{r.subtitle} · {r.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {results.positions.length > 0 && (
                <CommandGroup heading="候选岗位池">
                  {results.positions.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`position-${r.id}`}
                      onSelect={() => go(r.href)}
                    >
                      <ListChecks />
                      <span>{r.subtitle} · {r.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {results.companies.length > 0 && (
                <CommandGroup heading="企业名录">
                  {results.companies.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`company-${r.id}`}
                      onSelect={() => go(r.href)}
                    >
                      <Building2 />
                      <span>{r.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
