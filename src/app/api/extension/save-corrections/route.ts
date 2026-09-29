import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { POST as desktopPOST } from "@/app/api/desktop-browser/save-corrections/route";

// Same handler the desktop 网申浏览器 uses, behind the extension pairing check.
export async function POST(request: Request) {
  return (await rejectUnpairedExtension(request)) ?? desktopPOST(request);
}
