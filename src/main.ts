/** Chess — frontend: renders `chess_show` boards, the move-question answer board
 * and the practice task board. The host keeps the question text, cards and answers. */
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { ChessInputError, gradeTask, parseBoards, parseTask } from "./engine.ts";
import type { BoardModel, Grade, TaskModel } from "./engine.ts";
import { mountBoards } from "./view/playback.ts";
import { mountTaskAnswered, mountTaskEditor } from "./view/task.ts";
import type { AnswerState } from "./view/task.ts";
import { T } from "./view/text.ts";

const payloadOf = (input: unknown): unknown =>
  input && typeof input === "object" && "payload" in (input as Record<string, unknown>) ? (input as { payload: unknown }).payload : input;

function boardsFrom(output: unknown, input: unknown): BoardModel[] | null {
  const details = output && typeof output === "object" ? (output as { boards?: unknown }).boards : undefined;
  if (Array.isArray(details) && details.length > 0) return details as BoardModel[];
  try {
    return parseBoards(input);
  } catch {
    return null;
  }
}

function note(container: HTMLElement, text: string, signal: AbortSignal): void {
  const node = container.ownerDocument.createElement("p");
  node.className = "ch-note";
  node.textContent = text;
  container.append(node);
  signal.addEventListener("abort", () => node.remove(), { once: true });
}

function gradeFrom(value: unknown): Grade | null {
  const result = value && typeof value === "object" && "result" in (value as Record<string, unknown>) ? (value as { result: unknown }).result : null;
  return result && typeof result === "object" && "played" in (result as Record<string, unknown>) ? (result as Grade) : null;
}

function taskOf(input: unknown): TaskModel | null {
  try {
    return parseTask(payloadOf(input));
  } catch (error) {
    if (error instanceof ChessInputError) return null;
    throw error;
  }
}

const movesIn = (value: unknown): string[] =>
  value && typeof value === "object" && Array.isArray((value as { moves?: unknown }).moves) ? ((value as { moves: unknown[] }).moves.filter((move) => typeof move === "string") as string[]) : [];

export function activate(ctx: PluginFrontendContext): () => void {
  const disposers: (() => void)[] = [];

  disposers.push(
    ctx.registerToolRenderer({
      toolName: "chess_show",
      backgroundPresentation: "plain",
      mount(container, tool) {
        if (tool.state === "input-streaming") return note(container, T.loading, tool.signal);
        if (tool.state === "output-error" || tool.result?.isError) return note(container, `${T.unavailable}: ${tool.errorText ?? ""}`.trim(), tool.signal);
        const boards = boardsFrom(tool.result?.details ?? tool.output, tool.input);
        if (!boards) return note(container, T.unavailable, tool.signal);
        mountBoards(container, boards, tool.signal);
      },
    }),
  );

  disposers.push(
    ctx.registerQuestionRenderer({
      id: "move",
      supportedContractVersions: [1],
      mountAnswerEditor(container, context) {
        const task = taskOf(context.input);
        if (!task) {
          note(container, T.unavailable, context.signal);
          return { update() {}, focus() {}, dispose() {} };
        }
        const editor = mountTaskEditor(container, task, context.answer as AnswerState, (state) => context.onChange(state as never), context.signal);
        return {
          update: (props) => editor.update(props.answer as AnswerState, props.active),
          focus: () => editor.focus(),
          dispose: () => editor.dispose(),
        };
      },
      mountAnswered(container, context) {
        const task = taskOf(context.input);
        if (!task) return note(container, T.unavailable, context.signal);
        const played = movesIn(context.answer);
        mountTaskAnswered(container, task, played, gradeFrom(context.grading) ?? gradeTask(task, { moves: played }), context.signal);
      },
    }),
  );

  disposers.push(
    ctx.registerProblemRenderer({
      id: "puzzle",
      supportedContractVersions: [1],
      mountSubmissionEditor(container, context) {
        const task = taskOf(context.input);
        if (!task) {
          note(container, T.unavailable, context.signal);
          return { update() {}, focus() {}, dispose() {} };
        }
        const editor = mountTaskEditor(container, task, context.submission as AnswerState, (state) => context.onChange(state as never), context.signal);
        return {
          update: (props) => editor.update(props.submission as AnswerState, props.active),
          focus: () => editor.focus(),
          dispose: () => editor.dispose(),
        };
      },
      mountSubmitted(container, context) {
        const task = taskOf(context.input);
        if (!task) return note(container, T.unavailable, context.signal);
        const played = movesIn(context.submission);
        mountTaskAnswered(container, task, played, gradeFrom(context.processing) ?? gradeTask(task, { moves: played }), context.signal);
      },
    }),
  );

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
