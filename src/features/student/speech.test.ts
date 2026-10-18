// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PITCH, RATE, speak } from "./speech";

class FakeUtterance {
  lang = "";
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  constructor(readonly text: string) {}
}

function stubVoice() {
  const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return synth;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lectura en voz alta", () => {
  it("lee con una voz más aguda que la del sistema y un poco más lenta", () => {
    const synth = stubVoice();
    speak("Arma el programa para que Kusi llegue a la estrella.");
    const utterance = synth.speak.mock.calls[0]![0] as FakeUtterance;
    expect(PITCH).toBeGreaterThan(1);
    expect(PITCH).toBeLessThanOrEqual(2);
    expect(utterance.pitch).toBe(PITCH);
    expect(utterance.rate).toBe(RATE);
    expect(utterance.lang).toBe("es-PE");
  });

  it("corta lo que estaba leyendo antes de empezar, y no lee un texto vacío", () => {
    const synth = stubVoice();
    speak("   ");
    expect(synth.speak).not.toHaveBeenCalled();
    speak("Hola");
    expect(synth.cancel).toHaveBeenCalledBefore(synth.speak);
  });
});
