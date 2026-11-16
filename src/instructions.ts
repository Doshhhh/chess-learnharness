/** Model-facing instructions and tool descriptions for the Chess plugin. */

export const INSTRUCTIONS = `## Chess boards (Chess plugin)

Whenever a chess position, move, plan or line matters to what you are explaining, SHOW it with the \`chess_show\` tool instead of describing squares in prose. Never draw a board in text, ASCII, Markdown tables, code, SVG or images: the tool draws it. You only name positions (FEN or "start") and moves (SAN like "Nf3", or UCI like "g1f3"); the tool checks legality and tells you if something is wrong, so fix the call and retry.

Pick the form that teaches best:
- One board with arrows/highlights: a single position, a threat, a plan, a weak square. Arrows: green = good idea, red = threat/mistake, blue = alternative, yellow = attention.
- A board with "moves": any sequence — an opening line, a combination, a game fragment, "what happens if…". The learner steps through it with ◀ ▶ or autoplays it; put a short "comment" (and arrows) on the moves that matter.
- Several boards in one call: before/after, two candidate moves, a pattern in different positions.

Ask the learner to ACT whenever they can find a move themselves: use the chess move question (teaching/probing) or the chess task (practice) instead of asking them to type a move. The learner moves the pieces on a board; give the correct line in "solution" (learner move, reply, learner move…) and the board plays the replies and checks the answer. Omit "solution" only for open "what would you play?" questions you will judge yourself.

Keep explanations in your own words next to the board; the board does not replace teaching.`;

export const SHOW_DESCRIPTION =
  "Show the learner one or more chess boards. Use it for any position, threat, plan or line you discuss. " +
  "Each board: optional fen (default start), optional moves (a line the learner steps through or autoplays; a move may carry a comment, arrows and highlights shown at that moment), arrows, highlights, orientation, caption. " +
  "Moves and positions are validated; on an error nothing is shown and you get the exact problem to fix.";

export const QUESTION_DESCRIPTION =
  "Ask the learner to find a move by playing it on a chess board. payload.fen is the position (the side to move is the learner). " +
  "payload.solution is the correct line: learner move, opponent reply, learner move, … — the board plays the replies itself and checks the learner's moves; " +
  "omit it for a free 'what would you play?' question you judge yourself. Optional arrows/highlights for hints. The learner's moves and a grade come back to you.";

export const PROBLEM_DESCRIPTION =
  "Pose a chess task the learner solves by moving the pieces. payload.fen is the position (side to move = the learner); " +
  "payload.solution is the line (learner move, reply, learner move…), the board plays the replies. Put the full line with reasons in modelSolution.";
