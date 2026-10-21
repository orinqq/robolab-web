import { useAction, useQuery } from "convex/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "@robolab/backend/convex/_generated/api";
import { cleanTeacherPreference, PREFERENCE_MAX } from "@robolab/backend/domain/teacher/preferences";
import { userMessage } from "../../../../shared/errors";

type Saved = { readonly text: string; readonly savedAt: number | null };
type Result = { readonly owner: string } & ({ readonly status: "off" } | { readonly status: "unavailable" } | { readonly status: "ok"; readonly preference: Saved | null });
type Task = "read" | "save" | "remove";

const UNAVAILABLE: Record<Task, string> = {
  read: "No pudimos leer tu nota ahora. El asistente funciona igual, sin ella.",
  save: "No pudimos confirmar que tu nota se guardó. Vuelve a cargarla antes de intentar de nuevo.",
  remove: "No pudimos confirmar que tu nota se borró. Vuelve a cargarla para comprobarlo.",
};

/**
 * La nota que el asistente recuerda del docente (Atomic Memory). Solo aparece si el
 * servidor la tiene activada. El estado va con la llave del docente de la sesión:
 * si cambia la cuenta, se arma de nuevo y nada del docente anterior queda en pantalla.
 */
export function TeacherPreference() {
  const status = useQuery(api.teacherMemory.status);
  if (!status?.enabled) return null;
  return <PreferenceCard key={status.owner} owner={status.owner} />;
}

function PreferenceCard({ owner }: { owner: string }) {
  const get = useAction(api.teacherMemory.get);
  const save = useAction(api.teacherMemory.save);
  const remove = useAction(api.teacherMemory.remove);
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Task | null>("read");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  // Solo cuenta la última petición de este docente: las respuestas viejas se descartan.
  const latest = useRef(0);

  async function settle(task: Task, seq: number, call: Promise<Result>) {
    const current = () => seq === latest.current;
    try {
      const result = await call;
      if (!current()) return;
      if (result.owner !== owner) {
        setError("Cambió la sesión. Vuelve a abrir el asistente.");
        return;
      }
      if (result.status === "off") setHidden(true);
      else if (result.status === "unavailable") setError(UNAVAILABLE[task]);
      else {
        setSaved(result.preference);
        setDraft(result.preference?.text ?? "");
        if (task === "save") setNotice("Guardamos tu nota. El asistente la usará en las próximas misiones en la nube.");
        if (task === "remove") setNotice("Olvidamos tu nota. El asistente ya no la usará.");
      }
    } catch (e) {
      if (current()) setError(userMessage(e, UNAVAILABLE[task]));
    } finally {
      if (current()) setBusy(null);
    }
  }

  function run(task: Task, call: () => Promise<Result>) {
    setBusy(task);
    setNotice(null);
    setError(null);
    void settle(task, ++latest.current, call());
  }

  useEffect(() => {
    // El estado inicial ya dice «leyendo»: aquí solo se pide la nota.
    void settle("read", ++latest.current, get({}));
    return () => {
      latest.current++;
    };
    // Se lee una vez por docente; la llave del componente cambia con la cuenta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden) return null;
  const checked = cleanTeacherPreference(draft);
  const unchanged = checked.ok && saved?.text === checked.text;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!checked.ok || unchanged || busy) return;
    const text = checked.text;
    void run("save", () => save({ text }));
  }

  return (
    <form className="card stack-sm assistant-form" onSubmit={submit} aria-labelledby="preference-title">
      <h2 id="preference-title" className="proposal-grade">
        Lo que el asistente recuerda de tus clases
      </h2>
      <p className="small muted">
        Una nota corta para la generación en la nube, por ejemplo «historias de animales y tableros pequeños». Escribe solo cómo trabajas, sin datos de alumnos.
      </p>
      {saved === undefined && busy === "read" ? (
        <p className="small muted" role="status">
          Leyendo tu nota…
        </p>
      ) : (
        <div className="field">
          <label htmlFor="teacher-preference">Tu nota</label>
          <textarea
            id="teacher-preference"
            className="input"
            rows={2}
            maxLength={PREFERENCE_MAX}
            value={draft}
            disabled={busy !== null}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby="teacher-preference-hint"
          />
          <span id="teacher-preference-hint" className="small muted">
            {error ? "El estado de tu nota no está confirmado." : draft.trim() !== "" && !checked.ok ? checked.reason : saved ? "El asistente usa esta nota." : "Todavía no guardaste una nota."}
          </span>
        </div>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        {error && (
          <button type="button" className="link-btn" disabled={busy !== null} onClick={() => run("read", () => get({}))}>
            Volver a cargar nota
          </button>
        )}
        <button type="submit" className="btn btn-sm" disabled={!checked.ok || unchanged || busy !== null} aria-busy={busy === "save"}>
          {busy === "save" ? "Guardando…" : saved ? "Guardar cambios" : "Guardar nota"}
        </button>
        {saved && (
          <button type="button" className="link-btn" disabled={busy !== null} aria-busy={busy === "remove"} onClick={() => void run("remove", () => remove({}))}>
            {busy === "remove" ? "Olvidando…" : "Olvidar nota"}
          </button>
        )}
      </div>
    </form>
  );
}
