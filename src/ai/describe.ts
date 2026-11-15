// AI "describe it and I'll draw it" (opt-in; needs your own Anthropic API key and internet). The description is sent
// to the Anthropic API from this browser (or the desktop app) with the key the user typed; nothing else is sent, and
// nothing is sent until the user presses Draw. Claude is asked for Mermaid text only. The reply is UNTRUSTED: it is
// only ever read as Mermaid text and inserted through cmd.importMermaid (parseMermaid / parseSequence + the builders,
// then the same checks as any other Mermaid input). Nothing in a reply is ever executed or rendered as HTML.
import type Anthropic from '@anthropic-ai/sdk';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];
export const DEFAULT_MODEL: AiModel = 'claude-opus-5-5';

/** Longest description or change request sent, and longest reply read back. */
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_REPLY_CHARS = 100_000;

export const SYSTEM_PROMPT = `You turn a description of a diagram into Mermaid text for FlowSketch, a hand-drawn diagram editor that animates the arrows.

Reply with ONLY one fenced code block (\`\`\`mermaid … \`\`\`) and nothing else.

Use a flowchart (\`flowchart LR\` or \`flowchart TD\`) unless the description is about messages exchanged over time between participants, then use \`sequenceDiagram\`.

Flowchart syntax FlowSketch reads: nodes \`id[Box]\`, \`id(Rounded)\`, \`id([Pill])\`, \`id{Decision}\`, \`id((Circle))\`, \`id[(Database)]\`, \`id{{Hexagon}}\`, \`id[/Input/]\`; links \`-->\`, \`---\`, \`-.->\` (dashed), \`==>\` (thick), \`<-->\` (both ways), labels \`A -->|label| B\`; \`A & B --> C\`; \`subgraph Title\` … \`end\` for groups (they can nest), \`direction LR\` inside a subgraph.
Sequence syntax: \`participant A as Alice\`, \`actor U\`, \`A->>B: text\`, \`B-->>A: reply\`, \`A-)B: async\`, \`Note right of A: text\`, \`A->>+B\` / \`B-->>-A\` activations, \`loop\`/\`alt\`/\`else\`/\`opt\`/\`par\` … \`end\`, \`autonumber\`.

Rules:
- Short, clear labels (a few words). Put quotes around labels with punctuation: A["Login (OAuth)"].
- To show the order things happen in, start arrow labels with step numbers: \`-->|1. request|\`, \`-->|2. reply|\`; sub-steps 4a, 4b; deeper 4a.1, 4a.2.
- No styling: no style, classDef, class, linkStyle, click or HTML.
- Keep it to what was described; at most about 60 boxes.
- If you are given a current draft and a change, reply with the whole updated diagram.`;

/** One turn of the conversation that built the current draft. */
export interface AiTurn { role: 'user' | 'assistant'; text: string }

/**
 * The Mermaid text in a reply: the first ```mermaid block, else the first fenced block, else the whole reply when it
 * starts like Mermaid. Capped; '' when there is none.
 */
export function extractMermaid(reply: string): string {
  const r = reply.slice(0, MAX_REPLY_CHARS);
  const fence = /```[ \t]*mermaid[^\n]*\n([\s\S]*?)(?:```|$)/i.exec(r) ?? /```[^\n]*\n([\s\S]*?)(?:```|$)/.exec(r);
  const body = (fence ? fence[1] : r).replace(/\r\n?/g, '\n').trim();
  if (fence) return body;
  return /^(flowchart|graph|sequenceDiagram)\b/.test(body) ? body : '';
}

/** The messages for a request: the first description, then each draft and change request in turn. */
export function buildMessages(turns: AiTurn[]): Anthropic.MessageParam[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.role === 'assistant' ? '```mermaid\n' + t.text + '\n```' : t.text.slice(0, MAX_PROMPT_CHARS),
  }));
}

/** An API key as typed or stored: trimmed, printable ASCII without spaces, sensible length; '' if not. */
export function cleanKey(v: unknown): string {
  if (typeof v !== 'string') return '';
  const k = v.trim();
  return /^[\x21-\x7e]{10,400}$/.test(k) ? k : '';
}

export class AiError extends Error {}

/** A short, plain message for a failed request. */
export function errorMessage(e: unknown, sdk: typeof Anthropic): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof sdk.APIUserAbortError) return 'Cancelled.';
  if (e instanceof sdk.AuthenticationError) return 'Anthropic did not accept that API key. Check it and try again.';
  if (e instanceof sdk.PermissionDeniedError) return 'That API key is not allowed to use this model. Try another model or key.';
  if (e instanceof sdk.NotFoundError) return 'That model is not available to this API key. Try another model.';
  if (e instanceof sdk.RateLimitError) return 'Too many requests or out of credit for now. Wait a moment and try again.';
  if (e instanceof sdk.BadRequestError) return `Anthropic could not take that request: ${e.message}`.slice(0, 300);
  if (e instanceof sdk.InternalServerError) return 'Anthropic is busy or having trouble. Try again in a moment.';
  if (e instanceof sdk.APIConnectionError) return 'Could not reach Anthropic. Check your internet connection.';
  if (e instanceof sdk.APIError) return `Anthropic returned an error (${e.status ?? '?'}).`;
  return 'Something went wrong asking Claude.';
}

export interface DrawOptions {
  apiKey: string;
  model: AiModel;
  signal?: AbortSignal;
  /** For tests: a fetch to use instead of the browser's. */
  fetch?: typeof fetch;
}

/** The SDK, loaded only when the feature is used (so the rest of the app never downloads it). */
export const loadSdk = async () => (await import('@anthropic-ai/sdk')).default;

/**
 * Ask Claude for a diagram. `turns` = the description (and, when refining, each earlier draft and change); the last
 * turn is the user's. Returns the Mermaid text, or throws with a message for the user.
 */
export async function drawWithClaude(turns: AiTurn[], opts: DrawOptions): Promise<string> {
  const Sdk = await loadSdk();
  const apiKey = cleanKey(opts.apiKey);
  if (!apiKey) throw new AiError('Enter your Anthropic API key first.');
  if (!turns.length || turns[turns.length - 1].role !== 'user' || !turns[turns.length - 1].text.trim()) throw new AiError('Describe the diagram first.');
  const client = new Sdk({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 180_000, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  try {
    const msg = await client.beta.messages.create({
      model: opts.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: buildMessages(turns),
      output_config: { effort: 'medium' },
      // on a policy decline, let the API retry on its default fallback model (Haiku has none)
      ...(opts.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    }, { signal: opts.signal });
    if (msg.stop_reason === 'refusal') throw new AiError('Claude declined to draw that. Try describing it differently.');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    const mermaid = extractMermaid(text);
    if (!mermaid) throw new AiError(msg.stop_reason === 'max_tokens' ? 'The reply was cut off. Try a smaller diagram.' : 'Claude did not reply with a diagram. Try again or describe it differently.');
    return mermaid;
  } catch (e) {
    throw new AiError(errorMessage(e, Sdk));
  }
}

// The API key and model, remembered on this device only when the user asks (localStorage, read back type-checked).
// Without "remember", the key lives in memory until the page is closed.
const KEY = 'flowsketch:anthropicKey';
const MODEL = 'flowsketch:aiModel';
let sessionKey = '';

export function savedKey(): string {
  try { return cleanKey(localStorage.getItem(KEY)) || sessionKey; } catch { return sessionKey; }
}
export function isKeyRemembered(): boolean {
  try { return !!cleanKey(localStorage.getItem(KEY)); } catch { return false; }
}
export function storeKey(key: string, remember: boolean): void {
  sessionKey = cleanKey(key);
  try { if (remember && sessionKey) localStorage.setItem(KEY, sessionKey); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
export function forgetKey(): void { storeKey('', false); }
export function savedModel(): AiModel {
  try {
    const m = localStorage.getItem(MODEL);
    return AI_MODELS.some((x) => x.id === m) ? (m as AiModel) : DEFAULT_MODEL;
  } catch { return DEFAULT_MODEL; }
}
export function storeModel(m: AiModel): void { try { localStorage.setItem(MODEL, m); } catch { /* storage unavailable */ } }
