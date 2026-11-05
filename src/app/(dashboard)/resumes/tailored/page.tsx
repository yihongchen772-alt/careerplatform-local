import { redirect } from "next/navigation";

/** The old 定制简历 address (候选岗位池 links, bookmarks): now 按 JD 定制. */
export default async function OldTailoredResumePage({ searchParams }: { searchParams: Promise<{ positionId?: string }> }) {
  const { positionId } = await searchParams;
  redirect(positionId ? `/resumes/tailor?positionId=${encodeURIComponent(positionId)}` : "/resumes/tailor");
}
