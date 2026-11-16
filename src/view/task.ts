/** The answer board for chess questions and practice tasks.
 *
 * The learner moves the pieces; after a move that matches the solution the board
 * plays the opponent's reply. A move off the solution ends the attempt (the
 * learner may undo or submit it — the teacher sees what was played).
 */
import { Chess } from "chess.js";
import { parseBoard, playMove } from "../engine.ts";
import type { Grade, TaskModel } from "../engine.ts";
import { createBoard } from "./board.ts";
import { mountBoardCard } from "./playback.ts";
import { T, numbered } from "./text.ts";

export type AnswerState = { status: "empty" } | { status: "unready" | "ready"; value: unknown };

export interface TaskEditor {
  update(answer: AnswerState, active: boolean): void;
  focus(): void;
  dispose(): void;
}

const movesOf = (state: AnswerState): string[] =>
  state.status !== "empty" && state.value && typeof state.value === "object" && Array.isArray((state.value as { moves?: unknown }).moves)
    ? ((state.value as { moves: unknown[] }).moves.filter((move) => typeof move === "string") as string[])
    : [];

export function mountTaskEditor(container: HTMLElement, task: TaskModel, initial: AnswerState, onChange: (state: AnswerState) => void, signal: AbortSignal): TaskEditor {
  const document = container.ownerDocument;
  const root = document.createElement("div");
  root.className = "ch-root ch-task";
  const card = document.createElement("div");
  card.className = "ch-card";
  const view = createBoard(document, signal);
  const status = document.createElement("div");
  status.className = "ch-status";
  const line = document.createElement("div");
  line.className = "ch-moves";
  const actions = document.createElement("div");
  actions.className = "ch-actions";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "ch-text-btn";
  undo.textContent = T.undo;
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ch-text-btn";
  reset.textContent = T.reset;
  actions.append(undo, reset);
  card.append(view.element, status, line, actions);
  root.append(card);
  container.append(root);

  const learnerIsWhite = new Chess(task.fen).turn() === "w";
  const maxPlies = task.solution.length > 0 ? task.solution.length : 1;
  let moves: string[] = [];
  let offLine = false;
  let replyTimer: ReturnType<typeof setTimeout> | null = null;
  let active = true;

  const game = (): Chess => {
    const chess = new Chess(task.fen);
    for (const move of moves) chess.move(move);
    return chess;
  };
  const learnerTurn = (): boolean => moves.length % 2 === 0 && !offLine && moves.length < maxPlies && replyTimer === null;

  function publish(): void {
    onChange(moves.length === 0 ? { status: "empty" } : { status: "ready", value: { moves: [...moves] } });
  }

  function render(animate: { from: string; to: string } | null): void {
    const chess = game();
    const history = chess.history({ verbose: true });
    const lastMove = history.at(-1);
    view.set(
      {
        fen: chess.fen(),
        orientation: task.orientation,
        arrows: moves.length === 0 ? task.arrows : [],
        highlights: moves.length === 0 ? task.highlights : [],
        lastMove: lastMove ? { from: lastMove.from, to: lastMove.to } : null,
      },
      animate,
    );
    view.setInteraction(active && learnerTurn() && !chess.isGameOver() ? interaction : null);
    status.textContent = replyTimer
      ? T.opponent
      : offLine
        ? T.offLine
        : moves.length >= maxPlies || chess.isGameOver()
          ? T.done
          : T.yourMove(learnerIsWhite);
    line.replaceChildren(...numbered(moves, task.fen).map((entry) => {
      const span = document.createElement("span");
      span.className = "ch-move ch-static";
      span.textContent = entry.label;
      return span;
    }));
    undo.disabled = moves.length === 0;
    reset.disabled = moves.length === 0;
  }

  const interaction = {
    targets(from: string): string[] {
      const chess = game();
      const piece = chess.get(from as never);
      if (!piece || piece.color !== chess.turn()) return [];
      return chess.moves({ square: from as never, verbose: true }).map((move) => move.to);
    },
    isPromotion(from: string, to: string): boolean {
      const piece = game().get(from as never);
      return piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    },
    move(from: string, to: string, promotion?: string): void {
      const chess = game();
      let san: string;
      try {
        san = playMove(chess, `${from}${to}${promotion ?? ""}`).san;
      } catch {
        render(null);
        return;
      }
      moves = [...moves, san];
      const index = moves.length - 1;
      if (task.solution.length > 0 && task.solution[index] !== san) {
        // A different mate is still a full answer; anything else leaves the line.
        offLine = !(chess.isCheckmate());
      }
      const reply = task.solution[moves.length];
      if (!offLine && reply && task.solution[index] === san) {
        // The opponent answers after the learner's move has finished sliding.
        replyTimer = setTimeout(() => {
          replyTimer = null;
          if (signal.aborted) return;
          const played = playMove(game(), reply);
          moves = [...moves, played.san];
          render({ from: played.from, to: played.to });
          publish();
        }, 650);
      }
      render({ from, to });
      publish();
    },
  };

  undo.addEventListener("click", () => {
    if (replyTimer) clearTimeout(replyTimer);
    replyTimer = null;
    // Take back the learner's last move together with the reply that followed it.
    const keep = moves.length % 2 === 0 ? moves.length - 2 : moves.length - 1;
    moves = moves.slice(0, Math.max(0, keep));
    offLine = false;
    render(null);
    publish();
  }, { signal });
  reset.addEventListener("click", () => {
    if (replyTimer) clearTimeout(replyTimer);
    replyTimer = null;
    moves = [];
    offLine = false;
    render(null);
    publish();
  }, { signal });

  function restore(state: AnswerState): void {
    const wanted = movesOf(state);
    if (wanted.join(" ") === moves.join(" ")) return;
    const chess = new Chess(task.fen);
    const valid: string[] = [];
    for (const move of wanted) {
      try {
        valid.push(playMove(chess, move).san);
      } catch {
        break;
      }
    }
    moves = valid;
    offLine = task.solution.length > 0 && valid.some((move, index) => task.solution[index] !== move) && !chess.isCheckmate();
  }

  restore(initial);
  render(null);
  signal.addEventListener("abort", () => {
    if (replyTimer) clearTimeout(replyTimer);
    root.remove();
  }, { once: true });

  return {
    update(answer, nextActive) {
      active = nextActive;
      restore(answer);
      render(null);
    },
    focus() {
      view.element.querySelector<HTMLElement>(".ch-board")?.focus?.();
    },
    dispose() {
      if (replyTimer) clearTimeout(replyTimer);
      root.remove();
    },
  };
}

/** After submission: the played line to step through, and the verdict. */
export function mountTaskAnswered(container: HTMLElement, task: TaskModel, played: readonly string[], grade: Grade | null, signal: AbortSignal): void {
  const document = container.ownerDocument;
  const root = document.createElement("div");
  root.className = "ch-root ch-task";
  const model = parseBoard({ fen: task.fen, moves: [...played], orientation: task.orientation, startAt: played.length });
  root.append(mountBoardCard(document, model, signal));
  if (grade && grade.correct !== null) {
    const verdict = document.createElement("div");
    verdict.className = `ch-verdict ${grade.correct ? "ch-good" : "ch-bad"}`;
    const title = document.createElement("strong");
    title.textContent = grade.correct ? T.correct : T.wrong;
    verdict.append(title);
    if (!grade.correct && grade.expected.length) {
      const expected = document.createElement("span");
      expected.textContent = T.expected(numbered(grade.expected, task.fen).map((entry) => entry.label).join(" "));
      verdict.append(expected);
    }
    root.append(verdict);
  }
  container.append(root);
  signal.addEventListener("abort", () => root.remove(), { once: true });
}
