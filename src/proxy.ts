import { NextResponse, type NextRequest } from "next/server";
import { isExtensionApiRequest, isTrustedLocalRequest } from "@/lib/local-request-guard";

export function proxy(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers) && !isExtensionApiRequest(request.nextUrl.pathname, request.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

// This route performs the identical loopback/origin check itself and streams
// its bounded upload. Proxy's default 10MB body clone would truncate backups.
export const config = { matcher: ["/((?!api/data-transfer$).*)"] };
