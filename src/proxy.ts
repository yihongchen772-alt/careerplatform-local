import { NextResponse, type NextRequest } from "next/server";
import { isExtensionApiRequest, isTrustedLocalRequest } from "@/lib/local-request-guard";

export function proxy(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers) && !isExtensionApiRequest(request.nextUrl.pathname, request.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}
