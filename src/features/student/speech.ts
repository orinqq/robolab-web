/**
 * Lectura en voz alta con la voz del navegador (Web Speech API). Los niños de
 * Inicial todavía no leen: cada pregunta y sus alternativas se escuchan.
 */

/**
 * Velocidad y tono de la voz (1 es lo normal del sistema; el tono llega hasta 2):
 * un poco más lenta y más aguda. Algunas voces ignoran el tono.
 */
export const RATE = 0.9;
export const PITCH = 1.3;

export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

function spanishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase() === "es-pe") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("es-4")) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("es"))
  );
}

export function speak(text: string): void {
  if (!canSpeak() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-PE";
  const voice = spanishVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = RATE;
  utterance.pitch = PITCH;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
