import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { GET as desktopGET, POST as desktopPOST, DELETE as desktopDELETE } from "@/app/api/desktop-browser/application-draft/route";
export async function GET(request: Request) { return (await rejectUnpairedExtension(request)) ?? desktopGET(request); }
export async function POST(request: Request) { return (await rejectUnpairedExtension(request)) ?? desktopPOST(request); }
export async function DELETE(request: Request) { return (await rejectUnpairedExtension(request)) ?? desktopDELETE(request); }
