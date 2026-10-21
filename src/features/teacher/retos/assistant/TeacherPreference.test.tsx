// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memoryStatus = vi.fn();
const get = vi.fn();
const save = vi.fn();
const remove = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: () => memoryStatus(),
  useAction: (ref: unknown) => ({ "teacherMemory:get": get, "teacherMemory:save": save, "teacherMemory:remove": remove })[getFunctionName(ref as never)],
}));

import { TeacherPreference } from "./TeacherPreference";

const NOTA = "Historias de animales y tableros pequeños.";
const ok = (owner: string, text: string | null) => ({ owner, status: "ok", preference: text === null ? null : { text, savedAt: 1 } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const box = () => screen.getByLabelText("Tu nota") as HTMLTextAreaElement;

beforeEach(() => {
  memoryStatus.mockReturnValue({ enabled: true, owner: "rosa" });
  get.mockResolvedValue(ok("rosa", NOTA));
});
afterEach(() => {
  cleanup();
  for (const fn of [memoryStatus, get, save, remove]) fn.mockReset();
});

describe("nota del docente para el asistente", () => {
  it("no aparece si Atomic Memory no está activado", () => {
    memoryStatus.mockReturnValue({ enabled: false, owner: "rosa" });
    render(<TeacherPreference />);
    expect(screen.queryByRole("heading", { name: /recuerda/ })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("muestra la nota guardada y se puede corregir", async () => {
    save.mockResolvedValue(ok("rosa", "Prefieren tableros grandes y retos de colores."));
    render(<TeacherPreference />);
    expect((await screen.findByDisplayValue(NOTA))).toBeTruthy();
    fireEvent.change(box(), { target: { value: "  Prefieren tableros grandes y retos de colores. " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/Guardamos tu nota/)).toBeTruthy();
    expect(save).toHaveBeenCalledWith({ text: "Prefieren tableros grandes y retos de colores." });
  });

  it("si no se pudo guardar, no dice «guardamos»", async () => {
    get.mockResolvedValue(ok("rosa", null));
    save.mockResolvedValue({ owner: "rosa", status: "unavailable" });
    render(<TeacherPreference />);
    fireEvent.change(await screen.findByLabelText("Tu nota"), { target: { value: NOTA } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No pudimos confirmar que tu nota se guardó/);
    expect(screen.queryByText(/Guardamos/)).toBeNull();
    expect(screen.getByText("El estado de tu nota no está confirmado.")).toBeTruthy();
  });

  it("recarga el estado real tras un borrado sin confirmar", async () => {
    remove.mockResolvedValue({ owner: "rosa", status: "unavailable" });
    render(<TeacherPreference />);
    await screen.findByDisplayValue(NOTA);
    fireEvent.click(screen.getByRole("button", { name: "Olvidar nota" }));
    await screen.findByRole("alert");
    // El proveedor pudo borrar aunque el recibo se perdiera.
    get.mockResolvedValueOnce(ok("rosa", null));
    fireEvent.click(screen.getByRole("button", { name: "Volver a cargar nota" }));
    await screen.findByText("Todavía no guardaste una nota.");
    expect(box().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Olvidar nota" })).toBeNull();
  });

  it("no deja guardar correos ni teléfonos", async () => {
    render(<TeacherPreference />);
    await screen.findByDisplayValue(NOTA);
    fireEvent.change(box(), { target: { value: "Llamar al 987 654 321 si falta" } });
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/sin correos, teléfonos ni documentos/)).toBeTruthy();
  });

  it("olvidar solo se confirma si el servidor lo confirma", async () => {
    remove.mockResolvedValueOnce({ owner: "rosa", status: "unavailable" }).mockResolvedValueOnce(ok("rosa", null));
    render(<TeacherPreference />);
    await screen.findByDisplayValue(NOTA);
    fireEvent.click(screen.getByRole("button", { name: "Olvidar nota" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No pudimos confirmar que tu nota se borró/);
    expect(box().value).toBe(NOTA);
    fireEvent.click(screen.getByRole("button", { name: "Olvidar nota" }));
    expect(await screen.findByText(/Olvidamos tu nota/)).toBeTruthy();
    expect(box().value).toBe("");
    expect(screen.queryByRole("button", { name: "Olvidar nota" })).toBeNull();
  });

  it("al cambiar de cuenta no queda la nota del docente anterior, aunque su respuesta llegue tarde", async () => {
    const late = deferred<ReturnType<typeof ok>>();
    get.mockReturnValueOnce(late.promise).mockResolvedValueOnce(ok("luis", null));
    const { rerender } = render(<TeacherPreference />);
    memoryStatus.mockReturnValue({ enabled: true, owner: "luis" });
    rerender(<TeacherPreference />);
    expect(await screen.findByText("Todavía no guardaste una nota.")).toBeTruthy();
    await act(async () => late.resolve(ok("rosa", NOTA)));
    expect(screen.queryByDisplayValue(NOTA)).toBeNull();
    expect(box().value).toBe("");
  });

  it("descarta una respuesta que el servidor atribuye a otra cuenta", async () => {
    get.mockResolvedValue(ok("luis", NOTA));
    render(<TeacherPreference />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Cambió la sesión/);
    expect(screen.queryByDisplayValue(NOTA)).toBeNull();
  });
});
