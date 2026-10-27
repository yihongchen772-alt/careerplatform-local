/**
 * The readable text of an HTML mail. Recruiting systems (Moka, 华为, 飞书…)
 * send HTML only, or a plain part that is empty or a one-line stub, and the
 * parser then hands back no body at all: the reader — AI or rule — was left
 * with the subject line and never saw 「考试时间：…」. Links are kept next to
 * their text, since a 会议 / 测评 address is often only in the href.
 */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—", ndash: "–", middot: "·", bull: "•" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  const source = html.slice(0, 800_000)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ");
  const text = source
    // 「请点击进入链接」 + its address, so the address survives.
    .replace(/<a\b[^>]*?href\s*=\s*["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      // Tracking and unsubscribe links are noise.
      return /unsubscribe|sctrack|track\.|退订/i.test(href) ? ` ${label} ` : ` ${label} ${decode(href)} `;
    })
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decode(text)
    .replace(/[ \t 　]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A stub like 「请使用 HTML 查看」 is not a body. */
const STUB = 200;

/** The body to read: the plain part when it says something, else the HTML's text. */
export function bodyTextOf(plain: string | null | undefined, html: string | false | null | undefined): string {
  const text = (plain ?? "").trim();
  if (text.length >= STUB || !html) return text;
  const fromHtml = htmlToText(html);
  return fromHtml.length > text.length ? fromHtml : text;
}
