// Built-in sample diagrams / templates. Generated in code so they always match the current schema.
import type { ConnectorAnim, ConnectorElement, FlowDocument, Routing, ShapeAnim, ShapeElement, ShapeKind } from '../model/types';
import { DEFAULT_STYLE, DEFAULT_TEXT, defaultToolStyle, makeConnector, makeShape, makeText, newDocument } from '../model/defaults';
import { fitShapeToText } from '../store/commands';

interface BoxOpts { fill?: string; stroke?: string; font?: number; anim?: Partial<ShapeAnim>; bold?: boolean; fillStyle?: ShapeElement['style']['fillStyle']; radius?: number; color?: string; shadow?: boolean; family?: 'hand' | 'sans' }
interface ArrowOpts { label?: string; anim?: Partial<ConnectorAnim>; color?: string; routing?: Routing; from?: [number, number]; to?: [number, number]; dashed?: boolean; curvature?: number; bends?: [number, number][]; both?: boolean; head?: 'arrow' | 'triangle' | 'none' }

function builder(title: string, bg = '#fbfaf7') {
  const doc = newDocument(title);
  doc.canvas.background = bg;
  let seed = 1000;
  const byId = new Map<string, ShapeElement>();
  const box = (kind: ShapeKind, x: number, y: number, w: number, h: number, text = '', o: BoxOpts = {}) => {
    const ts = defaultToolStyle(`shape:${kind}`);
    const el = makeShape(kind, x, y, w, h, ts);
    el.id = `s${doc.elements.length + 1}`;
    el.seed = seed += 7919;
    el.text = text;
    el.style = { ...DEFAULT_STYLE, ...ts.style, ...(o.fill ? { fill: o.fill, fillStyle: o.fill === 'transparent' ? 'none' : (o.fillStyle ?? 'solid') } : {}), ...(o.stroke ? { stroke: o.stroke } : {}), ...(o.radius !== undefined ? { cornerRadius: o.radius } : {}), ...(o.shadow ? { shadow: true } : {}) };
    el.textStyle = { ...DEFAULT_TEXT, fontSize: o.font ?? 20, bold: !!o.bold, color: o.color ?? DEFAULT_TEXT.color, fontFamily: o.family ?? 'hand' };
    if (o.anim) el.anim = o.anim;
    const fitted = fitShapeToText(el) as ShapeElement;
    doc.elements.push(fitted);
    byId.set(fitted.id, fitted);
    return fitted.id;
  };
  const text = (x: number, y: number, t: string, size = 20, color = '#1e1e2e', bold = false) => {
    const el = makeText(x, y, t, defaultToolStyle('text'));
    el.id = `t${doc.elements.length + 1}`;
    el.seed = seed += 7919;
    el.textStyle = { ...DEFAULT_TEXT, fontSize: size, color, bold, align: 'left', vAlign: 'top', padding: 2 };
    doc.elements.push(fitShapeToText(el));
  };
  const arrow = (a: string, b: string, o: ArrowOpts = {}) => {
    const ts = defaultToolStyle('arrow');
    const c: ConnectorElement = makeConnector(
      { x: 0, y: 0, elementId: a, anchor: o.from ? { x: o.from[0], y: o.from[1] } : null },
      { x: 0, y: 0, elementId: b, anchor: o.to ? { x: o.to[0], y: o.to[1] } : null }, ts);
    c.id = `c${doc.elements.length + 1}`;
    c.seed = seed += 7919;
    c.routing = o.routing ?? 'curved';
    c.curvature = o.curvature ?? 0;
    c.bends = (o.bends ?? []).map(([x, y]) => ({ x, y }));
    c.text = o.label ?? '';
    c.textStyle = { ...DEFAULT_TEXT, fontSize: 16, color: '#4b5563', padding: 4 };
    c.style = { ...c.style, stroke: o.color ?? '#4b5563', strokeStyle: o.dashed ? 'dashed' : 'solid' };
    if (o.both) c.startHead = 'arrow';
    if (o.head) c.endHead = o.head;
    if (o.anim) c.anim = o.anim;
    doc.elements.push(c);
    return c.id;
  };
  return { doc, box, arrow, text };
}

export interface Sample { id: string; title: string; description: string; build: () => FlowDocument }

const BLUE = '#d9ecff', LAV = '#e7e3ff', GREEN = '#d6f5df', YEL = '#fff4c2', PINK = '#ffe3e3', GREY = '#eef0f3', MINT = '#c3fae8';

export const SAMPLES: Sample[] = [
  {
    id: 'agent', title: 'How an AI agent works', description: 'Question → agent → tools → evidence, with flowing arrows and a green return path.',
    build: () => {
      const { doc, box, arrow, text } = builder('How an AI agent works');
      text(330, -10, 'How an agent answers', 40, '#1e1e2e', true);
      const q = box('speech', 0, 110, 300, 80, 'How does this feature work?', { fill: '#ffffff', font: 20 });
      const user = box('ellipse', 80, 260, 120, 120, 'you', { fill: YEL });
      const agent = box('roundRect', 300, 270, 160, 100, 'your agent', { fill: BLUE });
      const core = box('roundRect', 560, 260, 200, 120, 'Research\nengine', { fill: LAV, font: 26, bold: true });
      const t1 = box('pill', 900, 140, 230, 60, 'Code search', { fill: GREY });
      const t2 = box('pill', 900, 290, 230, 60, 'Browser DevTools', { fill: GREY });
      const t3 = box('pill', 900, 440, 230, 60, 'Docs reader', { fill: GREY });
      const out = box('document', 600, 500, 120, 110, 'report', { fill: '#ffffff', font: 18 });
      arrow(user, agent); arrow(agent, core);
      arrow(core, t1, { anim: { segments: 2 } }); arrow(core, t2, { anim: { segments: 2 } }); arrow(core, t3, { anim: { segments: 2 } });
      arrow(core, out, { color: '#2f9e44', anim: { highlightColor: '#22c55e' } });
      arrow(out, agent, { color: '#2f9e44', curvature: -0.35, anim: { mode: 'drawOn', highlightColor: '#22c55e' } });
      void q;
      box('pill', 420, 680, 110, 50, 'code', { fill: BLUE, font: 18 });
      box('pill', 560, 680, 110, 50, 'proof', { fill: GREEN, font: 18 });
      box('pill', 700, 680, 130, 50, 'unknowns', { fill: GREY, font: 18 });
      return doc;
    },
  },
  {
    id: 'request', title: 'Software request / response', description: 'Browser → gateway → service → cache/database, with a reverse response flow.',
    build: () => {
      const { doc, box, arrow, text } = builder('Request / response flow');
      text(0, -70, 'A request’s round trip', 34, '#1e1e2e', true);
      const br = box('roundRect', 0, 60, 160, 90, 'Browser', { fill: BLUE });
      const gw = box('hexagon', 260, 60, 180, 90, 'API gateway', { fill: LAV });
      const svc = box('roundRect', 540, 60, 170, 90, 'Orders service', { fill: GREEN });
      const cache = box('diamond', 560, 230, 140, 110, 'In cache?', { fill: YEL, font: 18 });
      const db = box('cylinder', 820, 210, 130, 150, 'Postgres', { fill: GREY });
      arrow(br, gw, { label: 'HTTPS' });
      arrow(gw, svc, { label: 'auth ✓' });
      arrow(svc, cache, { routing: 'straight' });
      arrow(cache, db, { label: 'miss', routing: 'elbow' });
      arrow(cache, br, { label: 'hit → JSON', color: '#2f9e44', routing: 'elbow', anim: { highlightColor: '#22c55e', segments: 2 }, from: [0.5, 1], to: [0.5, 1] , bends: [[630, 420], [80, 420]] });
      return doc;
    },
  },
  {
    id: 'approval', title: 'Business approval process', description: 'A decision with yes/no branches and an elbow loop back for revisions.',
    build: () => {
      const { doc, box, arrow } = builder('Purchase approval');
      const s = box('pill', 0, 40, 160, 60, 'Start', { fill: GREEN, bold: true });
      const sub = box('roundRect', 230, 30, 180, 80, 'Submit request', { fill: '#ffffff' });
      const rev = box('diamond', 480, 10, 180, 120, 'Manager approves?', { fill: YEL, font: 18 });
      const fin = box('roundRect', 740, 30, 170, 80, 'Finance pays', { fill: BLUE });
      const done = box('pill', 980, 40, 140, 60, 'Done', { fill: GREEN, bold: true });
      const fix = box('roundRect', 480, 220, 180, 80, 'Revise & explain', { fill: PINK });
      arrow(s, sub); arrow(sub, rev);
      arrow(rev, fin, { label: 'yes', color: '#2f9e44', anim: { highlightColor: '#22c55e' } });
      arrow(fin, done);
      arrow(rev, fix, { label: 'no', color: '#e03131', routing: 'straight', anim: { highlightColor: '#ef4444' } });
      arrow(fix, sub, { routing: 'elbow', dashed: true, anim: { mode: 'dash' }, from: [0, 0.5], to: [0.5, 1] });
      return doc;
    },
  },
  {
    id: 'science', title: 'Scientific experiment workflow', description: 'Hypothesis to conclusion with an iterate loop; draw-on arrows.',
    build: () => {
      const { doc, box, arrow } = builder('Experimental workflow', '#f6f7fb');
      const steps = [['Hypothesis', LAV, 'cloud'], ['Design\nexperiment', BLUE, 'roundRect'], ['Run trials', GREEN, 'roundRect'], ['Collect data', '#ffffff', 'document'], ['Analyse', YEL, 'hexagon']] as const;
      const ids = steps.map(([t, f, k], i) => box(k as ShapeKind, i * 230 - (k === 'cloud' ? 30 : 0), k === 'cloud' ? -15 : 0, k === 'cloud' ? 210 : 170, k === 'cloud' ? 110 : 90, t, { fill: f, anim: { phase: i * 0.17 } }));
      for (let i = 0; i < ids.length - 1; i++) arrow(ids[i], ids[i + 1], { anim: { mode: 'drawOn', delay: 0 } });
      const ok = box('diamond', 885, 165, 200, 130, 'Supported?', { fill: PINK, font: 18 });
      const pub = box('sticky', 1150, 160, 150, 130, 'Publish 🎉', { fill: '#fde68a', shadow: true });
      arrow(ids[4], ok, { routing: 'straight' });
      arrow(ok, pub, { label: 'yes', color: '#2f9e44', anim: { highlightColor: '#22c55e' } });
      arrow(ok, ids[0], { label: 'refine', routing: 'elbow', color: '#7048e8', anim: { highlightColor: '#8b5cf6', segments: 3 }, from: [0.5, 1], to: [0.5, 1], bends: [[985, 380], [90, 380]] });
      return doc;
    },
  },
  {
    id: 'loop', title: 'Circular feedback loop', description: 'Build–measure–learn style cycle with curved arrows and sway motion.',
    build: () => {
      const { doc, box, arrow, text } = builder('Feedback loop');
      const R = 210, cx = 300, cy = 260;
      const names = [['Build', BLUE], ['Measure', GREEN], ['Learn', YEL], ['Decide', LAV]] as const;
      const ids = names.map(([n, f], i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 2;
        return box('ellipse', cx + Math.cos(a) * R - 75, cy + Math.sin(a) * R - 50, 150, 100, n, { fill: f, font: 22, bold: true, anim: { mode: 'sway', intensity: 3 } });
      });
      for (let i = 0; i < 4; i++) arrow(ids[i], ids[(i + 1) % 4], { curvature: -0.45, anim: { segments: 1, speed: 0.5 } });
      text(cx - 70, cy - 22, 'every week', 26, '#7048e8');
      return doc;
    },
  },
  {
    id: 'decision', title: 'Decision tree', description: 'Branching yes/no decisions down to outcomes.',
    build: () => {
      const { doc, box, arrow } = builder('Should we build it?');
      const q1 = box('diamond', 360, 0, 200, 120, 'Users asked for it?', { fill: YEL, font: 18 });
      const q2 = box('diamond', 100, 200, 190, 120, 'Cheap to try?', { fill: YEL, font: 18 });
      const q3 = box('diamond', 640, 200, 190, 120, 'Strategic?', { fill: YEL, font: 18 });
      const a1 = box('roundRect', 0, 410, 160, 70, 'Prototype it', { fill: GREEN });
      const a2 = box('roundRect', 220, 410, 160, 70, 'Interview users', { fill: BLUE });
      const a3 = box('roundRect', 560, 410, 160, 70, 'Plan for Q3', { fill: LAV });
      const a4 = box('roundRect', 780, 410, 160, 70, 'Say no, kindly', { fill: PINK });
      const yes = { color: '#2f9e44', anim: { highlightColor: '#22c55e' } }, no = { color: '#e03131', anim: { highlightColor: '#ef4444' } };
      arrow(q1, q2, { label: 'yes', ...yes, routing: 'elbow', from: [0, 0.5], to: [0.5, 0] }); arrow(q1, q3, { label: 'no', ...no, routing: 'elbow', from: [1, 0.5], to: [0.5, 0] });
      arrow(q2, a1, { label: 'yes', ...yes }); arrow(q2, a2, { label: 'no', ...no });
      arrow(q3, a3, { label: 'yes', ...yes }); arrow(q3, a4, { label: 'no', ...no });
      return doc;
    },
  },
  {
    id: 'architecture', title: 'System architecture', description: 'Clients, load balancer, services, queue and storage with a sticky note.',
    build: () => {
      const { doc, box, arrow, text } = builder('System architecture', '#ffffff');
      text(0, -60, 'Photo sharing — v2 architecture', 30, '#1e1e2e', true);
      const web = box('roundRect', 0, 40, 150, 70, 'Web app', { fill: BLUE });
      const mob = box('roundRect', 0, 160, 150, 70, 'Mobile app', { fill: BLUE });
      const lb = box('parallelogram', 230, 95, 170, 80, 'Load balancer', { fill: GREY, font: 18 });
      const api = box('roundRect', 470, 40, 160, 70, 'API', { fill: LAV });
      const up = box('roundRect', 470, 170, 160, 70, 'Upload service', { fill: LAV, font: 18 });
      const q = box('pill', 700, 175, 150, 60, 'Job queue', { fill: YEL, font: 18 });
      const wk = box('roundRect', 910, 165, 160, 80, 'Thumbnail workers', { fill: MINT, font: 18 });
      const db = box('cylinder', 720, 0, 120, 130, 'Metadata DB', { fill: GREEN, font: 16 });
      const s3 = box('cylinder', 930, 330, 130, 130, 'Object storage', { fill: GREEN, font: 16 });
      box('sticky', 260, 290, 190, 150, 'TODO: add CDN in front of storage', { fill: '#fde68a', font: 18, shadow: true, anim: { mode: 'sway', intensity: 4 } });
      arrow(web, lb); arrow(mob, lb);
      arrow(lb, api); arrow(lb, up);
      arrow(api, db, { both: true, anim: { mode: 'pulse' } });
      arrow(up, q); arrow(q, wk, { anim: { segments: 3, highlightLength: 18 } });
      arrow(wk, s3, { routing: 'straight' });
      arrow(up, s3, { routing: 'elbow', dashed: true, label: 'original', anim: { mode: 'dash' }, from: [0.5, 1], to: [0, 0.5] });
      return doc;
    },
  },
];

export const STARTER_ID = 'agent';
