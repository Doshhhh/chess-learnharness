/** Chess — backend activation.
 *
 * - `chess_show`: a tool for every agent that shows one or more boards (positions,
 *   arrows, highlights, or a move line the learner can step through).
 * - A teaching/probe question type whose answer is a move made on the board.
 * - A practice problem type with the same board.
 * Every position and move the model passes is validated here; the plugin draws.
 */
import { Type } from "typebox";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { ChessInputError, describeBoards, gradeTask, parseBoards, parseTask } from "./engine.ts";
import type { MoveAnswer } from "./engine.ts";
import { INSTRUCTIONS, PROBLEM_DESCRIPTION, QUESTION_DESCRIPTION, SHOW_DESCRIPTION } from "./instructions.ts";

export const SHOW_TOOL = "chess_show";
export const QUESTION_TYPE = "move";
export const PROBLEM_TYPE = "puzzle";

const ArrowSchema = Type.Union([
  Type.String({ description: 'Two squares, e.g. "e2e4" (green arrow).' }),
  Type.Object({
    from: Type.String({ description: 'Square, e.g. "g1".' }),
    to: Type.String({ description: 'Square, e.g. "f3".' }),
    color: Type.Optional(Type.Union([Type.Literal("green"), Type.Literal("red"), Type.Literal("blue"), Type.Literal("yellow")])),
  }),
]);
const HighlightSchema = Type.Union([
  Type.String({ description: 'A square, e.g. "f7" (yellow).' }),
  Type.Object({
    square: Type.String(),
    color: Type.Optional(Type.Union([Type.Literal("green"), Type.Literal("red"), Type.Literal("blue"), Type.Literal("yellow")])),
  }),
]);
const MoveSchema = Type.Union([
  Type.String({ description: 'A move in SAN ("Nf3", "O-O", "exd5", "e8=Q") or UCI ("g1f3").' }),
  Type.Object({
    move: Type.String(),
    comment: Type.Optional(Type.String({ description: "Shown under the board when the learner reaches this move." })),
    arrows: Type.Optional(Type.Array(ArrowSchema)),
    highlights: Type.Optional(Type.Array(HighlightSchema)),
  }),
]);
const BoardSchema = Type.Object({
  title: Type.Optional(Type.String({ description: "Short label above the board." })),
  fen: Type.Optional(Type.String({ description: 'FEN of the starting position, or "start". A bare piece-placement field is completed with "w - - 0 1".' })),
  moves: Type.Optional(Type.Array(MoveSchema, { description: "A line from that position. The learner steps through it with ◀ ▶ and can autoplay it." })),
  arrows: Type.Optional(Type.Array(ArrowSchema)),
  highlights: Type.Optional(Type.Array(HighlightSchema)),
  orientation: Type.Optional(Type.Union([Type.Literal("white"), Type.Literal("black")], { description: "Side shown at the bottom (default white)." })),
  startAt: Type.Optional(Type.Integer({ minimum: 0, description: "Move to open at; 0 = the starting position (default)." })),
  caption: Type.Optional(Type.String({ description: "One or two sentences under the board." })),
});
const ShowSchema = Type.Object({
  boards: Type.Array(BoardSchema, { minItems: 1, maxItems: 6, description: "One board, or several side by side (before/after, two candidate moves)." }),
});

const TaskSchema = Type.Object({
  fen: Type.String({ description: 'FEN of the task position (the side to move is the learner), or "start".' }),
  solution: Type.Optional(Type.Array(Type.String(), { description: "The correct line: learner move, opponent reply, learner move… The board plays the replies itself. Omit for a free move you will judge yourself." })),
  orientation: Type.Optional(Type.Union([Type.Literal("white"), Type.Literal("black")])),
  arrows: Type.Optional(Type.Array(ArrowSchema)),
  highlights: Type.Optional(Type.Array(HighlightSchema)),
});
const AnswerSchema = Type.Object({
  moves: Type.Array(Type.String(), { description: "Moves made on the board (SAN), learner and replies alternating." }),
});

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const payloadOf = (input: unknown): unknown =>
  input && typeof input === "object" && "payload" in (input as Record<string, unknown>) ? (input as { payload: unknown }).payload : input;

function validationErrors(run: () => void): string[] | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof ChessInputError) return [error.message];
    throw error;
  }
}

export function activate(ctx: PluginBackendContext): () => void {
  const disposers: (() => void)[] = [];

  disposers.push(ctx.registerInstructions({ agents: ["teacher", "practice", "prober"], text: INSTRUCTIONS }));

  disposers.push(
    ctx.registerTools({
      agents: ["teacher", "practice", "prober"],
      create: () => [
        {
          name: SHOW_TOOL,
          label: "Chess board",
          description: SHOW_DESCRIPTION,
          parameters: ShowSchema,
          execute: async (_toolCallId: string, params: unknown) => {
            try {
              const boards = parseBoards(params);
              return { content: [{ type: "text" as const, text: describeBoards(boards) }], details: { boards } };
            } catch (error) {
              if (error instanceof ChessInputError) {
                return { content: [{ type: "text" as const, text: `Nothing was shown: ${error.message} Fix the call and try again.` }], details: { error: error.message }, isError: true };
              }
              throw error;
            }
          },
        },
      ],
    }),
  );

  disposers.push(
    ctx.registerQuestionType({
      id: QUESTION_TYPE,
      label: "Chess move",
      contractVersion: 1,
      showThinking: true,
      questionSchema: TaskSchema,
      answerSchema: AnswerSchema,
      probe: { toolName: "chess_move_probe", description: QUESTION_DESCRIPTION },
      teach: { toolName: "chess_move_question", description: QUESTION_DESCRIPTION },
      validateQuestion: (context: { input: unknown }) => validationErrors(() => parseTask(payloadOf(context.input))),
      validateAnswer: (context: { input: unknown; answer: unknown }) =>
        validationErrors(() => {
          const answer = context.answer as MoveAnswer;
          if (!Array.isArray(answer?.moves) || answer.moves.length === 0) throw new ChessInputError("Make a move on the board first.");
        }),
      gradeAnswer: (context: { input: unknown; answer: unknown }) => {
        const grade = gradeTask(parseTask(payloadOf(context.input)), context.answer as MoveAnswer);
        return { ...grade, played: [...grade.played], expected: [...grade.expected] };
      },
    } as never),
  );

  disposers.push(
    ctx.registerProblemType({
      id: PROBLEM_TYPE,
      label: "Chess task",
      contractVersion: 1,
      tool: { toolName: "chess_problem", description: PROBLEM_DESCRIPTION },
      problemSchema: TaskSchema,
      submissionSchema: AnswerSchema,
      validateProblem: (context: { input: unknown }) => validationErrors(() => parseTask(payloadOf(context.input))),
      validateSubmission: (context: { submission: unknown }) =>
        validationErrors(() => {
          const answer = context.submission as MoveAnswer;
          if (!Array.isArray(answer?.moves) || answer.moves.length === 0) throw new ChessInputError("Make a move on the board first.");
        }),
      processSubmission: (context: { input: unknown; submission: unknown }) => {
        const grade = gradeTask(parseTask(payloadOf(context.input)), context.submission as MoveAnswer);
        return { ...grade, played: [...grade.played], expected: [...grade.expected] };
      },
    } as never),
  );

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

export { errorText };
