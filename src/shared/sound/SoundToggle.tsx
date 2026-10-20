import { useSyncExternalStore } from "react";
import { getVolume, isMuted, playSound, setMuted, setVolume, subscribeMuted, type Volume } from "./sounds";

const LEVELS: { value: Volume; label: string; bars: string }[] = [
  { value: "low", label: "Bajo", bars: "▂" },
  { value: "medium", label: "Medio", bars: "▂▄" },
  { value: "high", label: "Alto", bars: "▂▄▆" },
];

/**
 * Sonido del modo de juego. Un clic en «Sonido» sigue alternando el silencio (lo más rápido en clase);
 * al lado, tres botones Bajo / Medio / Alto con el nivel elegido marcado. Elegir un nivel también
 * enciende el sonido y deja oír un «plop» de muestra. Todo se recuerda.
 */
export function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const volume = useSyncExternalStore(subscribeMuted, getVolume, () => "medium" as Volume);
  return (
    <div className="sound-control">
      <button
        type="button"
        className="btn btn-sm sound-toggle"
        aria-pressed={!muted}
        onClick={() => {
          setMuted(!muted);
          // Al encender, un «plop» confirma que suena.
          if (muted) playSound("place");
        }}
      >
        <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span> <span className="sound-toggle-label">Sonido</span>
      </button>
      <div className="segmented sound-levels" role="group" aria-label="Volumen">
        {LEVELS.map((level) => (
          <button
            key={level.value}
            type="button"
            aria-pressed={!muted && volume === level.value}
            onClick={() => {
              setVolume(level.value);
              setMuted(false);
              playSound("place");
            }}
          >
            <span aria-hidden="true" className="sound-level-bars">{level.bars}</span>
            <span className="sound-level-label">{level.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
