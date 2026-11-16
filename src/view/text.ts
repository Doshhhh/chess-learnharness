/** Interface strings (ru/en). "Auto" is the primary system language, like LearnHarness. */
const ru = (globalThis.navigator?.language ?? "en").toLowerCase().startsWith("ru");

export const T = {
  start: ru ? "Начальная позиция" : "Start position",
  first: ru ? "В начало" : "First",
  prev: ru ? "Назад" : "Previous",
  next: ru ? "Вперёд" : "Next",
  last: ru ? "В конец" : "Last",
  play: ru ? "Проиграть" : "Play",
  pause: ru ? "Пауза" : "Pause",
  undo: ru ? "Отменить ход" : "Undo",
  reset: ru ? "Сначала" : "Reset",
  yourMove: (white: boolean) => (ru ? `Ваш ход: ${white ? "белые" : "чёрные"}` : `Your move: ${white ? "White" : "Black"}`),
  opponent: ru ? "Ход соперника…" : "Opponent is moving…",
  done: ru ? "Готово — можно отправлять" : "Done — you can submit",
  offLine: ru ? "Ход сделан — можно отправить или отменить" : "Move made — submit it or undo",
  correct: ru ? "Верно" : "Correct",
  wrong: ru ? "Не то" : "Not quite",
  expected: (line: string) => (ru ? `Решение: ${line}` : `Solution: ${line}`),
  played: (line: string) => (ru ? `Ваши ходы: ${line}` : `Your moves: ${line}`),
  unavailable: ru ? "Доску не удалось показать" : "The board could not be shown",
  loading: ru ? "Расставляю фигуры…" : "Setting up the board…",
};

/** "1. e4 e5 2. Nf3" numbering for a line starting from a FEN. */
export function numbered(sans: readonly string[], fen: string): { label: string; ply: number }[] {
  const fields = fen.split(" ");
  let moveNumber = Number(fields[5] ?? "1") || 1;
  let white = (fields[1] ?? "w") === "w";
  return sans.map((san, index) => {
    const label = white ? `${moveNumber}. ${san}` : index === 0 ? `${moveNumber}… ${san}` : san;
    if (!white) moveNumber += 1;
    white = !white;
    return { label, ply: index + 1 };
  });
}
