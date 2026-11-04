import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { Badge, Button, Card, Input, PageHeader, Stat } from '../components/ui.tsx';
import { useToast } from '../state/app.tsx';
import type { FocusSessionDto } from '@lumen/shared';

const PRESETS = [15, 25, 45, 50];

// Web Audio API Ambient Noise & Chime Engine
class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private binauralOsc1: OscillatorNode | null = null;
  private binauralOsc2: OscillatorNode | null = null;
  private binauralGain: GainNode | null = null;
  private rainNode: AudioNode | null = null;
  private rainGain: GainNode | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  // Play two-tone meditation bell chime
  public playChime() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.35); // A5

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 1.8);
    } catch (e) {
      console.warn('Audio chime requires user gesture first', e);
    }
  }

  // Toggle 40Hz Gamma Binaural Beats (200Hz Left, 240Hz Right)
  public toggleBinaural(volume = 0.08): boolean {
    const ctx = this.getContext();
    if (this.binauralOsc1) {
      this.binauralOsc1.stop();
      this.binauralOsc2?.stop();
      this.binauralOsc1 = null;
      this.binauralOsc2 = null;
      return false;
    }

    const merger = ctx.createChannelMerger(2);
    this.binauralGain = ctx.createGain();
    this.binauralGain.gain.setValueAtTime(volume, ctx.currentTime);

    // Left channel: 200 Hz
    this.binauralOsc1 = ctx.createOscillator();
    this.binauralOsc1.type = 'sine';
    this.binauralOsc1.frequency.setValueAtTime(200, ctx.currentTime);

    // Right channel: 240 Hz (producing 40Hz gamma beat difference)
    this.binauralOsc2 = ctx.createOscillator();
    this.binauralOsc2.type = 'sine';
    this.binauralOsc2.frequency.setValueAtTime(240, ctx.currentTime);

    this.binauralOsc1.connect(merger, 0, 0);
    this.binauralOsc2.connect(merger, 0, 1);
    merger.connect(this.binauralGain);
    this.binauralGain.connect(ctx.destination);

    this.binauralOsc1.start();
    this.binauralOsc2.start();
    return true;
  }

  // Toggle procedural Rain / Pink noise
  public toggleRain(volume = 0.12): boolean {
    const ctx = this.getContext();
    if (this.rainNode) {
      if ('stop' in this.rainNode && typeof this.rainNode.stop === 'function') {
        this.rainNode.stop();
      }
      this.rainNode = null;
      return false;
    }

    // Generate 3 seconds of pink noise buffer
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      data[i] = (b0 + b1 + b2) * 0.15;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    // Gentle low-pass filter to sound like soft rainfall
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);

    this.rainGain = ctx.createGain();
    this.rainGain.gain.setValueAtTime(volume, ctx.currentTime);

    noiseSource.connect(filter);
    filter.connect(this.rainGain);
    this.rainGain.connect(ctx.destination);

    noiseSource.start();
    this.rainNode = noiseSource;
    return true;
  }

  public stopAll() {
    if (this.binauralOsc1) {
      this.binauralOsc1.stop();
      this.binauralOsc2?.stop();
      this.binauralOsc1 = null;
      this.binauralOsc2 = null;
    }
    if (this.rainNode && 'stop' in this.rainNode && typeof this.rainNode.stop === 'function') {
      this.rainNode.stop();
      this.rainNode = null;
    }
  }
}

const ambientAudio = new AmbientAudioEngine();

export function FocusPage() {
  const { notify } = useToast();
  const [minutes, setMinutes] = useState(25);
  const [label, setLabel] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<FocusSessionDto[]>([]);
  const startedRef = useRef<number | null>(null);

  // Sound States
  const [binauralActive, setBinauralActive] = useState(false);
  const [rainActive, setRainActive] = useState(false);

  const load = () => void api.get<{ sessions: FocusSessionDto[] }>('/api/focus').then((d) => setSessions(d.sessions));
  useEffect(load, []);

  // Clean up sounds on unmount
  useEffect(() => {
    return () => {
      ambientAudio.stopAll();
    };
  }, []);

  useEffect(() => {
    if (!running || remaining === null) return;
    if (remaining <= 0) {
      setRunning(false);
      ambientAudio.playChime();
      const startedAt = startedRef.current ? new Date(startedRef.current) : new Date();
      void api
        .post('/api/focus', { label, minutes, startedAt: startedAt.toISOString() })
        .then(() => {
          notify(`Focus session complete — ${minutes} minutes logged! 🔔`);
          load();
        });
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r !== null ? r - 1 : r)), 1000);
    return () => clearTimeout(t);
  }, [running, remaining, label, minutes, notify]);

  const start = () => {
    startedRef.current = Date.now();
    setRemaining(minutes * 60);
    setRunning(true);
    ambientAudio.playChime(); // Gentle chime on start
  };

  const stop = () => {
    setRunning(false);
    setRemaining(null);
    startedRef.current = null;
  };

  const toggleBinauralSound = () => {
    const active = ambientAudio.toggleBinaural();
    setBinauralActive(active);
  };

  const toggleRainSound = () => {
    const active = ambientAudio.toggleRain();
    setRainActive(active);
  };

  const mm = remaining === null ? minutes : Math.floor(remaining / 60);
  const ss = remaining === null ? 0 : remaining % 60;

  return (
    <div>
      <PageHeader
        title="Focus & Study Hall"
        subtitle="Timed deep work sessions with Web Audio ambient acoustics and chime notifications"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button size="sm" onClick={() => ambientAudio.playChime()} title="Test completion bell chime">
              🔔 Test Bell
            </Button>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        
        {/* Main Timer Column */}
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card>
            <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 72, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
                {running ? (label ? `Focusing on: ${label}` : 'Deep focus in progress…') : 'Ready when you are'}
              </div>

              {!running && (
                <>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 'var(--space-3)' }}>
                    {PRESETS.map((p) => (
                      <Button key={p} variant={minutes === p ? 'primary' : 'secondary'} size="sm" onClick={() => setMinutes(p)}>
                        {p}m
                      </Button>
                    ))}
                  </div>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="What are you studying? (e.g., Cardiology, Criminal Law)"
                    style={{ maxWidth: 360, margin: '0 auto var(--space-3) auto' }}
                  />
                  <div>
                    <Button variant="primary" onClick={start}>
                      Start {minutes}-Minute Focus
                    </Button>
                  </div>
                </>
              )}

              {running && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <Button variant="danger" onClick={stop}>
                    Discard Session
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Web Audio Ambient Soundboard */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div>
                <h3 style={{ fontSize: 'var(--text-base)', margin: 0, fontWeight: 600 }}>🎧 Ambient Sound Mixer</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  Synthesized locally in your browser using the Web Audio API. Zero streaming bandwidth.
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              {/* Sound 1: 40Hz Binaural Beats */}
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 6,
                  border: '1px solid var(--hairline)',
                  background: binauralActive ? 'var(--accent-soft)' : 'var(--surface-2)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>40Hz Gamma Beats</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>Cognitive Focus (Wear Headphones)</div>
                </div>
                <Button size="sm" variant={binauralActive ? 'primary' : 'secondary'} onClick={toggleBinauralSound}>
                  {binauralActive ? 'Playing' : 'Play'}
                </Button>
              </div>

              {/* Sound 2: Rainy Library */}
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 6,
                  border: '1px solid var(--hairline)',
                  background: rainActive ? 'var(--accent-soft)' : 'var(--surface-2)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Rainy Library</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>Filtered Soft Pink Noise</div>
                </div>
                <Button size="sm" variant={rainActive ? 'primary' : 'secondary'} onClick={toggleRainSound}>
                  {rainActive ? 'Playing' : 'Play'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar: Presence & Session Logs */}
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {/* Virtual Focus Hall Presence */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', margin: 0, fontWeight: 600 }}>Silent Study Hall</h3>
              <Badge tone="accent">● 3 Online</Badge>
            </div>
            <div style={{ display: 'grid', gap: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 4 }}>
                <span style={{ fontWeight: 600 }}>You</span>
                <span style={{ color: 'var(--accent)' }}>{running ? (label || 'Focusing') : 'Idle'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 4 }}>
                <span>Sarah M.</span>
                <span style={{ color: 'var(--accent)' }}>Focusing: Renal Pathology</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 4 }}>
                <span>David K.</span>
                <span style={{ color: 'var(--warning)' }}>On 5m Break</span>
              </div>
            </div>
          </Card>

          <Stat label="Recent sessions" value={sessions.length} hint="Last 30 logged" />
          
          <Card pad={false}>
            {sessions.length === 0 ? (
              <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                No sessions logged yet.
              </div>
            ) : (
              sessions.slice(0, 10).map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--hairline)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  <span>{s.label || 'Focus session'}</span>
                  <span style={{ color: 'var(--text-faint)' }}>
                    {s.minutes}m · {new Date(s.startedAt).toLocaleDateString()}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>

      </div>
    </div>
  );
}
