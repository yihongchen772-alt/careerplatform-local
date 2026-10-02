import { lookup } from "node:dns/promises";
import path from "node:path";
import { Agent, request } from "undici";
import { isPublicAddress } from "@/lib/job-capture";
import { ALLOWED_LIBRARY_MIME, mimeTypeForExtension } from "@/lib/local-storage";
import { MAX_BACKUP_FILE_BYTES } from "@/lib/backup-files";

/** Untrusted backups must not reach localhost/LAN. Pin DNS and recheck every
 * redirect with one total deadline and a bounded stream (no ambient proxy). */
export async function fetchBackupFile(raw: string, options: { signal?: AbortSignal; maxBytes?: number } = {}): Promise<{ buffer: Buffer; mimeType: string }> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  const maxBytes = Math.min(MAX_BACKUP_FILE_BYTES, options.maxBytes ?? MAX_BACKUP_FILE_BYTES);
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("仅支持公开 HTTP/HTTPS 附件地址");
    let abort!: () => void;
    const deadline = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error("附件下载超时")); signal.addEventListener("abort", abort, { once: true }); });
    let addresses;
    try { addresses = await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }), deadline]); }
    finally { signal.removeEventListener("abort", abort); }
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error("不允许下载本机或内网附件");
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } } });
    try {
      const res = await request(url, { dispatcher, signal, headers: { "accept-encoding": "identity" } });
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.body.destroy();
        const next = new URL(String(res.headers.location), url);
        if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("不允许附件链接降级到 HTTP");
        url = next; continue;
      }
      if (res.statusCode !== 200) throw new Error(`附件下载失败（${res.statusCode}）`);
      const mimeType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() || mimeTypeForExtension(path.extname(url.pathname)) || "";
      if (!ALLOWED_LIBRARY_MIME.includes(mimeType) || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) throw new Error("附件类型不支持");
      if (Number(res.headers["content-length"] ?? 0) > maxBytes) throw new Error("附件超过 50MB");
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of res.body) {
        signal.throwIfAborted(); size += chunk.length;
        if (size > maxBytes) throw new Error("附件超过 50MB");
        chunks.push(Buffer.from(chunk));
      }
      return { buffer: Buffer.concat(chunks), mimeType };
    } finally { await dispatcher.destroy(); }
  }
  throw new Error("附件重定向过多");
}
