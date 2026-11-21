"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/copy-text";

// Safe pure-React Markdown renderer for 小欧: headings, lists, blockquotes,
// fenced code blocks (with copy), GFM tables, **bold**, *italic*, `code`,
// --- rules, and links. Model output is never injected as HTML.

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-border/70 bg-background/85 text-xs">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{lang || "code"}</span>
        <button
          type="button"
          onClick={() => {
            void copyText(code)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function inline(text: string, keyPrefix: string, onNavigate?: () => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)）\]，。、]+)|(?<![*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])|`([^`\n]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (match[1]) nodes.push(<strong key={key}>{match[1]}</strong>);
    else if (match[5]) nodes.push(<em key={key} className="text-muted-foreground">{match[5]}</em>);
    else if (match[6]) {
      nodes.push(
        <code key={key} className="rounded border border-border/60 bg-background/80 px-1 py-0.5 font-mono text-[0.86em]">
          {match[6]}
        </code>
      );
    } else {
      const label = match[2] ?? match[4];
      const href = match[3] ?? match[4];
      if (href.startsWith("/") && !href.startsWith("//")) {
        nodes.push(
          <Link key={key} href={href} onClick={onNavigate} className="text-primary underline">
            {label}
          </Link>
        );
      } else if (/^https?:\/\//i.test(href)) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noreferrer" className="break-all text-primary underline">
            {label}
          </a>
        );
      } else {
        nodes.push(match[0]);
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  return /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed);
}

export function MarkdownText({
  text,
  className,
  onNavigate,
}: {
  text: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quoteLines: string[] = [];

  const flushList = () => {
    if (!list) return;
    const idx = blocks.length;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `li${idx}-${i}`, onNavigate)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={idx} className="list-decimal space-y-0.5 pl-5">{items}</ol>
      ) : (
        <ul key={idx} className="list-disc space-y-0.5 pl-5">{items}</ul>
      )
    );
    list = null;
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const idx = blocks.length;
    const joined = quoteLines.join("\n");
    blocks.push(
      <blockquote key={idx} className="border-l-2 border-primary/45 pl-3 text-muted-foreground">
        {inline(joined, `bq${idx}`, onNavigate)}
      </blockquote>
    );
    quoteLines = [];
  };

  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks ```lang ... ```
    const fence = /^\s*```([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushList();
      flushQuote();
      const lang = fence[1] || "";
      const codeLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (/^\s*```\s*$/.test(lines[j])) break;
        codeLines.push(lines[j]);
      }
      blocks.push(<CodeBlock key={blocks.length} lang={lang} code={codeLines.join("\n")} />);
      i = j;
      continue;
    }

    // GFM Tables: header row + separator row + 0..N body rows
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      flushQuote();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      const idx = blocks.length;
      blocks.push(
        <div key={idx} className="my-1.5 overflow-x-auto rounded-lg border border-border/70 bg-background/70">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted/70">
              <tr>
                {headers.map((h, col) => (
                  <th key={col} className="border-b border-border/60 px-2.5 py-1.5 font-semibold text-foreground">
                    {inline(h, `th${idx}-${col}`, onNavigate)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-b border-border/40 last:border-0">
                  {headers.map((_, col) => (
                    <td key={col} className="px-2.5 py-1.5 align-top">
                      {inline(row[col] ?? "", `td${idx}-${r}-${col}`, onNavigate)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j - 1;
      continue;
    }

    // Blockquotes
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    flushQuote();

    // Lists
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.、)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={blocks.length} className="my-2 border-border/60" />);
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<p key={blocks.length} className="pt-1 font-semibold">{inline(heading[1], `h${blocks.length}`, onNavigate)}</p>);
    } else if (line.trim()) {
      blocks.push(<p key={blocks.length}>{inline(line, `p${blocks.length}`, onNavigate)}</p>);
    }
  }
  flushList();
  flushQuote();

  return <div className={`space-y-1.5 break-words ${className ?? ""}`}>{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
