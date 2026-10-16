import { UserFacingError } from "@/lib/action-result";
import type { AgentMessage, ChatRequest, ChatTurn, ToolCall, ToolSpec } from "@/lib/agent/llm";

export type AgentStep = {
  id: string;
  tool: string;
  label: string;
  status: "running" | "success" | "error";
  summary: string;
  href?: string;
};

export type ToolOutcome = { content: string; label: string; summary: string; href?: string };

export type AgentEvent = { type: "step"; step: AgentStep } | { type: "note"; text: string };

/** Enough for "plan my week" (records, a few JDs, the resume, a search) without running away with the Key. */
export const MAX_TOOL_ROUNDS = 12;
const MAX_RESULT_CHARS = 12000;

/**
 * The agent loop: the model sees the conversation and the tools, and either
 * answers or calls tools; each result goes back to it until it answers. The
 * model decides what to look at next from what it has found, rather than
 * following a fixed sequence. When the round budget runs out it must answer
 * with what it has.
 */
export async function runAgent({ chat, request, execute, describe, emit, review, maxRounds = MAX_TOOL_ROUNDS }: {
  chat: (request: ChatRequest) => Promise<ChatTurn>;
  request: Omit<ChatRequest, "tools"> & { tools: ToolSpec[] };
  execute: (call: ToolCall) => Promise<ToolOutcome>;
  /** What the step shows while it runs ("正在查投递记录：腾讯"). */
  describe: (call: ToolCall) => string;
  emit: (event: AgentEvent) => void;
  /** Checks a finished reply once; a returned note sends the model back to fix it. */
  review?: (reply: string) => string | null;
  maxRounds?: number;
}): Promise<{ reply: string; steps: AgentStep[] }> {
  const messages: AgentMessage[] = [...request.messages];
  const steps: AgentStep[] = [];
  const seen = new Map<string, string>();
  let reviewed = false;
  for (let round = 0; ; round++) {
    const lastRound = round >= Math.min(Math.max(maxRounds, 0), MAX_TOOL_ROUNDS);
    if (lastRound) messages.push({ role: "user", text: "（系统提示：这一轮的工具步数用完了。请直接用已经查到的内容回答；没做完的事明确告诉用户还差什么。）" });
    const turn = await chat({ ...request, messages, tools: lastRound ? [] : request.tools });
    if (!turn.calls.length || lastRound) {
      if (!turn.text) throw new UserFacingError("AI 没有给出回答，请重试");
      const problem = !lastRound && !reviewed ? review?.(turn.text) : null;
      reviewed = true;
      if (!problem) return { reply: turn.text, steps };
      messages.push({ role: "assistant", text: turn.text, calls: [], raw: turn.raw }, { role: "user", text: `（系统提示：${problem}）` });
      continue;
    }
    // A short line alongside tool calls is the model saying what it is doing
    // ("先看看你的投递…"); longer text there is its reasoning, not for display.
    if (turn.text && turn.text.length <= 80 && !turn.text.includes("\n")) emit({ type: "note", text: turn.text });
    messages.push({ role: "assistant", text: turn.text, calls: turn.calls, raw: turn.raw });
    const results: { call: ToolCall; content: string }[] = [];
    for (const call of turn.calls) {
      const key = JSON.stringify([call.name, call.args]);
      const step: AgentStep = { id: `${round}-${results.length}`, tool: call.name, label: describe(call), status: "running", summary: "" };
      const repeated = seen.get(key);
      if (repeated !== undefined) {
        // The same lookup again returns what it returned before, without running it twice.
        results.push({ call, content: `（与之前同一次调用的结果相同）\n${repeated}` });
        continue;
      }
      try {
        emit({ type: "step", step: { ...step } });
        const outcome = await execute(call);
        const content = outcome.content.slice(0, MAX_RESULT_CHARS);
        Object.assign(step, { label: outcome.label, status: "success", summary: outcome.summary, href: outcome.href });
        seen.set(key, content);
        results.push({ call, content });
      } catch (error) {
        if (!(error instanceof UserFacingError)) console.error(`[agent:${call.name}]`, error);
        const message = error instanceof UserFacingError ? error.message : "工具执行出错";
        Object.assign(step, { status: "error", summary: message.slice(0, 300) });
        results.push({ call, content: `执行失败：${message}。不能把失败当作查询无结果，也不要反复重试同样的调用。` });
      }
      steps.push(step);
      emit({ type: "step", step: { ...step } });
    }
    messages.push({ role: "tool", results });
  }
}
