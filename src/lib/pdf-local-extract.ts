import { fetchFileAsInlinePart } from "@/lib/gemini";

/**
 * Fast local PDF text extraction (zero AI calls, works for text-only providers
 * like DeepSeek / Kimi / Doubao / Zhipu). Returns null when the PDF is a
 * scanned image (< 40 meaningful characters) so callers can fall back to
 * multimodal vision models.
 */
export async function extractPdfTextFromBase64(base64Data: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(Buffer.from(base64Data, "base64"));
    const { extractText } = await import("unpdf");
    const result = await extractText(bytes, { mergePages: true });
    const raw = Array.isArray(result.text) ? result.text.join("\n") : String(result.text ?? "");
    const cleaned = raw
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const meaningful = cleaned.replace(/\s+/g, "");
    if (meaningful.length < 40) return null;
    return cleaned.slice(0, 30000);
  } catch {
    return null;
  }
}

export async function extractPdfTextFromFileUrl(fileUrl: string): Promise<string | null> {
  try {
    const file = await fetchFileAsInlinePart(fileUrl);
    if (file.mimeType !== "application/pdf") return null;
    return extractPdfTextFromBase64(file.data);
  } catch {
    return null;
  }
}
