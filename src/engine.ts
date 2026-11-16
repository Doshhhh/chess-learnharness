/** Chess engine helpers shared by the backend and the frontend (pure).
 *
 * The model only names positions (FEN) and moves (SAN like "Nf3" or UCI like
 * "g1f3"); everything here validates them with chess.js and expands them into
 * the positions the board draws. Error messages are written for the model, so it
 * can correct its call on the next try.
 */
import { Chess, validateFen } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const ARROW_COLORS = ["green", "red", "blue", "yellow"] as const;
export type ArrowColor = (typeof ARROW_COLORS)[number];

export interface Arrow {
  readonly from: string;
  readonly to: string;
  readonly color: ArrowColor;
}

export interface Highlight {
  readonly square: string;
  readonly color: ArrowColor;
}

/** One move of a line, with what the board shows after it. */
export interface Ply {
  readonly san: string;
  readonly from: string;
  readonly to: string;
  readonly fen: string;
  readonly comment?: string;
  readonly arrows: readonly Arrow[];
  readonly highlights: readonly Highlight[];
}

export interface BoardModel {
  readonly title?: string;
  readonly caption?: string;
  readonly fen: string;
  readonly orientation: "white" | "black";
  readonly arrows: readonly Arrow[];
  readonly highlights: readonly Highlight[];
  readonly plies: readonly Ply[];
  /** Ply index to open at: 0 = the start position, plies.length = after the last move. */
  readonly startAt: number;
}

export class ChessInputError extends Error {}

const SQUARE = /^[a-h][1-8]$/;
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function text(value: unknown, path: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ChessInputError(`${path} must be text.`);
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function normalizeFen(value: unknown, path: string): string {
  if (value === undefined || value === null || value === "" || value === "start") return START_FEN;
  if (typeof value !== "string") throw new ChessInputError(`${path} must be a FEN string or "start".`);
  let fen = value.trim().replace(/\s+/g, " ");
  // Accept a bare piece-placement field and complete it with sensible defaults.
  const fields = fen.split(" ");
  if (fields.length === 1) fen = `${fen} w - - 0 1`;
  else if (fields.length < 6) fen = [...fields, ...["w", "-", "-", "0", "1"].slice(fields.length - 1)].join(" ");
  const verdict = validateFen(fen);
  if (!verdict.ok) throw new ChessInputError(`${path} is not a valid position: ${verdict.error}`);
  return fen;
}

function color(value: unknown, fallback: ArrowColor): ArrowColor {
  return typeof value === "string" && (ARROW_COLORS as readonly string[]).includes(value) ? (value as ArrowColor) : fallback;
}

export function parseArrows(value: unknown, path: string): Arrow[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ChessInputError(`${path} must be a list like ["e2e4", {"from":"g1","to":"f3","color":"red"}].`);
  return value.slice(0, 12).map((entry, index) => {
    if (typeof entry === "string") {
      const match = /^([a-h][1-8])-?([a-h][1-8])$/.exec(entry.trim());
      if (!match) throw new ChessInputError(`${path}[${index}] "${entry}" must be two squares, e.g. "e2e4".`);
      return { from: match[1]!, to: match[2]!, color: "green" as const };
    }
    if (!isRecord(entry) || typeof entry.from !== "string" || typeof entry.to !== "string" || !SQUARE.test(entry.from) || !SQUARE.test(entry.to)) {
      throw new ChessInputError(`${path}[${index}] needs "from" and "to" squares like "e2".`);
    }
    return { from: entry.from, to: entry.to, color: color(entry.color, "green") };
  });
}

export function parseHighlights(value: unknown, path: string): Highlight[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ChessInputError(`${path} must be a list of squares like ["f7", {"square":"e5","color":"red"}].`);
  return value.slice(0, 32).map((entry, index) => {
    const square = typeof entry === "string" ? entry.trim() : isRecord(entry) ? entry.square : undefined;
    if (typeof square !== "string" || !SQUARE.test(square)) throw new ChessInputError(`${path}[${index}] must be a square like "f7".`);
    return { square, color: isRecord(entry) ? color(entry.color, "yellow") : "yellow" };
  });
}

/** Play one move given as SAN ("Nf3", "O-O", "exd5") or UCI ("g1f3", "e7e8q"). */
export function playMove(game: Chess, move: string): { san: string; from: string; to: string } {
  const clean = move.trim().replace(/[!?]+$/, "").replace(/^\d+\.(\.\.)?\s*/, "").replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O");
  const uci = UCI.exec(clean);
  try {
    const result = uci ? game.move({ from: uci[1]!, to: uci[2]!, promotion: uci[3] ?? "q" }) : game.move(clean);
    return { san: result.san, from: result.from, to: result.to };
  } catch {
    const legal = game.moves().slice(0, 30).join(" ");
    const side = game.turn() === "w" ? "White" : "Black";
    throw new ChessInputError(`"${move}" is not legal here (${side} to move). Legal moves: ${legal || "none — the game is over"}.`);
  }
}

/** Validate one board from the model and expand its moves into positions. */
export function parseBoard(value: unknown, path = "board"): BoardModel {
  if (!isRecord(value)) throw new ChessInputError(`${path} must be an object.`);
  const fen = normalizeFen(value.fen, `${path}.fen`);
  const game = new Chess(fen);
  const rawMoves = value.moves === undefined || value.moves === null ? [] : value.moves;
  if (!Array.isArray(rawMoves)) throw new ChessInputError(`${path}.moves must be a list of moves like ["e4", "e5", "Nf3"].`);
  if (rawMoves.length > 120) throw new ChessInputError(`${path}.moves is too long: at most 120 moves per board.`);
  const plies: Ply[] = rawMoves.map((entry, index) => {
    const item = typeof entry === "string" ? { move: entry } : entry;
    if (!isRecord(item) || typeof item.move !== "string") throw new ChessInputError(`${path}.moves[${index}] must be a move like "Nf3" or {"move":"Nf3","comment":"…"}.`);
    let played: { san: string; from: string; to: string };
    try {
      played = playMove(game, item.move);
    } catch (error) {
      throw new ChessInputError(`${path}.moves[${index}]: ${(error as Error).message}`);
    }
    const comment = text(item.comment, `${path}.moves[${index}].comment`, 600);
    return {
      ...played,
      fen: game.fen(),
      ...(comment ? { comment } : {}),
      arrows: parseArrows(item.arrows, `${path}.moves[${index}].arrows`),
      highlights: parseHighlights(item.highlights, `${path}.moves[${index}].highlights`),
    };
  });
  const orientation = value.orientation === "black" ? "black" : "white";
  const startAt = typeof value.startAt === "number" && Number.isInteger(value.startAt) ? Math.max(0, Math.min(plies.length, value.startAt)) : 0;
  const title = text(value.title, `${path}.title`, 120);
  const caption = text(value.caption, `${path}.caption`, 600);
  return {
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    fen,
    orientation,
    arrows: parseArrows(value.arrows, `${path}.arrows`),
    highlights: parseHighlights(value.highlights, `${path}.highlights`),
    plies,
    startAt,
  };
}

export function parseBoards(value: unknown): BoardModel[] {
  const list = isRecord(value) && Array.isArray(value.boards) ? value.boards : isRecord(value) ? [value] : null;
  if (!list || list.length === 0) throw new ChessInputError('Pass "boards": a list with at least one board.');
  if (list.length > 6) throw new ChessInputError("At most 6 boards per call.");
  return list.map((board, index) => parseBoard(board, `boards[${index}]`));
}

/** A short text the model reads back: what each board now shows. */
export function describeBoards(boards: readonly BoardModel[]): string {
  return boards
    .map((board, index) => {
      const last = board.plies.at(-1);
      const line = board.plies.length ? ` Line: ${board.plies.map((ply) => ply.san).join(" ")}. Final FEN: ${last!.fen}.` : ` FEN: ${board.fen}.`;
      return `Board ${index + 1}${board.title ? ` "${board.title}"` : ""} shown to the learner (${board.orientation} at the bottom).${line}`;
    })
    .join("\n");
}

// ── Tasks ─────────────────────────────────────────────────────────────

export interface TaskModel {
  readonly fen: string;
  readonly orientation: "white" | "black";
  /** Learner and opponent moves alternating, starting with the learner. Empty = free move. */
  readonly solution: readonly string[];
  readonly learnerMoves: number;
  readonly arrows: readonly Arrow[];
  readonly highlights: readonly Highlight[];
}

/** Validate a task: the position, and that the solution line is legal. */
export function parseTask(value: unknown): TaskModel {
  if (!isRecord(value)) throw new ChessInputError("payload must be an object.");
  const fen = normalizeFen(value.fen, "payload.fen");
  const game = new Chess(fen);
  if (game.isGameOver()) throw new ChessInputError("payload.fen: the game is already over in this position; there is no move to make.");
  const raw = value.solution === undefined || value.solution === null ? [] : value.solution;
  if (!Array.isArray(raw) || raw.some((move) => typeof move !== "string")) throw new ChessInputError('payload.solution must be a list of moves like ["Ng5", "h6", "Bxf7+"].');
  if (raw.length > 21) throw new ChessInputError("payload.solution is too long: at most 11 learner moves.");
  const solution = (raw as string[]).map((move, index) => {
    try {
      return playMove(game, move).san;
    } catch (error) {
      throw new ChessInputError(`payload.solution[${index}]: ${(error as Error).message}`);
    }
  });
  const side = new Chess(fen).turn();
  return {
    fen,
    orientation: value.orientation === "black" || value.orientation === "white" ? value.orientation : side === "w" ? "white" : "black",
    solution,
    learnerMoves: Math.max(1, Math.ceil(solution.length / 2)),
    arrows: parseArrows(value.arrows, "payload.arrows"),
    highlights: parseHighlights(value.highlights, "payload.highlights"),
  };
}

export interface MoveAnswer {
  readonly moves: readonly string[];
}

export interface Grade {
  readonly correct: boolean | null;
  readonly played: readonly string[];
  readonly expected: readonly string[];
  readonly finalFen: string;
  readonly note: string;
}

/** Compare the learner's line with the task; an equally decisive mate also counts. */
export function gradeTask(task: TaskModel, answer: MoveAnswer): Grade {
  const game = new Chess(task.fen);
  const played: string[] = [];
  for (const move of answer.moves) {
    try {
      played.push(playMove(game, move).san);
    } catch {
      return { correct: false, played, expected: task.solution, finalFen: game.fen(), note: `The move "${move}" is not legal in the reached position.` };
    }
  }
  if (task.solution.length === 0) {
    return { correct: null, played, expected: [], finalFen: game.fen(), note: "Free move: no fixed solution; judge the move yourself." };
  }
  const learnerExpected = task.solution.filter((_, index) => index % 2 === 0);
  const learnerPlayed = played.filter((_, index) => index % 2 === 0);
  const sameLine = learnerExpected.every((move, index) => learnerPlayed[index] === move) && learnerPlayed.length >= learnerExpected.length;
  const mated = game.isCheckmate() && game.turn() !== new Chess(task.fen).turn();
  const solutionMates = (() => {
    const check = new Chess(task.fen);
    for (const move of task.solution) check.move(move);
    return check.isCheckmate();
  })();
  if (sameLine) return { correct: true, played, expected: task.solution, finalFen: game.fen(), note: "The learner found the solution line." };
  if (mated && solutionMates && learnerPlayed.length <= learnerExpected.length) {
    return { correct: true, played, expected: task.solution, finalFen: game.fen(), note: "The learner found a different mate of the same length." };
  }
  const firstWrong = learnerPlayed.findIndex((move, index) => move !== learnerExpected[index]);
  return {
    correct: false,
    played,
    expected: task.solution,
    finalFen: game.fen(),
    note: firstWrong >= 0 ? `Learner move ${firstWrong + 1} was ${learnerPlayed[firstWrong]}; the solution plays ${learnerExpected[firstWrong]}.` : "The learner stopped before completing the line.",
  };
}
