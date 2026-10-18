import { Fragment, type ReactNode } from "react";
import Link from "next/link";

// The small Markdown subset 小欧 writes (headings, lists, **bold**, *italic*,
// `code`, --- rules, links),
// built as React elements: model output is never injected as HTML.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)）\]，。、]+)|(?<![*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])|`([^`\n]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (match[1]) nodes.push(<strong key={key}>{match[1]}</strong>);
    else if (match[5]) nodes.push(<em key={key} className="text-muted-foreground">{match[5]}</em>);
    else if (match[6]) nodes.push(<code key={key} className="rounded bg-muted px-1 text-[0.9em]">{match[6]}</code>);
    else {
      const label = match[2] ?? match[4];
      const href = match[3] ?? match[4];
      if (href.startsWith("/") && !href.startsWith("//")) nodes.push(<Link key={key} href={href} className="text-primary underline">{label}</Link>);
      else if (/^https?:\/\//i.test(href)) nodes.push(<a key={key} href={href} target="_blank" rel="noreferrer" className="break-all text-primary underline">{label}</a>);
      else nodes.push(match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item, `li${blocks.length}-${index}`)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={blocks.length} className="list-disc space-y-0.5 pl-5">{items}</ul>);
    list = null;
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.、)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={blocks.length} className="my-2 border-border/60" />); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) blocks.push(<p key={blocks.length} className="pt-1 font-semibold">{inline(heading[1], `h${blocks.length}`)}</p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line, `p${blocks.length}`)}</p>);
  }
  flush();
  return <div className={`space-y-1.5 break-words ${className ?? ""}`}>{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
