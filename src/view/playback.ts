/** Boards shown by `chess_show`: a position, or a line to step through and autoplay. */
import type { BoardModel } from "../engine.ts";
import { createBoard } from "./board.ts";
import { T, numbered } from "./text.ts";

const ICONS = {
  first: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3v10M12 3L6 8l6 5"/></svg>',
  prev: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>',
  next: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  last: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3v10M4 3l6 5-6 5"/></svg>',
  play: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3l8 5-8 5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>',
};

function iconButton(document: Document, icon: string, label: string, onClick: () => void, signal: AbortSignal): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ch-ctl";
  button.innerHTML = icon; // static icon constants only
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick, { signal });
  return button;
}

export function mountBoardCard(document: Document, model: BoardModel, signal: AbortSignal): HTMLElement {
  const card = document.createElement("figure");
  card.className = "ch-card";
  if (model.title) {
    const title = document.createElement("figcaption");
    title.className = "ch-title";
    title.textContent = model.title;
    card.append(title);
  }
  const view = createBoard(document, signal);
  card.append(view.element);

  let ply = model.startAt;
  let timer: ReturnType<typeof setInterval> | null = null;
  const hasLine = model.plies.length > 0;

  const comment = document.createElement("p");
  comment.className = "ch-comment";
  const moves = document.createElement("div");
  moves.className = "ch-moves";
  const position = document.createElement("span");
  position.className = "ch-position";

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    playButton.innerHTML = ICONS.play;
    playButton.title = T.play;
    playButton.setAttribute("aria-label", T.play);
  };

  function show(next: number, animate: boolean): void {
    const previous = ply;
    ply = Math.max(0, Math.min(model.plies.length, next));
    const current = ply === 0 ? null : model.plies[ply - 1]!;
    view.set(
      {
        fen: current ? current.fen : model.fen,
        orientation: model.orientation,
        arrows: current && (current.arrows.length || current.highlights.length) ? current.arrows : ply === 0 || !hasLine ? model.arrows : [],
        highlights: current && (current.arrows.length || current.highlights.length) ? current.highlights : ply === 0 || !hasLine ? model.highlights : [],
        lastMove: current ? { from: current.from, to: current.to } : null,
      },
      animate && current && ply === previous + 1 ? { from: current.from, to: current.to } : null,
    );
    const text = current?.comment ?? (ply === 0 ? model.caption : undefined) ?? (!hasLine ? model.caption : undefined);
    comment.textContent = text ?? "";
    comment.hidden = !text;
    for (const node of moves.querySelectorAll<HTMLElement>("[data-ply]")) node.classList.toggle("ch-on", Number(node.dataset.ply) === ply);
    position.textContent = ply === 0 ? T.start : (moves.querySelector<HTMLElement>(`[data-ply="${ply}"]`)?.textContent ?? "");
    first.disabled = prev.disabled = ply === 0;
    nextButton.disabled = last.disabled = ply === model.plies.length;
  }

  const first = iconButton(document, ICONS.first, T.first, () => { stop(); show(0, false); }, signal);
  const prev = iconButton(document, ICONS.prev, T.prev, () => { stop(); show(ply - 1, false); }, signal);
  const nextButton = iconButton(document, ICONS.next, T.next, () => { stop(); show(ply + 1, true); }, signal);
  const last = iconButton(document, ICONS.last, T.last, () => { stop(); show(model.plies.length, false); }, signal);
  const playButton = iconButton(document, ICONS.play, T.play, () => {
    if (timer) {
      stop();
      return;
    }
    if (ply >= model.plies.length) show(0, false);
    playButton.innerHTML = ICONS.pause;
    playButton.title = T.pause;
    playButton.setAttribute("aria-label", T.pause);
    timer = setInterval(() => {
      if (ply >= model.plies.length) stop();
      else show(ply + 1, true);
    }, 1100);
  }, signal);

  if (hasLine) {
    const controls = document.createElement("div");
    controls.className = "ch-controls";
    controls.append(first, prev, playButton, nextButton, last, position);
    for (const entry of numbered(model.plies.map((item) => item.san), model.fen)) {
      const move = document.createElement("button");
      move.type = "button";
      move.className = "ch-move";
      move.dataset.ply = String(entry.ply);
      move.textContent = entry.label;
      if (model.plies[entry.ply - 1]?.comment) move.classList.add("ch-has-comment");
      move.addEventListener("click", () => { stop(); show(entry.ply, entry.ply === ply + 1); }, { signal });
      moves.append(move);
    }
    card.append(controls, moves);
  }
  card.append(comment);
  signal.addEventListener("abort", stop, { once: true });
  show(ply, false);
  return card;
}

export function mountBoards(container: HTMLElement, boards: readonly BoardModel[], signal: AbortSignal): void {
  const document = container.ownerDocument;
  const wrap = document.createElement("div");
  wrap.className = `ch-root ch-boards${boards.length > 1 ? " ch-multi" : ""}`;
  for (const board of boards) wrap.append(mountBoardCard(document, board, signal));
  container.append(wrap);
  signal.addEventListener("abort", () => wrap.remove(), { once: true });
}
