/**
 * Sonidos de RoboLab, sintetizados con Web Audio (sin archivos, sin licencias, sin red).
 * Pensados para niños: cortos (menos de 200 ms los de interfaz, solo el éxito pasa de 1 s),
 * ondas seno o triángulo, nada agudo ni seco (entre 400 Hz y 2,5 kHz), y el error nunca más fuerte que el acierto.
 * El audio se crea al sonar el primero (siempre tras un gesto del niño: el navegador no lo
 * permite antes). Todo sonido tiene su equivalente visual: el sonido nunca es la única señal.
 */

export type SoundName = "place" | "remove" | "play" | "step" | "win" | "oops";

const KEY = "robolab.sonido";
const VOLUME_KEY = "robolab.volumen";

export type Volume = "low" | "medium" | "high";
export const VOLUMES: readonly Volume[] = ["low", "medium", "high"];
/**
 * Ganancia general por nivel. «Medio» deja cada nota en su pico objetivo (éxito ≈ -7 dBFS);
 * «Bajo» (-8 dB) queda cerca de lo que sonaba antes; «Alto» (+3,5 dB) deja el éxito en ≈ -3,5 dBFS,
 * todavía por debajo del tope de -1 dBFS que además vigila el limitador de la salida.
 */
export const VOLUME_GAIN: Record<Volume, number> = { low: 0.4, medium: 1, high: 1.5 };

let muted = readMuted();
let volume = readVolume();
let context: AudioContext | null = null;
let master: GainNode | null = null;
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}

function readVolume(): Volume {
  try {
    const saved = window.localStorage.getItem(VOLUME_KEY);
    return VOLUMES.find((v) => v === saved) ?? "medium";
  } catch {
    return "medium";
  }
}

export const getVolume = (): Volume => volume;

export function setVolume(value: Volume): void {
  if (value === volume) return;
  volume = value;
  try {
    window.localStorage.setItem(VOLUME_KEY, value);
  } catch {
    // Sin almacenamiento: la elección dura lo que dure la pestaña.
  }
  if (master) master.gain.value = VOLUME_GAIN[value];
  listeners.forEach((l) => l());
}

/** Hasta aquí la señal pasa intacta; por encima se aplana con suavidad hasta CEILING (-1 dBFS). */
const KNEE = 0.7;
const CEILING = 0.89;

/** Limitador suave: identidad bajo KNEE y curva tanh que nunca pasa de CEILING (nunca recorta de golpe). */
export function softLimit(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const room = CEILING - KNEE;
  return Math.sign(x) * (KNEE + room * Math.tanh((a - KNEE) / room));
}

/**
 * Salida común: ganancia general → limitador suave → altavoz. Devuelve el nodo de entrada.
 * Sirve igual con un contexto en vivo o fuera de línea (para medir). Se usa un WaveShaper y no un
 * DynamicsCompressor porque el de Chromium baja ~10 dB las notas cortas aunque no pasen del umbral:
 * se midió y volvía impredecibles los niveles.
 */
export function createOutput(ctx: BaseAudioContext, level: Volume = "medium"): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = VOLUME_GAIN[level];
  const limiter = ctx.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = softLimit(i / 1024 - 1);
  limiter.curve = curve;
  limiter.oversample = "2x";
  gain.connect(limiter);
  limiter.connect(ctx.destination);
  return gain;
}

export const isMuted = (): boolean => muted;

export function setMuted(value: boolean): void {
  if (value === muted) return;
  muted = value;
  try {
    window.localStorage.setItem(KEY, value ? "off" : "on");
  } catch {
    // Sin almacenamiento: la elección dura lo que dure la pestaña.
  }
  listeners.forEach((l) => l());
}

/** Para que el botón de sonido (silencio y volumen) se actualice. Devuelve cómo dejar de escuchar. */
export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!context) {
      context = new Ctor();
      master = createOutput(context, volume);
    }
    if (context.state === "suspended") void context.resume();
    return { ctx: context, out: master! };
  } catch {
    return null;
  }
}

type Tone = {
  /** Cuándo empieza, en segundos desde ahora. */
  at: number;
  /** Cuánto dura, en segundos. */
  length: number;
  from: number;
  to?: number;
  type?: "sine" | "triangle";
  peak: number;
};

/** Una nota con ataque de 8 ms y caída suave (sin clics ni picos). */
function tone(ctx: BaseAudioContext, out: AudioNode, t: Tone): void {
  const start = ctx.currentTime + t.at;
  const end = start + t.length;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = t.type ?? "sine";
  osc.frequency.setValueAtTime(t.from, start);
  if (t.to !== undefined) osc.frequency.exponentialRampToValueAtTime(t.to, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(t.peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(end);
}

/**
 * Pico de cada sonido en «Medio», en amplitud (1 = 0 dBFS). Éxito el más fuerte (-7 dBFS),
 * interfaz clara (plop y bip -11), tup y fiu más bajos (-14) y el «boop» amable (-12, 5 dB bajo el éxito).
 */
const LEVEL: Record<SoundName, number> = { win: 0.45, place: 0.28, play: 0.28, remove: 0.2, step: 0.2, oops: 0.25 };

// Do mayor pentatónica: sin disonancias entre notas (C5, E5, G5, C6).
const WIN = [523.25, 659.25, 783.99, 1046.5];

const RECIPES: Record<SoundName, (ctx: BaseAudioContext, out: AudioNode, random: () => number) => void> = {
  /** «Plop» de burbuja al soltar un bloque: sube redondeado; cambia ±3 % de tono cada vez. */
  place(ctx, out, random) {
    const f = 520 * (1 + (random() - 0.5) * 0.06);
    tone(ctx, out, { at: 0, length: 0.12, from: f, to: f * 1.7, peak: LEVEL.place });
  },
  /** «Fiu» suave que baja al quitar un bloque; más bajito que el error para no sonar a fallo. Nunca baja de 440 Hz. */
  remove(ctx, out) {
    tone(ctx, out, { at: 0, length: 0.13, from: 800, to: 440, peak: LEVEL.remove });
  },
  /** «Bip-bip» robótico al presionar Play: dos notas suaves, no agudas. */
  play(ctx, out) {
    tone(ctx, out, { at: 0, length: 0.09, from: 740, type: "triangle", peak: LEVEL.play });
    tone(ctx, out, { at: 0.13, length: 0.11, from: 988, type: "triangle", peak: LEVEL.play });
  },
  /** «Tup» mecánico ligero en cada paso del robot (620→440 Hz: por debajo de ~400 Hz los altavoces chicos casi no suenan). */
  step(ctx, out) {
    tone(ctx, out, { at: 0, length: 0.1, from: 620, to: 440, type: "triangle", peak: LEVEL.step });
  },
  /** Melodía ascendente de cuatro notas al completar el reto (una sola vez, ~1,1 s). */
  win(ctx, out) {
    WIN.forEach((f, i) => tone(ctx, out, { at: i * 0.19, length: i === 3 ? 0.5 : 0.26, from: f, type: "triangle", peak: LEVEL.win }));
  },
  /** «Boop» amable que baja un poco (520→400 Hz: grave para ser amable, no tanto como para perderse): no llegaste, pero puedes intentar otra vez. */
  oops(ctx, out) {
    tone(ctx, out, { at: 0, length: 0.32, from: 520, to: 400, peak: LEVEL.oops });
  },
};

/** Programa la receta de un sonido sobre cualquier contexto (en vivo o fuera de línea, para medirla). */
export function scheduleSound(ctx: BaseAudioContext, out: AudioNode, name: SoundName, random: () => number = Math.random): void {
  RECIPES[name](ctx, out, random);
}

export function playSound(name: SoundName): void {
  if (muted) return;
  const a = audio();
  if (!a) return;
  try {
    scheduleSound(a.ctx, a.out, name);
  } catch {
    // El sonido es un adorno: si falla, el juego sigue.
  }
}

/** Con pocos pasos suena cada uno; con muchos, los primeros, luego uno de cada tres y el último siempre. */
export function shouldStepSound(index: number, total: number): boolean {
  if (total <= 10) return true;
  return index < 4 || index === total - 1 || (index - 4) % 3 === 2;
}
