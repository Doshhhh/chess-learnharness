/** Chess plugin: the engine and the backend registrations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../src/backend.ts";
import { ChessInputError, START_FEN, describeBoards, gradeTask, normalizeFen, parseBoards, parseTask } from "../src/engine.ts";
import { numbered } from "../src/view/text.ts";

const ITALIAN = "r1bq1rk1/ppp2ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 0 6";

test("positions: start, full FEN, a bare placement; impossible ones are refused with a reason", () => {
  assert.equal(normalizeFen(undefined, "fen"), START_FEN);
  assert.equal(normalizeFen("start", "fen"), START_FEN);
  assert.equal(normalizeFen("8/8/8/8/8/8/8/K6k", "fen"), "8/8/8/8/8/8/8/K6k w - - 0 1");
  assert.throws(() => normalizeFen("8/8/8/8/8/8/8/8 w - - 0 1", "fen"), /not a valid position/);
  assert.throws(() => normalizeFen(42, "fen"), ChessInputError);
});

test("SAN and UCI moves expand into positions; errors tell the model what to fix", () => {
  const [board] = parseBoards({ boards: [{ title: "Italian", moves: ["e4", "e7e5", { move: "Nf3", comment: "Attack e5", arrows: ["f3e5"] }, "Nc6", "Bc4"] }] });
  assert.deepEqual(board!.plies.map((ply) => ply.san), ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  assert.equal(board!.plies[2]!.comment, "Attack e5");
  assert.deepEqual(board!.plies[2]!.arrows, [{ from: "f3", to: "e5", color: "green" }]);
  assert.equal(board!.plies[1]!.from, "e7");
  assert.match(describeBoards([board!]), /Line: e4 e5 Nf3 Nc6 Bc4\. Final FEN:/);

  assert.throws(() => parseBoards({ boards: [{ moves: ["e4", "e4"] }] }), (error: Error) =>
    error instanceof ChessInputError && /boards\[0\]\.moves\[1\]: "e4" is not legal here \(Black to move\)\. Legal moves: .*e5/.test(error.message));
  assert.throws(() => parseBoards({ boards: [] }), /at least one board/);
  assert.throws(() => parseBoards({ boards: [{ arrows: ["e2"] }] }), /two squares/);
  assert.throws(() => parseBoards({ boards: Array.from({ length: 7 }, () => ({})) }), /At most 6/);
});

test("tasks check the solution line and grade the learner's moves", () => {
  const task = parseTask({ fen: ITALIAN, solution: ["Ng5", "h6", "Nxf7"] });
  assert.equal(task.learnerMoves, 2);
  assert.equal(task.orientation, "white");
  assert.equal(gradeTask(task, { moves: ["Ng5", "h6", "Nxf7"] }).correct, true);
  const wrong = gradeTask(task, { moves: ["Nxe5"] });
  assert.equal(wrong.correct, false);
  assert.match(wrong.note, /Learner move 1 was Nxe5; the solution plays Ng5/);
  assert.equal(gradeTask(parseTask({ fen: ITALIAN }), { moves: ["h3"] }).correct, null, "a free move is judged by the teacher");
  assert.throws(() => parseTask({ fen: ITALIAN, solution: ["Nxf7"] }), /payload\.solution\[0\]: "Nxf7" is not legal/);
  assert.throws(() => parseTask({ fen: "7k/5QQ1/8/8/8/8/8/K7 b - - 0 1" }), /already over/);
});

test("a different mate of the same length also counts", () => {
  // White to move: Qg7# and Qh7# both mate.
  const task = parseTask({ fen: "7k/8/6KQ/8/8/8/8/8 w - - 0 1", solution: ["Qh7#"] });
  assert.equal(gradeTask(task, { moves: ["Qg7#"] }).correct, true);
  assert.match(gradeTask(task, { moves: ["Qg7#"] }).note, /different mate/);
});

test("move numbering continues from the FEN and marks Black's first move", () => {
  assert.deepEqual(numbered(["e4", "e5", "Nf3"], START_FEN).map((entry) => entry.label), ["1. e4", "e5", "2. Nf3"]);
  assert.deepEqual(numbered(["h6", "Nxf7"], "r1bq1rk1/ppp2ppp/2n2n2/2b1p1N1/2B1P3/3P4/PPP2PPP/RNBQ1RK1 b - - 1 6").map((entry) => entry.label), ["6… h6", "7. Nxf7"]);
});

test("the backend registers instructions, the show tool, a teaching question and a practice task", async () => {
  const registered: Record<string, unknown[]> = { instructions: [], tools: [], questions: [], problems: [] };
  const ctx = {
    registerInstructions: (value: unknown) => { registered.instructions!.push(value); return () => {}; },
    registerTools: (value: unknown) => { registered.tools!.push(value); return () => {}; },
    registerQuestionType: (value: unknown) => { registered.questions!.push(value); return () => {}; },
    registerProblemType: (value: unknown) => { registered.problems!.push(value); return () => {}; },
  };
  const cleanup = activate(ctx as never);
  const instructions = registered.instructions![0] as { agents: string[]; text: string };
  assert.deepEqual(instructions.agents, ["teacher", "practice", "prober"]);
  assert.match(instructions.text, /Never draw a board in text/);

  const tools = (registered.tools![0] as { create: () => { name: string; execute: (id: string, params: unknown) => Promise<{ content: { text: string }[]; isError?: boolean; details: unknown }> }[] }).create();
  assert.equal(tools[0]!.name, "chess_show");
  const ok = await tools[0]!.execute("call-1", { boards: [{ moves: ["e4", "e5"] }] });
  assert.equal(ok.isError, undefined);
  assert.match(ok.content[0]!.text, /Board 1 shown to the learner/);
  const bad = await tools[0]!.execute("call-2", { boards: [{ moves: ["e5"] }] });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]!.text, /Nothing was shown: .*"e5" is not legal here \(White to move\)/);

  const question = registered.questions![0] as {
    teach: { toolName: string };
    validateQuestion: (context: unknown) => string[] | undefined;
    gradeAnswer: (context: unknown) => { correct: boolean };
  };
  assert.equal(question.teach.toolName, "chess_move_question");
  assert.equal(question.validateQuestion({ input: { question: "Find it", payload: { fen: ITALIAN, solution: ["Ng5"] } } }), undefined);
  assert.match(question.validateQuestion({ input: { question: "x", payload: { fen: ITALIAN, solution: ["Qxf7"] } } })![0]!, /not legal/);
  assert.equal(question.gradeAnswer({ input: { question: "x", payload: { fen: ITALIAN, solution: ["Ng5"] } }, answer: { moves: ["Ng5"] } }).correct, true);

  const problem = registered.problems![0] as { tool: { toolName: string }; processSubmission: (context: unknown) => { correct: boolean } };
  assert.equal(problem.tool.toolName, "chess_problem");
  assert.equal(problem.processSubmission({ input: { statement: "s", mode: "recall", modelSolution: "m", payload: { fen: ITALIAN, solution: ["Ng5"] } }, submission: { moves: ["h3"] } }).correct, false);
  cleanup();
});
