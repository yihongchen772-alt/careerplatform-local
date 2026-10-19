import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { POST as agentPOST } from "@/app/api/agent/route";

// 小欧 in the extension's side panel: the same agent (with the page open in
// Chrome as context), behind the extension pairing check.
export async function POST(request: Request) {
  return (await rejectUnpairedExtension(request)) ?? agentPOST(request);
}
