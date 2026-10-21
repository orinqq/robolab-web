// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { missionFixtures } from "@robolab/backend/domain/mission/fixtures";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generate = vi.fn();
const reviewLocal = vi.fn();
const save = vi.fn();
const createReto = vi.fn();
const status = vi.fn();
const classes = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    return name === "classrooms:listMine" ? classes() : name === "teacherMemory:status" ? { enabled: false, owner: "u1" } : status();
  },
  useAction: (ref: unknown) => getFunctionName(ref as never) === "agent:reviewLocal" ? reviewLocal : generate,
  useMutation: (ref: unknown) => (getFunctionName(ref as never) === "assignments:create" ? createReto : save),
}));

import { AssistantPage } from "./AssistantPage";

const M = (grade: 2 | 3 | 4) => missionFixtures.find((m) => m.grade === grade)!;
const proposal = (grade: 2 | 3 | 4, alternativeCost: number | null = 11) => ({ grade, mission: M(grade), metrics: { solutionStatus: "SOLVED", minimumEnergy: 6 }, alternativeCost });
const OBJETIVO = "Comparar sumas de costos y elegir un recorrido con presupuesto limitado.";

beforeEach(() => {
  status.mockReturnValue({ configured: true });
  generate.mockResolvedValue({ status: "ok", proposals: [proposal(2), proposal(3)], failed: [] });
  save.mockImplementation(async () => `m${save.mock.calls.length}`);
  createReto.mockResolvedValue("a1");
  classes.mockReturnValue([
    { _id: "c1", label: "Primaria · 3.º · Sección A" },
    { _id: "c2", label: "Primaria · 3.º · Sección B" },
  ]);
});
afterEach(() => {
  cleanup();
  generate.mockReset();
  reviewLocal.mockReset();
  vi.unstubAllGlobals();
  save.mockReset();
  createReto.mockReset();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/docente/retos/nuevo/asistente"]}>
      <Routes>
        <Route path="/docente/retos/nuevo/asistente" element={<AssistantPage />} />
        <Route path="/docente/retos/nuevo" element={<p>Dos caminos</p>} />
        <Route path="/docente/retos" element={<p>Lista de retos</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
const type = (text = OBJETIVO) => fireEvent.change(screen.getByLabelText("Aprendizaje"), { target: { value: text } });
const propose = () => screen.getByRole("button", { name: "Proponer misiones" }) as HTMLButtonElement;
const chip = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("asistente: describir el aprendizaje (G2)", () => {
  it("pide solo lo necesario: aprendizaje, grados y dificultad; sin tipo de misión ni aviso de privacidad en pantalla", () => {
    renderPage();
    expect(document.title).toBe("Asistente de misiones · RoboLab");
    expect(screen.getByRole("heading", { level: 1, name: "Cuéntale al asistente qué quieres que aprendan" })).toBeTruthy();
    expect(screen.getByLabelText("Aprendizaje")).toBeTruthy();
    expect(screen.queryByLabelText(/Tipo de misión/)).toBeNull();
    expect(screen.queryByText(/Tipo de misión/)).toBeNull();
    expect(screen.queryByText(/Escribe solo el aprendizaje/)).toBeNull();
    expect(screen.getByText("0 de 800 letras")).toBeTruthy();
  });

  it("por defecto 2.º y 3.º con dificultad equilibrada; hay que escribir al menos 10 letras y elegir de 1 a 3 grados", () => {
    renderPage();
    expect(chip("2.º").getAttribute("aria-pressed")).toBe("true");
    expect(chip("3.º").getAttribute("aria-pressed")).toBe("true");
    expect(chip("4.º").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Equilibrada").getAttribute("aria-pressed")).toBe("true");
    expect(propose().disabled).toBe(true);
    type("corto");
    expect(propose().disabled).toBe(true);
    type();
    expect(propose().disabled).toBe(false);
    fireEvent.click(chip("2.º"));
    fireEvent.click(chip("3.º"));
    expect(propose().disabled).toBe(true);
    fireEvent.click(chip("4.º"));
    expect(propose().disabled).toBe(false);
  });

  it("manda el aprendizaje, los grados en orden y la dificultad elegida", async () => {
    renderPage();
    type(`  ${OBJETIVO}  `);
    fireEvent.click(chip("4.º"));
    fireEvent.click(chip("Desafío"));
    fireEvent.click(propose());
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ objective: OBJETIVO, grades: [2, 3, 4], difficulty: "challenge" }));
  });

  it("mientras piensa lo dice, con su progreso, y no deja pedir dos veces", async () => {
    let finish!: (v: unknown) => void;
    generate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    type();
    fireEvent.click(propose());
    expect(await screen.findByText(/Pensando la misión de 2\.º y 3\.º/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Pensando" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pensando…" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ status: "ok", proposals: [proposal(2)], failed: [] });
    expect(await screen.findByRole("heading", { name: "Revisa las propuestas" })).toBeTruthy();
  });

  it("el servidor rechaza la solicitud o limita las peticiones: muestra su mensaje y se puede corregir", async () => {
    generate.mockRejectedValue(new ConvexError("Hiciste muchas solicitudes seguidas. Espera un rato e inténtalo de nuevo."));
    renderPage();
    type();
    fireEvent.click(propose());
    expect((await screen.findByRole("alert")).textContent).toMatch(/muchas solicitudes seguidas/);
    expect((screen.getByLabelText("Aprendizaje") as HTMLTextAreaElement).value).toBe(OBJETIVO);
  });

  it("un error inesperado no filtra detalles", async () => {
    generate.mockRejectedValue(new Error("stack interno"));
    renderPage();
    type();
    fireEvent.click(propose());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/stack interno/);
    expect(alert.textContent).toMatch(/No pudimos/);
  });

  it.each([
    ["PROVIDER_RATE_LIMIT", "Hay muchas solicitudes"],
    ["PROVIDER_TIMEOUT", "No pudimos generar a tiempo"],
    ["PROVIDER_UNAVAILABLE", "No pudimos generar a tiempo"],
    ["UNSOLVABLE", "La respuesta llegó incompleta"],
    ["SCHEMA_INVALID", "La respuesta llegó incompleta"],
    ["PROVIDER_AUTH", "El asistente no está disponible"],
  ])("si ningún grado salió bien (%s) lo explica con «%s» y deja reintentar sin perder lo escrito", async (code, title) => {
    generate.mockResolvedValue({ status: "ok", proposals: [], failed: [{ grade: 2, code }] });
    renderPage();
    type();
    fireEvent.click(propose());
    expect(await screen.findByText(title)).toBeTruthy();
    expect((screen.getByLabelText("Aprendizaje") as HTMLTextAreaElement).value).toBe(OBJETIVO);
    expect(screen.queryByRole("heading", { name: "Revisa las propuestas" })).toBeNull();
  });

  it("si el servidor dice que el asistente no está activado, ofrece elegir un juego", async () => {
    generate.mockResolvedValue({ status: "not_configured" });
    renderPage();
    type();
    fireEvent.click(propose());
    expect(await screen.findByText("El asistente no está disponible")).toBeTruthy();
    expect((screen.getByRole("link", { name: /Elegir un juego/ }) as HTMLAnchorElement).getAttribute("href")).toBe("/docente/retos/nuevo/juego");
  });

  it("si la nube no está activada permite preparar la generación con Jetson", () => {
    status.mockReturnValue({ configured: false });
    renderPage();
    expect(screen.getByRole("button", { name: "Jetson por USB" })).toBeTruthy();
    expect(screen.getByLabelText("Aprendizaje")).toBeTruthy();
    expect(screen.getByText(/La generación en la nube no está activada/)).toBeTruthy();
  });

  it("Cancelar vuelve a los dos caminos", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("Dos caminos")).toBeTruthy();
  });
});

describe("asistente: revisar y guardar (G3)", () => {
  async function review() {
    renderPage();
    type();
    fireEvent.click(propose());
    await screen.findByRole("heading", { name: "Revisa las propuestas" });
  }

  it("muestra una tarjeta por misión verificada, con su tablero y su energía, y todas elegidas", async () => {
    await review();
    const cards = within(screen.getByRole("list", { name: "Propuestas" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("heading", { name: "2.º grado" })).toBeTruthy();
    expect(within(cards[0]!).getByText(M(2).title)).toBeTruthy();
    expect(within(cards[0]!).getByText("Resuelta por el servidor")).toBeTruthy();
    expect(within(cards[0]!).getByRole("img", { name: /^Tablero de \d por \d con \d estaci/ })).toBeTruthy();
    expect(within(cards[0]!).getByText(/Energía mínima 6 de/)).toBeTruthy();
    expect(screen.getByText("2 misiones elegidas")).toBeTruthy();
    expect(screen.queryByText(/No pasó la revisión/i)).toBeNull();
  });

  it("dice si usó la nota del docente o si no pudo leerla, según el servidor", async () => {
    generate.mockResolvedValue({ status: "ok", preference: "used", proposals: [proposal(2)], failed: [] });
    await review();
    expect(screen.getByText("Usamos tu nota sobre tus clases para proponerlas.")).toBeTruthy();
    cleanup();
    generate.mockResolvedValue({ status: "ok", preference: "unavailable", proposals: [proposal(2)], failed: [] });
    await review();
    expect(screen.getByText(/se hicieron sin ella/)).toBeTruthy();
    cleanup();
    generate.mockResolvedValue({ status: "ok", preference: "off", proposals: [proposal(2)], failed: [] });
    await review();
    expect(screen.queryByText(/tu nota/)).toBeNull();
  });

  it("dice cuánto cuesta otra ruta posible, para comparar con la energía mínima", async () => {
    generate.mockResolvedValue({ status: "ok", proposals: [proposal(2, 11), proposal(3, null)], failed: [] });
    renderPage();
    type();
    fireEvent.click(propose());
    await screen.findByRole("heading", { name: "Revisa las propuestas" });
    const cards = within(screen.getByRole("list", { name: "Propuestas" })).getAllByRole("listitem");
    expect(within(cards[0]!).getByText(/Energía mínima 6 de .* · otra ruta cuesta 11/)).toBeTruthy();
    // Sin otra ruta distinta no se inventa la cifra.
    expect(within(cards[1]!).getByText(/Energía mínima 6 de/).textContent).not.toMatch(/otra ruta/);
  });

  it("lo que no pasó la revisión no se muestra como tarjeta; solo se avisa para qué grados hubo propuesta", async () => {
    generate.mockResolvedValue({ status: "ok", proposals: [proposal(2)], failed: [{ grade: 3, code: "UNSOLVABLE" }] });
    renderPage();
    type();
    fireEvent.click(propose());
    await screen.findByRole("heading", { name: "Revisa las propuestas" });
    expect(within(screen.getByRole("list", { name: "Propuestas" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("3.º grado")).toBeNull();
    expect(screen.queryByText("Intentar de nuevo")).toBeNull();
    expect(screen.getByText(/Solo pudimos verificar misiones para 2\.º/)).toBeTruthy();
  });

  it("«Usar» elige o quita una misión y el contador y «Guardar» lo siguen", async () => {
    await review();
    fireEvent.click(screen.getAllByRole("button", { name: /Usar/ })[1]!);
    expect(screen.getByText("1 misión elegida")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Usar/ })[0]!);
    expect((screen.getByRole("button", { name: "Guardar y asignar a una clase" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("«Guardar y asignar» guarda solo las elegidas (el servidor vuelve a revisar) y pide la clase", async () => {
    await review();
    fireEvent.click(screen.getAllByRole("button", { name: /Usar/ })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
    expect(await screen.findByRole("heading", { name: "Guardamos tu misión" })).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ mission: M(2) });
    const form = within(screen.getByRole("form", { name: "Asignar a una clase" }));
    expect((form.getByRole("button", { name: "Asignar a la clase" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(form.getByLabelText("Clase")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Elige una clase", "Primaria · 3.º · Sección A", "Primaria · 3.º · Sección B"]);
  });

  it("asigna cada misión guardada a la clase elegida, para que los alumnos la jueguen", async () => {
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
    await screen.findByRole("heading", { name: "Guardamos tus 2 misiones" });
    fireEvent.change(screen.getByLabelText("Clase"), { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar a la clase" }));
    expect(await screen.findByText(/ya pueden jugar las misiones/)).toBeTruthy();
    expect(createReto.mock.calls.map((c) => c[0])).toEqual([
      { challengeId: "ia:m1", visibility: "class", classroomId: "c2" },
      { challengeId: "ia:m2", visibility: "class", classroomId: "c2" },
    ]);
    expect(screen.getByText("Primaria · 3.º · Sección B")).toBeTruthy();
    expect((screen.getByRole("link", { name: "Ir a Retos" }) as HTMLAnchorElement).getAttribute("href")).toBe("/docente/retos");
  });

  it("si el servidor rechaza la asignación muestra su mensaje y se puede reintentar", async () => {
    createReto.mockRejectedValueOnce(new ConvexError("Ese reto ya está en la clase."));
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
    await screen.findByRole("heading", { name: "Guardamos tus 2 misiones" });
    fireEvent.change(screen.getByLabelText("Clase"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar a la clase" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ya está en la clase/);
    expect(screen.getByRole("form", { name: "Asignar a una clase" })).toBeTruthy();
  });

  it("también se pueden dejar como borradores, sin clase", async () => {
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
    await screen.findByRole("heading", { name: "Guardamos tus 2 misiones" });
    expect((screen.getByRole("link", { name: "Dejar como borradores" }) as HTMLAnchorElement).getAttribute("href")).toBe("/docente/retos");
    expect(createReto).not.toHaveBeenCalled();
  });

  it("sin clases explica cómo seguir", async () => {
    classes.mockReturnValue([]);
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
    expect(await screen.findByText(/Todavía no tienes clases/)).toBeTruthy();
  });

  it("«Probar» deja jugar la misión sin guardarla, y se vuelve a las propuestas", async () => {
    await review();
    fireEvent.click(within(within(screen.getByRole("list", { name: "Propuestas" })).getAllByRole("listitem")[0]!).getByRole("button", { name: /Probar/ }));
    expect(screen.getByText(/Esta partida no cuenta en ningún resultado/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: `${M(2).title}.` })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Volver a las propuestas/ }));
    expect(screen.getByRole("heading", { name: "Revisa las propuestas" })).toBeTruthy();
  });

  it("si el servidor rechaza al guardar muestra su mensaje y conserva la revisión", async () => {
    save.mockRejectedValueOnce(new ConvexError("La misión no se puede resolver."));
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no se puede resolver/);
    expect(screen.getByRole("heading", { name: "Revisa las propuestas" })).toBeTruthy();
  });

  it("«Otra» pide una propuesta nueva solo para ese grado y la cambia en su tarjeta", async () => {
    await review();
    const fresh = { ...proposal(3), mission: { ...M(3), title: "Otra misión para tercero" } };
    generate.mockResolvedValueOnce({ status: "ok", proposals: [fresh], failed: [] });
    fireEvent.click(screen.getByRole("button", { name: "Pedir otra propuesta para 3.º grado" }));
    expect(await screen.findByText("Otra misión para tercero")).toBeTruthy();
    expect(generate).toHaveBeenLastCalledWith({ objective: OBJETIVO, grades: [3], difficulty: "balanced" });
    expect(screen.getByText(M(2).title)).toBeTruthy();
  });

  it("si no sale otra propuesta verificada, conserva la anterior y lo dice", async () => {
    await review();
    generate.mockResolvedValueOnce({ status: "ok", proposals: [], failed: [{ grade: 2, code: "UNSOLVABLE" }] });
    fireEvent.click(screen.getByRole("button", { name: "Pedir otra propuesta para 2.º grado" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Conservamos la anterior/);
    expect(screen.getByText(M(2).title)).toBeTruthy();
  });

  it("«Atrás» vuelve a describir sin borrar lo escrito", async () => {
    await review();
    fireEvent.click(screen.getByRole("button", { name: /Atrás/ }));
    expect((screen.getByLabelText("Aprendizaje") as HTMLTextAreaElement).value).toBe(OBJETIVO);
  });
});


function usbDevice(generateLocal: (signal: AbortSignal) => Promise<unknown> = async () => ({ missions: [M(2)], failed: [] })) {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const jobs = new Map<string, AbortController>();
  const send = (id: string, result: unknown, error?: string) => input.enqueue(new TextEncoder().encode(JSON.stringify({ v: 1, id, ...(error ? { ok: false, error } : { ok: true, result }) }) + "\n"));
  const port = {
    readable: new ReadableStream<Uint8Array>({ start(c) { input = c; } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) {
      const m = JSON.parse(new TextDecoder().decode(bytes));
      if (m.method === "hello") send(m.id, { device: "robolab-jetson", protocol: 1, provider: "ollama", ready: true });
      else if (m.method === "generate") {
        const controller = new AbortController(); jobs.set(m.id, controller);
        void generateLocal(controller.signal).then(result => send(m.id, result)).catch(() => send(m.id, null, "BUSY"));
      } else if (m.method === "cancel") jobs.get(m.params.requestId)?.abort();
      else send(m.id, { alive: true });
    } }),
    open: vi.fn(async () => {}), close: vi.fn(async () => {}),
  };
  const requestPort = vi.fn(async () => port);
  vi.stubGlobal("navigator", { ...navigator, serial: { requestPort } });
  return { input, requestPort };
}
async function connectUsb() {
  fireEvent.click(screen.getByRole("button", { name: "Jetson por USB" }));
  expect(propose().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Conectar Jetson" }));
  await screen.findByText(/Jetson conectada/);
}
it("elige el puerto USB y muestra solo lo certificado por Convex antes de guardar", async () => {
  const draft = { ...M(2), title: "Sin verificar" };
  const certified = { ...proposal(2), mission: { ...M(2), title: "Huerto certificado" } };
  const device = usbDevice(async () => ({ missions: [draft], failed: [] }));
  reviewLocal.mockResolvedValue({ status: "ok", proposals: [certified], failed: [] });
  status.mockReturnValue({ configured: false });
  renderPage(); type(); await connectUsb();
  expect(device.requestPort).toHaveBeenCalledTimes(1);
  fireEvent.click(propose()); await screen.findByText("Huerto certificado");
  expect(screen.queryByText("Sin verificar")).toBeNull(); expect(generate).not.toHaveBeenCalled();
  expect(reviewLocal).toHaveBeenCalledWith({ objective: OBJETIVO, grades: [2, 3], difficulty: "balanced", missions: [draft] });
  fireEvent.click(screen.getByRole("button", { name: "Guardar y asignar a una clase" }));
  await screen.findByText("Guardamos tu misión"); expect(save).toHaveBeenCalledWith({ mission: certified.mission });
});
it("conserva el aprendizaje al retirar el cable sin pasar a la nube", async () => {
  const device = usbDevice(); renderPage(); type(); await connectUsb();
  device.input.error(new Error("USB retirado"));
  await screen.findByText(/Se perdió la conexión USB/);
  expect((screen.getByLabelText("Aprendizaje") as HTMLTextAreaElement).value).toBe(OBJETIVO);
  expect(generate).not.toHaveBeenCalled(); expect(propose().disabled).toBe(true);
});
it("explica un dispositivo ocupado sin recurrir a la nube", async () => {
  usbDevice(async () => { throw new Error("BUSY"); });
  renderPage(); type(); await connectUsb(); fireEvent.click(propose());
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "La Jetson está generando otra misión. Espera a que termine.");
  expect(generate).not.toHaveBeenCalled();
});
it("mantiene una sola regeneración local y la cancela al salir", async () => {
  let posts = 0; let pendingSignal: AbortSignal | undefined;
  usbDevice(async signal => {
    if (++posts === 1) return { missions: [M(2)], failed: [] };
    pendingSignal = signal; return new Promise(() => {});
  });
  reviewLocal.mockResolvedValue({ status: "ok", proposals: [proposal(2)], failed: [] });
  renderPage(); type(); await connectUsb(); fireEvent.click(propose());
  await screen.findByRole("heading", { name: "Revisa las propuestas" });
  fireEvent.click(screen.getByRole("button", { name: /Pedir otra propuesta/ }));
  await waitFor(() => expect(pendingSignal).toBeTruthy());
  expect((screen.getByRole("button", { name: "Atrás" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Guardar y asignar a una clase" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup(); await waitFor(() => expect(pendingSignal?.aborted).toBe(true));
});
it("explica un mapa inválido sin culpar al aprendizaje", async () => {
  usbDevice(async () => ({ missions: [], failed: [{ grade: 2, code: "UNSOLVABLE" }] }));
  renderPage(); type(); await connectUsb(); fireEvent.click(propose());
  expect(await screen.findByRole("heading", { name: /El mapa no pasó la revisión/ })).toBeTruthy();
  expect((screen.getByLabelText("Aprendizaje") as HTMLTextAreaElement).value).toBe(OBJETIVO);
});
