import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getAgentConfig } from "@/lib/agent/config";
import { UserFacingError } from "@/lib/action-result";
import { MAX_HISTORY_TURNS } from "@/lib/assistant-context";
import { createChat, historyMessages } from "@/lib/agent/llm";
import { runAgent, type AgentEvent } from "@/lib/agent/run";
import { AGENT_TOOLS, describeToolCall, executeTool } from "@/lib/agent/tools";
import { buildAgentSystemPrompt } from "@/lib/agent/prompt";
import type { AssistantAction } from "@/lib/assistant-shared";

const bodySchema = z.object({
  message: z.string().trim().min(1, "说点什么吧").max(6000, "单条消息请控制在 6000 字以内。"),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(16000) })).max(100).default([]),
});

/**
 * One 小欧 turn, streamed as newline-delimited JSON so each step shows up as
 * it happens: {type:"step"} / {type:"note"} while working, then
 * {type:"done", reply, actions, steps} or {type:"error", message}.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "请求格式不对" }, { status: 400 });
  const config = await getAgentConfig(user.id);
  if (!config) return Response.json({ error: "先去账号设置配置一个 AI Key 才能用小欧" }, { status: 400 });
  const { message, history } = parsed.data;

  const encoder = new TextEncoder();
  // Closing 小欧 mid-turn cancels the stream: stop writing, and stop working.
  let open = true;
  const stream = new ReadableStream({
    cancel() {
      open = false;
    },
    async start(controller) {
      const send = (event: AgentEvent | Record<string, unknown>) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const proposed: AssistantAction[] = [];
        const notices: string[] = [];
        // Falling over to a backup model is worth knowing about, not hiding.
        const chat = createChat((text) => { notices.push(text); send({ type: "note", text }); });
        const result = await runAgent({
          chat: (turn) => {
            if (!open) throw new UserFacingError("窗口已关闭，停止执行");
            return chat(turn);
          },
          request: {
            config,
            system: await buildAgentSystemPrompt(user.id),
            messages: [...historyMessages(config.provider, history.slice(-MAX_HISTORY_TURNS * 2)), { role: "user", text: message }],
            tools: AGENT_TOOLS,
          },
          execute: (call) => {
            if (!open) throw new UserFacingError("窗口已关闭，停止执行");
            return executeTool(user.id, call, proposed);
          },
          describe: describeToolCall,
          emit: send,
          // Promising buttons without proposing them leaves the user with nothing to click.
          review: (reply) => !proposed.length && /按钮|点击.{0,6}(保存|加入|添加)|点一下/.test(reply) ? "你在回答里提到了按钮，但还没有调用 propose_actions，用户看不到任何按钮。需要的话现在调用 propose_actions 生成，然后再回答；不需要就改掉回答里关于按钮的说法。" : null,
        });
        send({ type: "done", reply: result.reply, actions: proposed, steps: result.steps, notices });
      } catch (error) {
        if (!(error instanceof UserFacingError)) console.error("[agent]", error);
        send({ type: "error", message: error instanceof UserFacingError ? error.message : "小欧这次没跑完，请稍后重试" });
      } finally {
        if (open) controller.close();
        open = false;
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
