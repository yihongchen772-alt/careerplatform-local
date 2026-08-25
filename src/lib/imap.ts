import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { UserFacingError } from "@/lib/action-result";

export type InboxEmail = {
  uid: number;
  subject: string;
  from: string;
  date: Date;
  /** Plain-text snippet only — not the full body, to keep AI calls cheap and
   * limit how much of the user's mail content leaves the machine. */
  snippet: string;
};

export type ImapConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};

export async function getUserImapConfig(userId: string): Promise<ImapConfig | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      imapHost: true,
      imapPort: true,
      smtpUser: true,
      smtpPasswordEncrypted: true,
      inboxScanEnabled: true,
    },
  });
  if (
    !user?.inboxScanEnabled ||
    !user.imapHost ||
    !user.imapPort ||
    !user.smtpUser ||
    !user.smtpPasswordEncrypted
  ) {
    return null;
  }
  return {
    host: user.imapHost,
    port: user.imapPort,
    user: user.smtpUser,
    password: decryptSecret(user.smtpPasswordEncrypted),
  };
}

const MAX_EMAILS_PER_CHECK = 20;

/**
 * Read-only: fetches recent inbox messages since `since`, never marks,
 * moves, or deletes anything. Capped at MAX_EMAILS_PER_CHECK so a mailbox
 * with a big backlog on first-ever setup doesn't trigger dozens of AI calls
 * in one check.
 */
export async function fetchRecentEmails(
  config: ImapConfig,
  since: Date
): Promise<InboxEmail[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("[imap] connect failed", err);
    throw new UserFacingError(
      "邮箱收件箱连不上，检查一下 IMAP 地址、端口和授权码"
    );
  }

  const results: InboxEmail[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since }, { uid: true });
      const recentUids = uids ? uids.slice(-MAX_EMAILS_PER_CHECK) : [];

      // `{ uid: true }` MUST be the third (options) argument, not part of the
      // second (query) argument. In the query it only means "also return the
      // uid field"; the range itself is then read as *sequence numbers*. Since
      // UIDs keep climbing as mail is deleted, they run past the message count
      // (measured: UIDs ~2600 in a 2184-message mailbox) so every fetch matched
      // nothing and the scan silently reported "0 new emails" — it had never
      // once worked before this fix.
      for await (const message of client.fetch(
        recentUids,
        { envelope: true, source: true },
        { uid: true }
      )) {
        const parsed = message.source ? await simpleParser(message.source) : null;
        const bodyText = parsed?.text ?? "";
        results.push({
          uid: message.uid,
          subject: message.envelope?.subject ?? "(无主题)",
          from: message.envelope?.from?.[0]?.address ?? "",
          date: message.envelope?.date ?? new Date(),
          snippet: bodyText.slice(0, 600),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return results;
}
