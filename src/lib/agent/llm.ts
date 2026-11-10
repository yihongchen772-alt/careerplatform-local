import { OPENAI_COMPATIBLE_BASE_URL, type UserAiConfig } from "@/lib/ai-providers";
import { UserFacingError } from "@/lib/action-result";
import { AI_PROVIDER_OPTIONS } from "@/lib/ai-provider-labels";

// One tool-calling chat turn, whichever provider the user configured. Every
// provider has native function calling; only the wire format differs:
// Gemini (functionCall / functionResponse parts), the OpenAI-compatible ones
// (tool_calls / role "tool") and Anthropic (tool_use / tool_result blocks).
// An assistant turn keeps the provider's raw message and is sent back
// unchanged: Gemini 3 rejects a function call returned without its thought
// signature, and DeepSeek's thinking mode wants its reasoning back the same way.

/** A JSON-schema subset every provider accepts (lowercase types). */
export type JsonSchema = {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

export type ToolSpec = { name: string; description: string; parameters: JsonSchema };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[]; raw: unknown }
  | { role: "tool"; results: { call: ToolCall; content: string }[] };

export type ChatTurn = { text: string; calls: ToolCall[]; raw: unknown };

export type ChatRequest = {
  config: UserAiConfig;
  system: string;
  messages: AgentMessage[];
  /** Empty: the model must answer in text now. */
  tools: ToolSpec[];
  timeoutMs?: number;
  /** Given: the reply is streamed, and each piece of its text arrives here as it is written. */
  onText?: (delta: string) => void;
};

const MAX_TOKENS = 8192;

/** "Gemini · gemini-3.5-flash-lite" — which call failed, in every error. */
function who(config: UserAiConfig, model = config.model): string {
  return `${AI_PROVIDER_OPTIONS.find((option) => option.id === config.provider)?.label ?? config.provider} · ${model}`;
}

function reason(status: number): string {
  if (status === 401 || status === 403) return "Key 无效或已过期，请到设置里更新";
  if (status === 429) return "额度用完或调用太频繁，稍后再试，或在设置里换一个模型/服务商";
  if (status === 400 || status === 404) return "请求被拒绝，这个模型可能不存在或不支持工具调用，请在设置里换一个模型";
  if (TRANSIENT.has(status)) return "服务商那边过载，等一两分钟再试，或在设置里换一个模型/服务商";
  return "服务暂时不可用，请稍后重试";
}

function httpError(config: UserAiConfig, status: number, model?: string): UserFacingError {
  return new UserFacingError(`${who(config, model)} 调用失败（${status}）：${reason(status)}`);
}

/** "Overloaded, try again" (Gemini's 503 at peak hours, Anthropic's 529). */
const TRANSIENT = new Set([500, 502, 503, 504, 529]);

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, label: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new UserFacingError(`${label} 没有响应（超时或网络不通），请检查网络后重试`);
    }
    if (!TRANSIENT.has(response.status) || attempt >= 2) return response;
    await response.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
}

/** The JSON objects of a server-sent-event stream (`data: {…}` lines), as they arrive. */
async function* sseEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // A keep-alive or a line split oddly: nothing to read in it.
      }
    }
    if (done) return;
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ---- Gemini ----

/** Gemini's own schema dialect spells types in upper case. */
function geminiSchema(schema: JsonSchema): Record<string, unknown> {
  return {
    type: schema.type.toUpperCase(),
    ...(schema.description ? { description: schema.description } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, geminiSchema(value)])) } : {}),
    ...(schema.required?.length ? { required: schema.required } : {}),
    ...(schema.items ? { items: geminiSchema(schema.items) } : {}),
  };
}

type GeminiPart = { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: unknown }; thoughtSignature?: string };
/** A Gemini reply as stored: its parts, and which model wrote them. */
type GeminiRaw = { model?: string; parts: GeminiPart[] };

// Gemini 3 checks that a function call sent back carries the thought
// signature its own model produced. After falling over to another model
// (quota, overload) the old signatures are not that model's; Google's
// documented placeholder tells it to skip the check.
const SKIP_SIGNATURE = "skip_thought_signature_validator";

function geminiParts(raw: unknown, model: string): GeminiPart[] {
  const stored: GeminiRaw = Array.isArray(raw) ? { parts: raw as GeminiPart[] } : (raw as GeminiRaw);
  if (!stored.model || stored.model === model) return stored.parts;
  return stored.parts.map((part) => part.functionCall ? { ...part, thoughtSignature: SKIP_SIGNATURE } : part);
}

/** The configured models in order (a comma-separated list falls through on 429). */
export function geminiModels(model: string): string[] {
  // Speech / image / embedding models in the list can't hold a conversation.
  const list = model.split(",").map((item) => item.trim()).filter((item) => item && !/tts|image|embed|audio|live|veo|imagen/i.test(item));
  return list.length ? list : ["gemini-3.5-flash-lite"];
}

async function geminiTurn({ config, system, messages, tools, timeoutMs = 60000, onText }: ChatRequest, state: { modelIndex: number }, notice: (text: string) => void): Promise<ChatTurn> {
  const contents = (model: string) => messages.map((message) => {
    if (message.role === "user") return { role: "user", parts: [{ text: message.text }] };
    if (message.role === "assistant") return { role: "model", parts: geminiParts(message.raw, model) };
    return { role: "user", parts: message.results.map(({ call, content }) => ({ functionResponse: { ...(call.id.startsWith("gemini-") ? {} : { id: call.id }), name: call.name, response: { content } } })) };
  });
  const models = geminiModels(config.model);
  // Stay on the model that answered: its thought signatures are valid only for it.
  for (let i = state.modelIndex; i < models.length; i++) {
    const model = models[i];
    const response = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${onText ? "streamGenerateContent?alt=sse" : "generateContent"}`, { "x-goog-api-key": config.apiKey }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: contents(model),
      ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: geminiSchema(tool.parameters) })) }] } : {}),
      generationConfig: { maxOutputTokens: MAX_TOKENS, thinkingConfig: { thinkingBudget: 1024 } },
    }, timeoutMs, who(config, model));
    if (!response.ok) {
      console.error(`[agent:gemini:${model}] ${response.status}`, (await response.text().catch(() => "")).slice(0, 500));
      if ((response.status === 429 || TRANSIENT.has(response.status)) && i < models.length - 1) {
        notice(`${model} ${response.status === 429 ? "额度用完了" : "这会儿过载"}，改用 ${models[i + 1]} 继续`);
        continue;
      }
      throw httpError(config, response.status, model);
    }
    state.modelIndex = i;
    let data: { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[] };
    if (onText) {
      // Each event carries the next parts; text parts are pieces of one reply.
      const streamed: GeminiPart[] = [];
      let finishReason: string | undefined;
      for await (const event of sseEvents(response)) {
        const candidate = (event as typeof data).candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          streamed.push(part);
          if (part.text && !part.thought) onText(part.text);
        }
        finishReason = candidate?.finishReason ?? finishReason;
      }
      data = { candidates: [{ content: { parts: streamed }, finishReason }] };
    } else data = await response.json();
    const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((part) => part.functionCall).map((part, index) => ({ id: part.functionCall!.id || `gemini-${Date.now()}-${index}`, name: part.functionCall!.name, args: parseArgs(part.functionCall!.args) }));
    const text = parts.filter((part) => part.text && !part.thought).map((part) => part.text).join("").trim();
    if (!calls.length && !text && data?.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new UserFacingError("AI 回答太长被截断了，请重试");
    return { text, calls, raw: { model, parts: parts.length ? parts : [{ text: text || " " }] } satisfies GeminiRaw };
  }
  throw httpError(config, 429, models[models.length - 1]);
}

// ---- OpenAI-compatible (OpenAI, DeepSeek, Kimi, Qwen, 智谱, 豆包, xAI, Mistral) ----

type OpenAiMessage = { role: string; content?: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string; reasoning_content?: string };

async function openAiTurn({ config, system, messages, tools, timeoutMs = 60000, onText }: ChatRequest): Promise<ChatTurn> {
  if (config.provider === "gemini" || config.provider === "anthropic") throw new Error("not an OpenAI-compatible provider");
  const wire: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") wire.push({ role: "user", content: message.text });
    else if (message.role === "assistant") wire.push(message.raw as OpenAiMessage);
    else for (const { call, content } of message.results) wire.push({ role: "tool", tool_call_id: call.id, content });
  }
  const body = {
    model: config.model,
    messages: wire,
    ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
    max_tokens: MAX_TOKENS,
  };
  const url = `${config.baseUrl || OPENAI_COMPATIBLE_BASE_URL[config.provider]}/chat/completions`;
  let response = await post(url, { Authorization: `Bearer ${config.apiKey}` }, onText ? { ...body, stream: true } : body, timeoutMs, who(config));
  // A provider that refuses streaming (with tools) still answers the plain way.
  let streaming = !!onText;
  if (onText && response.status === 400) {
    await response.body?.cancel().catch(() => {});
    response = await post(url, { Authorization: `Bearer ${config.apiKey}` }, body, timeoutMs, who(config));
    streaming = false;
  }
  if (!response.ok) {
    console.error(`[agent:${config.provider}] ${response.status}`, (await response.text().catch(() => "")).slice(0, 500));
    throw httpError(config, response.status);
  }
  let message: OpenAiMessage;
  if (streaming && onText) {
    // Text and reasoning arrive in pieces; a tool call's id and name come once, its arguments in pieces, by index.
    let content = "";
    let reasoning = "";
    const pending: { id: string; name: string; args: string }[] = [];
    for await (const event of sseEvents(response)) {
      const delta = (event as { choices?: { delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] }).choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) { content += delta.content; onText(delta.content); }
      if (delta.reasoning_content) reasoning += delta.reasoning_content;
      for (const piece of delta.tool_calls ?? []) {
        const index = piece.index ?? pending.length;
        const call = (pending[index] ??= { id: "", name: "", args: "" });
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.name += piece.function.name;
        if (piece.function?.arguments) call.args += piece.function.arguments;
      }
    }
    const toolCalls = pending.filter(Boolean).map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.args } }));
    message = { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) };
  } else {
    const data = await response.json();
    message = data?.choices?.[0]?.message ?? { role: "assistant", content: "" };
  }
  const calls = (message.tool_calls ?? []).map((call, index) => ({ id: call.id || `call-${index}`, name: call.function?.name ?? "", args: parseArgs(call.function?.arguments) }));
  const raw: OpenAiMessage = { role: "assistant", content: message.content ?? "", ...(message.tool_calls?.length ? { tool_calls: message.tool_calls.map((call, index) => ({ ...call, id: calls[index].id })) } : {}), ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}) };
  return { text: (message.content ?? "").trim(), calls, raw };
}

// ---- Anthropic ----

type AnthropicBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown };

async function anthropicTurn({ config, system, messages, tools, timeoutMs = 60000, onText }: ChatRequest): Promise<ChatTurn> {
  const wire = messages.map((message) => {
    if (message.role === "user") return { role: "user", content: message.text };
    if (message.role === "assistant") return { role: "assistant", content: message.raw as AnthropicBlock[] };
    return { role: "user", content: message.results.map(({ call, content }) => ({ type: "tool_result", tool_use_id: call.id, content })) };
  });
  const response = await post("https://api.anthropic.com/v1/messages", { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }, {
    model: config.model,
    system,
    messages: wire,
    ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
    max_tokens: MAX_TOKENS,
    ...(onText ? { stream: true } : {}),
  }, timeoutMs, who(config));
  if (!response.ok) {
    console.error(`[agent:anthropic] ${response.status}`, (await response.text().catch(() => "")).slice(0, 500));
    throw httpError(config, response.status);
  }
  let blocks: AnthropicBlock[];
  if (onText) {
    // Blocks open, grow (text, or a tool's input as pieces of JSON) and close, by index.
    blocks = [];
    const inputs: string[] = [];
    for await (const event of sseEvents(response)) {
      const index = typeof event.index === "number" ? event.index : 0;
      if (event.type === "content_block_start") blocks[index] = { ...(event.content_block as AnthropicBlock) };
      else if (event.type === "content_block_delta") {
        const delta = event.delta as { type?: string; text?: string; partial_json?: string };
        const block = (blocks[index] ??= { type: delta.type === "input_json_delta" ? "tool_use" : "text" });
        if (delta.type === "text_delta" && delta.text) { block.text = (block.text ?? "") + delta.text; onText(delta.text); }
        if (delta.type === "input_json_delta" && delta.partial_json) inputs[index] = (inputs[index] ?? "") + delta.partial_json;
      } else if (event.type === "error") throw new UserFacingError(`${who(config)} 调用中断：服务商那边过载或出错，请稍后重试`);
    }
    blocks = blocks.map((block, index) => block && block.type === "tool_use" && inputs[index] !== undefined ? { ...block, input: parseArgs(inputs[index]) } : block).filter(Boolean);
  } else {
    const data = await response.json();
    blocks = data?.content ?? [];
  }
  const calls = blocks.filter((block) => block.type === "tool_use").map((block) => ({ id: block.id ?? "", name: block.name ?? "", args: parseArgs(block.input) }));
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("").trim();
  return { text, calls, raw: blocks.length ? blocks : [{ type: "text", text: text || " " }] };
}

/**
 * A chat function bound to one conversation (Gemini keeps to one model within
 * it). `notice` hears about a fall-over to the next model.
 */
export function createChat(notice: (text: string) => void = () => {}) {
  const state = { modelIndex: 0 };
  return (request: ChatRequest): Promise<ChatTurn> => {
    if (request.config.provider === "gemini") return geminiTurn(request, state, notice);
    if (request.config.provider === "anthropic") return anthropicTurn(request);
    return openAiTurn(request);
  };
}

/** An earlier text-only reply, in the shape this provider sends back. */
export function textReply(provider: UserAiConfig["provider"], text: string): AgentMessage {
  const raw = provider === "gemini" ? [{ text }] : provider === "anthropic" ? [{ type: "text", text }] : { role: "assistant", content: text };
  return { role: "assistant", text, calls: [], raw };
}

/** Earlier turns as alternating user / assistant messages, starting with the user. */
export function historyMessages(provider: UserAiConfig["provider"], history: { role: "user" | "assistant"; content: string; refs?: string }[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const raw of history) {
    // What an earlier reply looked up rides along with it, as a note to 小欧 itself.
    const turn = raw.role === "assistant" && raw.refs?.trim() ? { ...raw, content: `${raw.content}\n\n（系统附注：这一轮查到的记录，后面可以直接用这些 ID，不必重新查；数据可能已变，要改记录前先确认）\n${raw.refs.trim()}` } : raw;
    const last = messages[messages.length - 1];
    if (turn.role === "user") {
      if (last?.role === "user") last.text += `\n${turn.content}`;
      else messages.push({ role: "user", text: turn.content });
    } else if (last?.role === "user") messages.push(textReply(provider, turn.content));
    // "操作已完成：…" after a reply: one reply, so 小欧 knows the button was clicked.
    else if (last?.role === "assistant") messages[messages.length - 1] = textReply(provider, `${last.text}\n${turn.content}`);
  }
  // The new message follows as a user turn, so the history must end on a reply.
  if (messages[messages.length - 1]?.role === "user") messages.pop();
  return messages;
}
