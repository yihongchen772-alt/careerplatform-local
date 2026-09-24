import { NextResponse, type NextRequest } from "next/server";
import { isTrustedLocalRequest } from "@/lib/local-request-guard";

export function proxy(request: NextRequest) {
  if (!isTrustedLocalRequest(request.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}
