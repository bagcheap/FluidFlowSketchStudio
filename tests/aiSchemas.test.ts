import { describe, expect, it } from 'vitest';
import { toolDefinitions } from '../src/ai/toolkit';
import { EDIT_SCHEMA } from '../src/ai/edits';
import { FINDINGS_TOOL } from '../src/ai/review';
import { FINISH_TOOL } from '../src/ai/agent';
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
