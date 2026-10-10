import { highlightParts, type Range } from "@/lib/application-search";

/** `text` with the stretches a search matched marked. */
export function Highlight({ text, ranges }: { text: string; ranges?: Range[] }) {
  if (!ranges?.length) return <>{text}</>;
  return (
    <>
      {highlightParts(text, ranges).map((part, index) =>
        part.hit ? (
          <mark key={index} className="rounded-[3px] bg-primary/15 px-px text-inherit">{part.text}</mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  );
}
