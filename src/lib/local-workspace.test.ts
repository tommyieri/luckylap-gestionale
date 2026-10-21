import { describe, expect, it } from "vitest";
import { mergeWorkspaceField, readLocalWorkspace } from "./local-workspace";

const appointment = {
  id: "appointment-1",
  title: "Ritiro campioni",
  date: "2026-10-21",
  time: "09:30",
  notes: "Portare i tessuti",
};
const task = { id: "task-1", title: "Ordinare materiali", done: false, due: "2026-10-22" };

describe("local workspace", () => {
  it("keeps another tab's note when saving only tasks from the latest snapshot", () => {
    const original = JSON.stringify({ appointments: [appointment], tasks: [], note: "" });
    const tabA = mergeWorkspaceField(original, "note", "Nota scritta nella scheda A");
    const tabB = mergeWorkspaceField(JSON.stringify(tabA.workspace), "tasks", [task]);

    expect(tabB.issue).toBe(false);
    expect(tabB.workspace.note).toBe("Nota scritta nella scheda A");
    expect(tabB.workspace.tasks).toEqual([task]);
    expect(tabB.workspace.appointments).toEqual([appointment]);
  });

  it("reads the existing storage format and optional appointment metadata", () => {
    const savedAppointment = { ...appointment, participants: "Tommi, Gabriele", link: "https://example.com/call" };
    const workspace = { appointments: [savedAppointment], tasks: [task], note: "Una nota" };

    expect(readLocalWorkspace(JSON.stringify(workspace))).toEqual({ workspace, issue: false });
  });

  it("starts an unsaved workspace without reporting corruption", () => {
    expect(readLocalWorkspace(null)).toEqual({
      workspace: { appointments: [], tasks: [], note: "" },
      issue: false,
    });
  });

  it.each(["", "{broken", "null", "[]", "42", '"text"', "{}"])(
    "reports invalid storage %j instead of silently treating it as empty",
    (raw) => {
      expect(readLocalWorkspace(raw)).toEqual({
        workspace: { appointments: [], tasks: [], note: "" },
        issue: true,
      });
    },
  );

  it("recovers valid records and marks malformed fields or records", () => {
    const result = readLocalWorkspace(JSON.stringify({
      appointments: [appointment, null, { ...appointment, id: "invalid", date: "2026-02-30" }],
      tasks: [task, null, { id: "task-2", title: "Controllare", done: "yes", due: "invalid" }],
      note: 42,
    }));

    expect(result).toEqual({
      workspace: {
        appointments: [appointment],
        tasks: [task, { id: "task-2", title: "Controllare", done: false, due: "" }],
        note: "",
      },
      issue: true,
    });
  });

  it.each([
    { date: "2026-02-29" },
    { date: "2024-13-01" },
    { date: "2024-00-10" },
    { date: "0000-01-01" },
    { date: "2026-1-01" },
    { time: "24:00" },
    { time: "09:60" },
    { time: "9:00" },
    { title: "   " },
    { id: "" },
  ])("discards an appointment that cannot be rendered safely: %j", (invalidFields) => {
    const result = readLocalWorkspace(JSON.stringify({
      appointments: [{ ...appointment, ...invalidFields }], tasks: [], note: "",
    }));

    expect(result.workspace.appointments).toEqual([]);
    expect(result.issue).toBe(true);
  });

  it("accepts leap dates and midnight while normalizing unsafe optional values", () => {
    const result = readLocalWorkspace(JSON.stringify({
      appointments: [{ ...appointment, date: "2024-02-29", time: "00:00", notes: null, participants: 5, link: "javascript:alert(1)" }],
      tasks: [{ ...task, due: "2026-02-30" }],
      note: "Conservata",
    }));

    expect(result).toEqual({
      workspace: {
        appointments: [{ ...appointment, date: "2024-02-29", time: "00:00", notes: "", participants: "", link: "" }],
        tasks: [{ ...task, due: "" }],
        note: "Conservata",
      },
      issue: true,
    });
  });

  it.each(["https://example.com/call", "http://example.com/call"])("keeps a safe call URL %s", (link) => {
    const result = readLocalWorkspace(JSON.stringify({ appointments: [{ ...appointment, link }], tasks: [], note: "" }));
    expect(result.workspace.appointments[0].link).toBe(link);
    expect(result.issue).toBe(false);
  });

  it.each(["//example.com/call", "data:text/html,hello", "ftp://example.com", "not a URL"])("removes an unsafe call URL %s", (link) => {
    const result = readLocalWorkspace(JSON.stringify({ appointments: [{ ...appointment, link }], tasks: [], note: "" }));
    expect(result.workspace.appointments[0].link).toBe("");
    expect(result.issue).toBe(true);
  });

  it("does not apply a write over corrupt storage even when valid data is recoverable", () => {
    const raw = JSON.stringify({ appointments: [appointment, null], tasks: [task], note: "Nota recuperabile" });
    const result = mergeWorkspaceField(raw, "note", "Nuova nota");

    expect(result.issue).toBe(true);
    expect(result.workspace.note).toBe("Nota recuperabile");
    expect(result.workspace.appointments).toEqual([appointment]);
    expect(result.workspace.tasks).toEqual([task]);
  });
});
