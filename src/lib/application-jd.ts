import { parseSubmissionPackage } from "@/lib/submission-package";

/** The JD of a 投递: the one kept with it, else its 岗位's, else the one in an older 材料包. */
export function applicationJd(app: { jdSnapshot?: string | null; submissionPackage?: unknown; position?: { jdText?: string | null } | null }) {
  return app.jdSnapshot?.trim() || app.position?.jdText?.trim() || parseSubmissionPackage(app.submissionPackage)?.jd?.trim() || "";
}
