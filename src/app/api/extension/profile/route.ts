import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { GET as desktopGET } from "@/app/api/desktop-browser/profile/route";

// Same handler the desktop 网申浏览器 uses, behind the extension pairing check.
export async function GET(request: Request) {
  return (await rejectUnpairedExtension(request)) ?? desktopGET(request);
}
