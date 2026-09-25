/** IMAP may include the highest existing UID for a range starting above it. */
export function unseenUids(uids: number[], lastSeenUid?: number | null): number[] {
  return Array.from(new Set(uids))
    .filter((uid) => Number.isSafeInteger(uid) && uid > 0 && (lastSeenUid == null || uid > lastSeenUid))
    .sort((a, b) => a - b);
}

/** Account IDs are local to this app; UIDs are only unique inside one inbox. */
export function mailTaskKey(accountId: string, uid: number): string {
  return `${accountId}:${uid}`;
}

type ImportedTask = {
  id: string;
  title: string;
  note: string | null;
  sourceMailKey: string | null;
  done: boolean;
  dueDate: Date | null;
  dueDateEnd: Date | null;
  positionId: string | null;
  applicationId: string | null;
  createdAt: Date;
};

/** Only untouched, byte-for-byte identical legacy imports are safe to clean. */
export function duplicateImportedTaskIds(tasks: ImportedTask[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const task of [...tasks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) {
    if (task.sourceMailKey || task.done || task.dueDate || task.dueDateEnd || task.positionId || task.applicationId) continue;
    if (!task.note?.includes("\n\n邮件主题：") || !task.note.includes("\n来自：") || !task.note.includes("\n收件箱：")) continue;
    const key = `${task.title.length}:${task.title}${task.note}`;
    if (seen.has(key)) duplicates.push(task.id);
    else seen.add(key);
  }
  return duplicates;
}
