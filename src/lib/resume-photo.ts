/**
 * The 证件照 embedded in a resume PDF, as a data: URL, or null.
 *
 * Resume tools embed the photo as a JPEG image object (/DCTDecode), and a
 * JPEG stream's bytes are the JPEG file itself — so the photo comes out
 * byte for byte, with no PDF renderer or image library. Only portrait-shaped
 * JPEGs count (a logo or QR code is square or wide); of those the largest
 * wins. Anything else (PNG-style images, CMYK) is skipped and the editor
 * offers 「添加照片」 instead.
 */
export function photoFromPdf(pdf: Buffer): string | null {
  const text = pdf.toString("latin1");
  let best: { area: number; bytes: Buffer } | null = null;
  const marker = /\/Subtype\s*\/Image\b/g;
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    const objStart = text.lastIndexOf(" obj", match.index);
    const streamAt = text.indexOf("stream", match.index);
    if (objStart < 0 || streamAt < 0) continue;
    const endObj = text.indexOf("endobj", match.index);
    if (endObj >= 0 && endObj < streamAt) continue;
    const dict = text.slice(objStart, streamAt);
    const filter = /\/Filter\s*(\[\s*\/DCTDecode\s*\]|\/DCTDecode)\b/.exec(dict);
    if (!filter || /\/DeviceCMYK/.test(dict)) continue;
    const width = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const height = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? 0);
    if (width < 60 || height < 60) continue;
    const ratio = height / width;
    if (ratio < 1.05 || ratio > 1.9) continue;
    let start = streamAt + "stream".length;
    if (text[start] === "\r") start++;
    if (text[start] === "\n") start++;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    let bytes = pdf.subarray(start, end);
    // A JPEG starts FF D8 and ends FF D9; drop the line break before "endstream".
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) continue;
    const eoi = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (eoi < 0) continue;
    bytes = bytes.subarray(0, eoi + 2);
    if (bytes.length > 2_500_000) continue;
    const area = width * height;
    if (!best || area > best.area) best = { area, bytes };
  }
  return best ? `data:image/jpeg;base64,${Buffer.from(best.bytes).toString("base64")}` : null;
}
