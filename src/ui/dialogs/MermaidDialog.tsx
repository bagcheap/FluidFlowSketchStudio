// Insert ▸ Diagram from text: type or paste a Mermaid flowchart, see what will be added, insert it laid out.
import { useMemo, useState } from 'react';
import { useUI } from '../../store/uiStore';
import * as cmd from '../../store/commands';
import { parseMermaid } from '../../import/mermaid';
import type { LayoutDir } from '../../layout/layered';
import { Modal } from './Modal';
import { Segmented } from '../controls';

const EXAMPLE = `flowchart LR
  User([User]) --> GE[GE]
  GE -->|query| MCP[(DataBricks Genie MCP Server)]
  subgraph GCP
    GE
    MCP
  end`;

type DirChoice = 'auto' | LayoutDir;

export function MermaidDialog() {
  const [text, setText] = useState(EXAMPLE);
  const [dir, setDir] = useState<DirChoice>('auto');
  const g = useMemo(() => parseMermaid(text), [text]);
  const close = () => useUI.getState().openDialog(null);
  const insert = () => { if (cmd.importMermaid(text, dir === 'auto' ? undefined : dir)) close(); };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return (
    <Modal title="Diagram from text" wide footer={<>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn primary" data-testid="mermaid-insert" disabled={!g.nodes.length} onClick={insert}>Insert diagram</button>
    </>}>
      <p className="note">Type or paste a <b>Mermaid flowchart</b>. Each name becomes a shape, each arrow an animated arrow, and each <code>subgraph</code> a container. You can also paste text like <code>User --&gt; GE --&gt; MCP Server</code> straight onto the canvas.</p>
      <textarea className="mermaid-text" aria-label="Flowchart text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); insert(); } }} />
      <div className="mermaid-row">
        <span className="row-label">Layout</span>
        <Segmented label="Layout direction" value={dir} onChange={(v) => setDir(v)} options={[
          { v: 'auto', label: `From text (${g.dir})` }, { v: 'LR', label: 'Left → right' }, { v: 'TB', label: 'Top → bottom' },
          { v: 'RL', label: 'Right → left' }, { v: 'BT', label: 'Bottom → top' },
        ]} />
      </div>
      <p className={`note ${g.nodes.length ? 'ok' : ''}`} aria-live="polite">
        {g.nodes.length ? `Will add ${plural(g.nodes.length, 'shape')}, ${plural(g.edges.length, 'arrow')}${g.groups.length ? ` and ${plural(g.groups.length, 'container')}` : ''}.` : 'No shapes yet.'}
        {g.warnings.length > 0 && <> Skipped: {g.warnings.slice(0, 3).join('; ')}{g.warnings.length > 3 ? ' …' : ''}</>}
      </p>
      <details className="note">
        <summary>Syntax</summary>
        <code>A[Box]</code> · <code>A(Rounded)</code> · <code>A([Pill])</code> · <code>A{'{'}Decision{'}'}</code> · <code>A((Circle))</code> · <code>A[(Database)]</code> · <code>A{'{{'}Hexagon{'}}'}</code> · <code>A[/Input/]</code><br />
        <code>A --&gt; B</code> arrow · <code>A --- B</code> line · <code>A -.-&gt; B</code> dashed · <code>A ==&gt; B</code> thick · <code>A &lt;--&gt; B</code> both ways · <code>A --&gt;|yes| B</code> or <code>A -- yes --&gt; B</code> label · <code>A &amp; B --&gt; C</code><br />
        <code>subgraph Title</code> … <code>end</code> makes a container. First line <code>flowchart LR</code> (or TB, RL, BT) sets the direction.
      </details>
    </Modal>
  );
}
