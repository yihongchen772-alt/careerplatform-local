import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { isPublicAddress } from "@/lib/job-capture";
import { UserFacingError } from "@/lib/action-result";

/** Resolve and pin the validated address; validate every redirect, never forward browser cookies. */
export async function fetchJobPage(raw: string): Promise<string> {
  const signal = AbortSignal.timeout(12000);
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new UserFacingError("请使用公开招聘网页，或直接粘贴 JD 正文");
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new UserFacingError("不支持本机或内网链接，请直接粘贴 JD 正文");
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } } });
    try {
      const response = await request(url, { dispatcher, signal, headers: { "user-agent": "JobCompass/1.0 (user-initiated job capture)", accept: "text/html,text/plain" } });
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.body.destroy(); url = new URL(String(response.headers.location), url); continue; }
      if (response.statusCode !== 200 || !/text\/(html|plain)/i.test(String(response.headers["content-type"] || ""))) { response.body.destroy(); throw new Error("Unsupported page"); }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) { response.body.destroy(); throw new Error("Page too large"); } chunks.push(Buffer.from(chunk)); }
      return Buffer.concat(chunks).toString("utf8");
    } finally { await dispatcher.close(); }
  }
  throw new UserFacingError("页面跳转太多，请直接粘贴 JD 正文");
}
