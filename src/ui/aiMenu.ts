// The AI menu (top menu bar) and the AI ▸ submenu of the canvas right-click menu: every feature that uses Claude, in
// one place. They all need internet and the user's own Anthropic API key, cost money and send content to Anthropic,
// so they are kept apart from the rest of the editor.
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';
import { forgetKey } from '../ai/keyStore';
import type { MenuItem } from './MenuBar';

export function aiMenuItems(): MenuItem[] {
  const ui = useUI.getState();
  return [
    { label: 'Describe a diagram…', note: 'draw it from a description', run: () => ui.openDialog('ai') },
    { label: 'Review this page', sub: [
      { label: 'Run review…', note: 'check it’s right', run: () => ui.openDialog('aiReview') },
      { label: 'Show last review', note: 'with what’s fixed', disabled: !cmd.hasLastReview(), run: () => void cmd.showLastReview() },
    ] },
    { label: 'Edit with Claude…', note: 'step by step, with preview', run: () => cmd.openAgent() },
    { label: 'Quick change…', note: 'in one go', run: () => ui.openDialog('aiEdit') },
    { label: 'Improve the look…', note: 'layout, scored', run: () => cmd.improveLook() },
    { sep: true },
    { label: 'Forget saved API key', run: () => void forgetKey().then(() => ui.toast('The saved API key was removed from this computer', 'success')) },
  ];
}
