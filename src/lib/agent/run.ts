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
/** Tools that only read: safe to run at the same time. */
const READ_ONLY_TOOLS = new Set(["search_records", "filter_applications", "get_workspace_overview", "get_application", "get_position", "resume_context", "research_web", "read_webpage", "list_missing_cities", "recall_conversations"]);

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
  const seen = new Map<string, Promise<string>>();
  let reviewed = false;
  // Weaker models sometimes write the real answer beside a tool call and
  // end with only "完成了，按钮在下面"; keep the longest such draft.
  let draft = "";
  for (let round = 0; ; round++) {
    const lastRound = round >= Math.min(Math.max(maxRounds, 0), MAX_TOOL_ROUNDS);
    if (lastRound) messages.push({ role: "user", text: "（系统提示：这一轮的工具步数用完了。请直接用已经查到的内容回答；没做完的事明确告诉用户还差什么。）" });
    const turn = await chat({ ...request, messages, tools: lastRound ? [] : request.tools });
    if (!turn.calls.length || lastRound) {
      if (!turn.text) throw new UserFacingError("AI 没有给出回答，请重试");
      const problem = !lastRound && !reviewed ? review?.(turn.text) : null;
      reviewed = true;
      if (!problem) return { reply: draft.length > 120 && turn.text.length < 120 && !turn.text.includes(draft.slice(0, 40)) ? `${draft}\n\n${turn.text}` : turn.text, steps };
      messages.push({ role: "assistant", text: turn.text, calls: [], raw: turn.raw }, { role: "user", text: `（系统提示：${problem}）` });
      continue;
    }
    // A short line alongside tool calls is the model saying what it is doing
    // ("先看看你的投递…"); longer text there is its reasoning, not for display.
    if (turn.text && turn.text.length <= 80 && !turn.text.includes("\n")) emit({ type: "note", text: turn.text });
    if (turn.text.length > draft.length) draft = turn.text;
    messages.push({ role: "assistant", text: turn.text, calls: turn.calls, raw: turn.raw });
    // Lookups that only read run side by side (a week-plan asks for several
    // records at once); anything that writes or remembers runs alone, in order.
    const outcomes: ({ call: ToolCall; content: string; step: AgentStep | null } | undefined)[] = new Array(turn.calls.length);
    const runOne = async (call: ToolCall, index: number) => {
      const key = JSON.stringify([call.name, call.args]);
      const step: AgentStep = { id: `${round}-${index}`, tool: call.name, label: describe(call), status: "running", summary: "" };
      const earlier = seen.get(key);
      if (earlier) {
        // The same lookup again returns what it returned before, without running it twice.
        const repeated = await earlier.catch(() => null);
        if (repeated !== null) return { call, content: `（与之前同一次调用的结果相同）\n${repeated}`, step: null };
      }
      const work = (async () => {
        const outcome = await execute(call);
        const long = outcome.content.length > MAX_RESULT_CHARS;
        const content = long ? `${outcome.content.slice(0, MAX_RESULT_CHARS)}\n…（结果太长，后面 ${outcome.content.length - MAX_RESULT_CHARS} 字被截掉了；要看后面的部分，请换更具体的条件再查一次，不要把这当成完整结果）` : outcome.content;
        Object.assign(step, { label: outcome.label, status: "success", summary: outcome.summary, href: outcome.href });
        return content;
      })();
      seen.set(key, work);
      emit({ type: "step", step: { ...step } });
      try {
        return { call, content: await work, step };
      } catch (error) {
        seen.delete(key);
        if (!(error instanceof UserFacingError)) console.error(`[agent:${call.name}]`, error);
        const message = error instanceof UserFacingError ? error.message : "工具执行出错";
        Object.assign(step, { status: "error", summary: message.slice(0, 300) });
        return { call, content: `执行失败：${message}。不能把失败当作查询无结果，也不要反复重试同样的调用。`, step };
      }
    };
    for (let i = 0; i < turn.calls.length;) {
      if (!READ_ONLY_TOOLS.has(turn.calls[i].name)) {
        const done = await runOne(turn.calls[i], i);
        outcomes[i] = done; if (done.step) { steps.push(done.step); emit({ type: "step", step: { ...done.step } }); }
        i++;
        continue;
      }
      let end = i;
      while (end < turn.calls.length && READ_ONLY_TOOLS.has(turn.calls[end].name)) end++;
      const batch = await Promise.all(turn.calls.slice(i, end).map((call, k) => runOne(call, i + k)));
      batch.forEach((done, k) => { outcomes[i + k] = done; if (done.step) { steps.push(done.step); emit({ type: "step", step: { ...done.step } }); } });
      i = end;
    }
    const results = outcomes.map((done) => ({ call: done!.call, content: done!.content }));
    messages.push({ role: "tool", results });
  }
}
