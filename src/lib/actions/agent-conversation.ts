"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

// 小欧's chats, kept in the database (they used to live in the window's
// localStorage, 60 messages, gone on 新对话) so earlier threads can be
// reopened and 小欧 can look back through them (recall_conversations).

const MAX_MESSAGES = 120;
const MAX_THREADS = 200;

const stepSchema = z.object({ id: z.string().max(40), tool: z.string().max(60), label: z.string().max(300), status: z.enum(["running", "success", "error"]), summary: z.string().max(400), href: z.string().max(500).optional() });
const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(16000),
  actions: z.array(z.record(z.string(), z.unknown())).max(12).optional(),
  applied: z.array(z.number().int()).max(12).optional(),
  steps: z.array(stepSchema).max(40).optional(),
  notices: z.array(z.string().max(300)).max(6).optional(),
  failedRequest: z.object({ message: z.string().max(6000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16000) })).max(100) }).optional(),
});
export type StoredAgentMessage = z.infer<typeof messageSchema>;
export type AgentThreadSummary = { id: string; title: string; updatedAt: string; count: number };

function titleOf(messages: StoredAgentMessage[]) {
  const first = messages.find((message) => message.role === "user")?.content.replace(/\s+/g, " ").trim() || "新对话";
  return first.length > 28 ? `${first.slice(0, 28)}…` : first;
}

export async function listAgentConversations(): Promise<ActionResult<AgentThreadSummary[]>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const rows = await db.agentConversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, updatedAt: true, messages: true } });
    return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString(), count: Array.isArray(row.messages) ? row.messages.length : 0 }));
  });
}

export async function loadAgentConversation(id?: string): Promise<ActionResult<{ id: string; messages: StoredAgentMessage[]; updatedAt: string } | null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = id
      ? await db.agentConversation.findFirst({ where: { id, userId: user.id } })
      : await db.agentConversation.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
    if (!row) return null;
    const parsed = z.array(messageSchema).safeParse(row.messages);
    return { id: row.id, messages: parsed.success ? parsed.data : [], updatedAt: row.updatedAt.toISOString() };
  });
}

/** Saves a thread (creating it on its first message); returns its id. */
export async function saveAgentConversation(input: { id?: string | null; messages: unknown }): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.array(messageSchema).safeParse(input.messages);
    if (!parsed.success) throw new UserFacingError("对话格式不对，没能保存");
    const messages = parsed.data.slice(-MAX_MESSAGES);
    if (!messages.length) throw new UserFacingError("空对话不用保存");
    const data = { title: titleOf(messages), messages: messages as unknown as Prisma.InputJsonValue };
    if (input.id) {
      const existing = await db.agentConversation.findFirst({ where: { id: input.id, userId: user.id }, select: { id: true } });
      if (existing) {
        await db.agentConversation.update({ where: { id: existing.id }, data });
        return { id: existing.id };
      }
    }
    const created = await db.agentConversation.create({ data: { userId: user.id, ...data } });
    // Old threads beyond the cap go, oldest first.
    const old = await db.agentConversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, skip: MAX_THREADS, select: { id: true } });
    if (old.length) await db.agentConversation.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    return { id: created.id };
  });
}

export async function deleteAgentConversation(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.agentConversation.deleteMany({ where: { id, userId: user.id } });
    return null;
  });
}
