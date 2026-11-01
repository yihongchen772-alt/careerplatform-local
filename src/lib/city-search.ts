import { renderPageText } from "@/lib/render-bridge-client";

/**
 * A web search the app runs itself for where a job is: a results page,
 * rendered in a session of its own and read as text. Shared by the 投递
 * page's automatic lookup and 小欧's research_cities tool. Bing first; when
 * an engine asks for a check (never answered) it rests for a while and the
 * next one is used. (Baidu shows a hidden window no results at all.)
 */

const SEARCH_TEXT = 2500;
export const SEARCH_GAP = 1500;
const BLOCK_PAUSE = 30 * 60_000;
const CHALLENGE = /最后一步|请解决以下难题|captcha|verify you are human|unusual traffic|验证码|异常访问|访问异常|安全验证|人机验证/i;

const ENGINES = [
  { name: "Bing", url: (q: string) => `https://www.bing.com/search?q=${q}`, blockedUntil: 0 },
  { name: "搜狗", url: (q: string) => `https://www.sogou.com/web?query=${q}`, blockedUntil: 0 },
  { name: "360", url: (q: string) => `https://www.so.com/s?q=${q}`, blockedUntil: 0 },
];

export type SearchResult = { text: string } | { blocked: true };

/** Every engine is resting after a check. */
export function searchBlocked(): boolean {
  return ENGINES.every((engine) => engine.blockedUntil > Date.now());
}

/**
 * A results page's text from the first engine that answers. An almost empty
 * page means the results had not come in, so it is asked once more.
 */
export async function searchResults(query: string, max = SEARCH_TEXT): Promise<SearchResult> {
  const q = encodeURIComponent(query);
  for (const engine of ENGINES) {
    if (engine.blockedUntil > Date.now()) continue;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = (await renderPageText(engine.url(q), { useSearchSession: true }).catch(() => "")).trim();
      if (CHALLENGE.test(text.slice(0, 300))) {
        engine.blockedUntil = Date.now() + BLOCK_PAUSE;
        break;
      }
      if (text.length >= 300) return { text: text.slice(0, max) };
    }
  }
  return searchBlocked() ? { blocked: true } : { text: "" };
}
