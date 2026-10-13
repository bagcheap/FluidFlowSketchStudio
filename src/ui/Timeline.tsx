import { Film, Pause, Play, Repeat, RotateCcw, Settings2, Square, Zap, ZapOff } from 'lucide-react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';

export function Timeline() {
  const a = useDoc((s) => s.doc.animation);
  const playing = useUI((s) => s.playing);
  const time = useUI((s) => s.time);
  const zoom = useUI((s) => s.view.zoom);
  const reducedOS = useUI((s) => s.reducedMotionOS);
  const ui = useUI.getState();
  return (
    <div className="timeline no-canvas" role="group" aria-label="Animation playback">
      <button className="icon-btn play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (K)' : 'Play (K)'} onClick={cmd.togglePlay} data-testid="play">
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button className="icon-btn" aria-label="Stop and reset" title="Stop & reset to 0" onClick={cmd.stop}><Square size={15} /></button>
      <button className="icon-btn" aria-label="Restart" title="Restart (Shift+K)" onClick={cmd.restart}><RotateCcw size={15} /></button>
      <span className="time-readout" aria-live="off">{time.toFixed(2)}<span className="dim"> / {a.duration.toFixed(1)}s</span></span>
      <input
        className="scrubber"
        type="range"
        aria-label="Timeline position"
        min={0}
        max={a.duration}
        step={0.01}
        value={Math.min(time, a.duration)}
        onChange={(e) => { ui.setPlaying(false); ui.setTime(Number(e.target.value)); }}
        style={{ ['--p' as string]: `${(Math.min(time, a.duration) / a.duration) * 100}%` }}
      />
      <label className="tl-field" title="Loop duration (seconds)">
        <span>Length</span>
        <input type="number" min={0.5} max={120} step={0.5} value={a.duration} aria-label="Animation duration in seconds" onChange={(e) => { const v = Number(e.target.value); if (v >= 0.5 && v <= 120) cmd.setAnimation({ duration: v }, 'duration'); }} />
        <span className="dim">s</span>
      </label>
      <label className="tl-field" title="Playback speed">
        <select aria-label="Playback speed" value={a.playbackSpeed} onChange={(e) => cmd.setAnimation({ playbackSpeed: Number(e.target.value) })}>
          {[0.25, 0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
      <button className={`icon-btn ${a.loop ? 'on' : ''}`} aria-pressed={a.loop} aria-label="Loop" title="Loop" onClick={() => cmd.setAnimation({ loop: !a.loop })}><Repeat size={15} /></button>
      <button className={`icon-btn ${a.enabled ? 'on' : ''}`} aria-pressed={a.enabled} aria-label="Animation on/off" title={a.enabled ? 'Animation on — click to turn all motion off' : 'Animation off'} onClick={() => cmd.setAnimation({ enabled: !a.enabled })}>{a.enabled ? <Zap size={15} /> : <ZapOff size={15} />}</button>
      <button className="icon-btn" aria-label="Animation settings" title="Global animation settings" onClick={() => ui.openDialog('animation')}><Settings2 size={15} /></button>
      {reducedOS && !playing && <span className="rm-note" title="Your system asks for reduced motion, so playback does not start automatically.">Reduced motion: press play to preview</span>}
      <span className="tl-spacer" />
      <button className="tl-zoom" title="Zoom — click to fit" onClick={cmd.zoomToFit}>{Math.round(zoom * 100)}%</button>
      <button className="btn small" onClick={() => ui.openDialog('gif')}><Film size={14} /> GIF</button>
    </div>
  );
}
