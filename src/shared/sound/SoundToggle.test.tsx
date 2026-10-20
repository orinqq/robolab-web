// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("AudioContext", undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup() {
  const { SoundToggle } = await import("./SoundToggle");
  const sounds = await import("./sounds");
  render(<SoundToggle />);
  return sounds;
}

describe("botón «Sonido» con volumen", () => {
  it("un clic en «Sonido» sigue alternando el silencio", async () => {
    const sounds = await setup();
    const button = screen.getByRole("button", { name: /Sonido/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(sounds.isMuted()).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(sounds.isMuted()).toBe(false);
  });

  it("ofrece un grupo «Volumen» con Bajo, Medio y Alto; Medio está marcado por defecto", async () => {
    await setup();
    const group = screen.getByRole("group", { name: "Volumen" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.querySelector(".sound-level-label")?.textContent)).toEqual(["Bajo", "Medio", "Alto"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("elegir un nivel lo guarda, lo marca y, si estaba en silencio, vuelve a encender el sonido", async () => {
    const sounds = await setup();
    sounds.setMuted(true);
    fireEvent.click(screen.getByRole("button", { name: "Alto" }));
    expect(sounds.getVolume()).toBe("high");
    expect(sounds.isMuted()).toBe(false);
    expect(localStorage.getItem("robolab.volumen")).toBe("high");
    expect(screen.getByRole("button", { name: "Alto" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Medio" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("en silencio ningún nivel aparece marcado", async () => {
    const sounds = await setup();
    fireEvent.click(screen.getByRole("button", { name: /Sonido/ }));
    expect(sounds.isMuted()).toBe(true);
    const group = screen.getByRole("group", { name: "Volumen" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
  });
});
