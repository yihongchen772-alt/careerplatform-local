import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { POST as desktopPOST } from "@/app/api/desktop-browser/record-application/route";
export async function POST(request: Request) { return (await rejectUnpairedExtension(request)) ?? desktopPOST(request); }
