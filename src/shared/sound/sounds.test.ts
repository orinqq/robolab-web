// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Note = { type: string; start: number; stop: number; freqs: number[]; peak: number };

/** Un AudioContext falso que anota cada nota que se programa (inicio, fin, frecuencias y volumen máximo). */
function fakeAudio() {
  const notes: Note[] = [];
  const created = { contexts: 0, resumed: 0, limiters: 0 };
  const gains: { gain: { values: number[] } }[] = [];
  class Param {
    values: number[] = [];
    setValueAtTime(v: number) { this.values.push(v); return this; }
    linearRampToValueAtTime(v: number) { this.values.push(v); return this; }
    exponentialRampToValueAtTime(v: number) { this.values.push(v); return this; }
    cancelScheduledValues() { return this; }
    set value(v: number) { this.values.push(v); }
  }
  class FakeContext {
    currentTime = 0;
    state = "suspended";
    destination = {};
    constructor() { created.contexts++; }
    resume() { created.resumed++; this.state = "running"; return Promise.resolve(); }
    createGain() { const node = { gain: new Param(), connect: vi.fn((n?: unknown) => n ?? {}), disconnect: vi.fn() }; gains.push(node); return node; }
    createWaveShaper() { created.limiters++; return { curve: null as Float32Array | null, oversample: "none", connect: vi.fn((n?: unknown) => n ?? {}) }; }
    createBiquadFilter() { return { type: "", frequency: new Param(), Q: new Param(), connect: vi.fn(() => ({ connect: vi.fn() })) }; }
    createOscillator() {
      const frequency = new Param();
      const osc = {
        type: "sine", frequency, linked: null as null | { gain: { values: number[] } }, connect: vi.fn((n: { gain: { values: number[] } }) => { osc.linked = n; return n; }), onended: null as null | (() => void),
        start(t = 0) { (osc as { t0?: number }).t0 = t; },
        stop(t = 0) {
          const t0 = (osc as { t0?: number }).t0 ?? 0;
          notes.push({ type: osc.type, start: t0, stop: t, freqs: frequency.values.slice(), peak: Math.max(...(osc.linked?.gain.values ?? [0])) });
        },
      };
      return osc;
    }
  }
  return { notes, created, gains, Context: FakeContext };
}

let audio: ReturnType<typeof fakeAudio>;
beforeEach(() => {
  localStorage.clear();
  audio = fakeAudio();
  vi.stubGlobal("AudioContext", audio.Context);
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

const load = async () => await import("./sounds");
const length = (notes: Note[]) => (Math.max(...notes.map((n) => n.stop)) - Math.min(...notes.map((n) => n.start))) * 1000;

describe("sonidos de RoboLab (sintetizados, sin archivos)", () => {
  it("no crea el audio hasta que suena algo (el navegador solo lo permite tras un gesto del usuario)", async () => {
    const { playSound } = await load();
    expect(audio.created.contexts).toBe(0);
    playSound("place");
    expect(audio.created.contexts).toBe(1);
    playSound("remove");
    expect(audio.created.contexts).toBe(1);
  });

  it("reanuda el audio si el navegador lo dejó suspendido", async () => {
    const { playSound } = await load();
    playSound("place");
    expect(audio.created.resumed).toBe(1);
  });

  it.each([
    ["place", 90, 170],
    ["remove", 100, 170],
    ["play", 200, 360],
    ["step", 70, 150],
    ["win", 800, 1300],
    ["oops", 250, 460],
  ] as const)("«%s» dura entre %i y %i ms", async (name, min, max) => {
    const { playSound } = await load();
    playSound(name);
    expect(audio.notes.length).toBeGreaterThan(0);
    const ms = length(audio.notes);
    expect(ms).toBeGreaterThanOrEqual(min);
    expect(ms).toBeLessThanOrEqual(max);
  });

  it("la melodía de éxito sube: cuatro notas, cada una más aguda que la anterior", async () => {
    const { playSound } = await load();
    playSound("win");
    const first = audio.notes.filter((n) => n.type !== "sine" || true).sort((a, b) => a.start - b.start);
    const heads = [...new Map(first.map((n) => [n.start.toFixed(3), n.freqs[0]!])).values()];
    expect(heads.length).toBe(4);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("el error es amable: un «boop» grave y corto que baja, no un zumbido ni una nota aguda", async () => {
    const { playSound } = await load();
    playSound("oops");
    const freqs = audio.notes.flatMap((n) => n.freqs);
    expect(Math.max(...freqs)).toBeLessThanOrEqual(600);
    expect(freqs[freqs.length - 1]!).toBeLessThan(freqs[0]!);
    expect(audio.notes.every((n) => n.type === "sine" || n.type === "triangle")).toBe(true);
  });

  it("en silencio no suena nada ni se crea el audio, y la elección se recuerda", async () => {
    const mod = await load();
    expect(mod.isMuted()).toBe(false);
    mod.setMuted(true);
    mod.playSound("win");
    expect(audio.notes).toEqual([]);
    expect(audio.created.contexts).toBe(0);
    expect(localStorage.getItem("robolab.sonido")).toBe("off");
    vi.resetModules();
    const again = await load();
    expect(again.isMuted()).toBe(true);
    again.setMuted(false);
    expect(localStorage.getItem("robolab.sonido")).toBe("on");
  });

  it("avisa a quien escucha el cambio de silencio (el botón se actualiza)", async () => {
    const mod = await load();
    const listener = vi.fn();
    const off = mod.subscribeMuted(listener);
    mod.setMuted(true);
    mod.setMuted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    mod.setMuted(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sin AudioContext (navegador viejo) o sin almacenamiento, no se cae", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const mod = await load();
    expect(() => mod.playSound("win")).not.toThrow();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    vi.resetModules();
    const blocked = await load();
    expect(blocked.isMuted()).toBe(false);
    expect(() => blocked.setMuted(true)).not.toThrow();
  });

  it("si el audio falla por dentro, el juego sigue", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("sin audio"); } });
    const { playSound } = await load();
    expect(() => playSound("place")).not.toThrow();
  });
});

const NAMES = ["place", "remove", "play", "step", "win", "oops"] as const;
const db = (x: number) => 20 * Math.log10(x);

/** Pico estimado de un sonido en la salida: la nota más fuerte por el volumen general (Chromium real se mide aparte). */
async function peakDb(name: (typeof NAMES)[number], volume: "low" | "medium" | "high") {
  const mod = await load();
  audio.notes.length = 0;
  mod.playSound(name);
  const peak = Math.max(...audio.notes.map((n) => n.peak));
  return db(peak * mod.VOLUME_GAIN[volume]);
}

describe("fuerza de cada sonido (el usuario los oía muy bajo)", () => {
  // Objetivos en «Medio»: éxito el más fuerte, interfaz clara, tup y fiu más bajos, boop amable.
  it.each([
    ["win", -7],
    ["place", -11],
    ["play", -11],
    ["remove", -14],
    ["step", -14],
    ["oops", -12],
  ] as const)("«%s» llega a unos %i dBFS de pico en volumen Medio", async (name, target) => {
    expect(Math.abs((await peakDb(name, "medium")) - target)).toBeLessThanOrEqual(1.5);
  });

  it("el éxito es el más fuerte y el error nunca lo supera ni se acerca", async () => {
    for (const volume of ["low", "medium", "high"] as const) {
      const levels = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await peakDb(n, volume)])));
      for (const n of NAMES) if (n !== "win") expect(levels[n]).toBeLessThan(levels.win!);
      expect(levels.oops!).toBeLessThanOrEqual(levels.win! - 3);
    }
  });

  it("ningún sonido recorta, ni en volumen Alto (pico por debajo de -1 dBFS)", async () => {
    for (const n of NAMES) expect(await peakDb(n, "high")).toBeLessThan(-1);
  });

  it("Medio es claramente más fuerte que lo de antes (pico del éxito de -16 dBFS) y Bajo no baja de ahí", async () => {
    expect(await peakDb("win", "medium")).toBeGreaterThanOrEqual(-16 + 6);
    expect(await peakDb("win", "low")).toBeLessThan(await peakDb("win", "medium"));
    expect(await peakDb("win", "high")).toBeGreaterThan(await peakDb("win", "medium"));
  });

  it("pasa por un limitador suave antes de la salida (por si se suman notas)", async () => {
    const { playSound } = await load();
    playSound("win");
    expect(audio.created.limiters).toBe(1);
  });

  it("el limitador deja pasar igual lo normal, nunca pasa de -1 dBFS aunque entre el doble y es monótono", async () => {
    const { softLimit } = await load();
    for (const x of [0, 0.1, 0.45, -0.5, 0.7]) expect(softLimit(x)).toBe(x);
    expect(db(Math.abs(softLimit(5)))).toBeLessThan(-1);
    expect(softLimit(-5)).toBeLessThan(0);
    let prev = -Infinity;
    for (let x = -2; x <= 2; x += 0.01) {
      expect(softLimit(x)).toBeGreaterThanOrEqual(prev);
      prev = softLimit(x);
    }
  });

  it("todas las notas empiezan en 400 Hz o más (los altavoces chicos no reproducen lo grave) y ninguna pasa de 2,5 kHz", async () => {
    const mod = await load();
    for (const n of NAMES) {
      audio.notes.length = 0;
      mod.playSound(n);
      const freqs = audio.notes.flatMap((x) => x.freqs);
      expect(Math.min(...freqs), n).toBeGreaterThanOrEqual(400);
      expect(Math.max(...freqs), n).toBeLessThanOrEqual(2500);
    }
  });
});

describe("volumen de tres niveles", () => {
  it("por defecto es Medio, y Bajo < Medio < Alto", async () => {
    const mod = await load();
    expect(mod.getVolume()).toBe("medium");
    expect(mod.VOLUME_GAIN.low).toBeLessThan(mod.VOLUME_GAIN.medium);
    expect(mod.VOLUME_GAIN.medium).toBeLessThan(mod.VOLUME_GAIN.high);
  });

  it("se recuerda en localStorage, avisa a quien escucha y un valor raro vuelve a Medio", async () => {
    const mod = await load();
    const listener = vi.fn();
    mod.subscribeMuted(listener);
    mod.setVolume("high");
    mod.setVolume("high");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("robolab.volumen")).toBe("high");
    vi.resetModules();
    expect((await load()).getVolume()).toBe("high");
    localStorage.setItem("robolab.volumen", "ensordecedor");
    vi.resetModules();
    expect((await load()).getVolume()).toBe("medium");
  });

  it("cambiar el nivel con el audio ya creado ajusta el volumen general al instante", async () => {
    const mod = await load();
    mod.playSound("place");
    const master = audio.gains[0]!;
    expect(master.gain.values.at(-1)).toBe(mod.VOLUME_GAIN.medium);
    mod.setVolume("low");
    expect(master.gain.values.at(-1)).toBe(mod.VOLUME_GAIN.low);
  });

  it("sin almacenamiento no se cae", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    const mod = await load();
    expect(mod.getVolume()).toBe("medium");
    expect(() => mod.setVolume("low")).not.toThrow();
    expect(mod.getVolume()).toBe("low");
  });
});

describe("los pasos del robot no cansan en programas largos", () => {
  it("con pocos pasos suena cada uno; con muchos, los primeros, luego uno de cada tres y el último siempre", async () => {
    const { shouldStepSound } = await load();
    expect(Array.from({ length: 8 }, (_, i) => shouldStepSound(i, 8))).toEqual(Array(8).fill(true));
    const long = Array.from({ length: 30 }, (_, i) => shouldStepSound(i, 30));
    expect(long.slice(0, 4)).toEqual([true, true, true, true]);
    expect(long.filter(Boolean).length).toBeLessThanOrEqual(13);
    expect(long.filter(Boolean).length).toBeGreaterThanOrEqual(8);
    expect(long[29]).toBe(true);
  });

  it("el «plop» varía un poco de tono cada vez para no cansar", async () => {
    const { playSound } = await load();
    const heads = new Set<number>();
    for (let i = 0; i < 8; i++) {
      audio.notes.length = 0;
      playSound("place");
      heads.add(Math.round(audio.notes[0]!.freqs[0]!));
    }
    expect(heads.size).toBeGreaterThan(1);
    const all = [...heads];
    expect(Math.max(...all) / Math.min(...all)).toBeLessThan(1.08);
  });
});
