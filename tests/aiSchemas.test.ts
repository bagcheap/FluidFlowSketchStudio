import { describe, expect, it } from 'vitest';
import { MAX_OPTIONAL_PARAMS, MAX_STRICT_TOOLS, MAX_UNION_PARAMS, strictBudget, toolDefinitions } from '../src/ai/toolkit';
import { EDIT_SCHEMA } from '../src/ai/edits';
import { FINDINGS_TOOL } from '../src/ai/review';
import { agentTools, FINISH_TOOL } from '../src/ai/agent';
import { apiDetail } from '../src/ai/describe';

// Strict tools and structured outputs accept only a subset of JSON schema. The fake API in the other tests can't
// catch a schema the real API rejects, so check the rules here.
function problems(node: unknown, path: string, out: string[]) {
  if (Array.isArray(node)) { node.forEach((n, i) => problems(n, `${path}[${i}]`, out)); return; }
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.type) && n.enum) out.push(`${path}: enum with a list of types (use anyOf with {type:'null'})`);
  if (typeof n.type === 'string' && Array.isArray(n.enum)) {
    const want = n.type === 'integer' ? 'number' : n.type;
    for (const v of n.enum) if (typeof v !== want) out.push(`${path}: enum value ${JSON.stringify(v)} is not a ${n.type}`);
  }
  if (n.type === 'object' && n.properties) {
    if (n.additionalProperties !== false) out.push(`${path}: object without additionalProperties: false`);
    const keys = Object.keys(n.properties as object).sort();
    const req = [...((n.required as string[]) ?? [])].sort();
    if (JSON.stringify(keys) !== JSON.stringify(req)) out.push(`${path}: required ≠ properties`);
  }
  for (const [k, v] of Object.entries(n)) if (k !== 'enum') problems(v, `${path}.${k}`, out);
}

describe('AI schemas', () => {
  it('every tool and output schema follows the strict-mode rules', () => {
    const out: string[] = [];
    for (const t of toolDefinitions()) problems(t.input_schema, t.name, out);
    problems(EDIT_SCHEMA, 'EDIT_SCHEMA', out);
    problems(FINDINGS_TOOL.input_schema, 'report_findings', out);
    problems(FINISH_TOOL.input_schema, 'finish', out);
    expect(out).toEqual([]);
  });

  it('each request stays within the API limits for strict schemas (20 strict tools, 16 union fields, 24 optional fields)', () => {
    const within = (b: { strict: number; unions: number; optional: number }) => {
      expect(b.strict).toBeLessThanOrEqual(MAX_STRICT_TOOLS);
      expect(b.unions).toBeLessThanOrEqual(MAX_UNION_PARAMS);
      expect(b.optional).toBeLessThanOrEqual(MAX_OPTIONAL_PARAMS);
    };
    for (const pictures of [true, false]) within(strictBudget(agentTools(pictures)));
    within(strictBudget([FINDINGS_TOOL]));
    within(strictBudget([{ strict: true, input_schema: EDIT_SCHEMA }])); // Quick change: structured output
    // tools that take input are strict; tools without input are not (nothing to enforce, and they'd use up the limit)
    for (const t of toolDefinitions()) expect((t as { strict?: boolean }).strict).toBeUndefined();
    expect(strictBudget(agentTools(true))).toEqual({ strict: 1, unions: 0, optional: 0 }); // only finish: a large strict set compiles to a grammar the API rejects
  });

  it('nullable choices still allow null', () => {
    const add = toolDefinitions().find((t) => t.name === 'add_shape')!.input_schema as { properties: Record<string, { anyOf: { type: string; enum?: string[] }[] }> };
    expect(add.properties.place.anyOf).toEqual([{ type: 'string', enum: ['right', 'left', 'above', 'below'] }, { type: 'null' }]);
    expect(add.properties.near.anyOf.map((x) => x.type)).toEqual(['string', 'null']);
  });

  it('API errors read as the plain message, not raw JSON', () => {
    const e = { message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"tools.5: bad"}}', error: { type: 'error', error: { type: 'invalid_request_error', message: 'tools.5: bad' } } };
    expect(apiDetail(e)).toBe('tools.5: bad');
    expect(apiDetail({ message: 'plain' })).toBe('plain');
    expect(apiDetail({})).toBe('the request was not valid.');
  });
});
