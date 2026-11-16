/** The chess board in the "Book" style: a diagram from a chess textbook.
 *
 * Pieces are absolutely positioned glyphs, so a move can slide from its square
 * to the next. Arrows and highlights draw on top. In interactive mode the
 * learner moves by clicking or dragging; legality comes from the caller.
 */
import type { Arrow, ArrowColor, Highlight } from "../engine.ts";

const WHITE: Record<string, string> = { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" };
const BLACK: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";
const INK: Record<ArrowColor, string> = { green: "#2f6b3a", red: "#a3392a", blue: "#2b4f8a", yellow: "#b07d10" };

export interface BoardState {
  readonly fen: string;
  readonly orientation: "white" | "black";
  readonly arrows?: readonly Arrow[];
  readonly highlights?: readonly Highlight[];
  readonly lastMove?: { readonly from: string; readonly to: string } | null;
}

export interface Interaction {
  /** Squares the piece on `from` may move to (empty when it may not move). */
  targets(from: string): readonly string[];
  /** True when the move needs a promotion choice. */
  isPromotion(from: string, to: string): boolean;
  move(from: string, to: string, promotion?: string): void;
}

export interface BoardView {
  readonly element: HTMLElement;
  /** Show a position; `animate` slides the piece of that move (and the rook of a castle). */
  set(state: BoardState, animate?: { from: string; to: string } | null): void;
  setInteraction(interaction: Interaction | null): void;
  dispose(): void;
}

function pieces(fen: string): Map<string, string> {
  const map = new Map<string, string>();
  const rows = fen.split(" ")[0]!.split("/");
  rows.forEach((row, rankIndex) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        map.set(`${FILES[file]}${8 - rankIndex}`, ch);
        file += 1;
      }
    }
  });
  return map;
}

/** Column/row (0–7, from the top-left as drawn) of a square for an orientation. */
function cell(square: string, orientation: "white" | "black"): { col: number; row: number } {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return orientation === "white" ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

function squareAt(col: number, row: number, orientation: "white" | "black"): string {
  return orientation === "white" ? `${FILES[col]}${8 - row}` : `${FILES[7 - col]}${row + 1}`;
}

export function createBoard(document: Document, signal: AbortSignal): BoardView {
  const ns = "http://www.w3.org/2000/svg";
  const root = document.createElement("div");
  root.className = "ch-frame";
  const board = document.createElement("div");
  board.className = "ch-board";
  const squaresLayer = document.createElement("div");
  squaresLayer.className = "ch-squares";
  const marksLayer = document.createElement("div");
  marksLayer.className = "ch-marks";
  const piecesLayer = document.createElement("div");
  piecesLayer.className = "ch-pieces";
  const arrows = document.createElementNS(ns, "svg");
  arrows.setAttribute("class", "ch-arrows");
  arrows.setAttribute("viewBox", "0 0 8 8");
  arrows.setAttribute("aria-hidden", "true");
  board.append(squaresLayer, marksLayer, piecesLayer, arrows);
  const files = document.createElement("div");
  files.className = "ch-files";
  const ranks = document.createElement("div");
  ranks.className = "ch-ranks";
  root.append(ranks, board, files);

  let state: BoardState | null = null;
  let interaction: Interaction | null = null;
  let selected: string | null = null;
  let promotion: HTMLElement | null = null;
  let drag: { from: string; ghost: HTMLElement; pointer: number; startX: number; startY: number; moved: boolean } | null = null;
  const pieceNodes = new Map<string, HTMLElement>();

  for (let index = 0; index < 64; index += 1) {
    const square = document.createElement("div");
    const col = index % 8;
    const row = Math.floor(index / 8);
    square.className = `ch-sq ${(col + row) % 2 === 1 ? "ch-dark" : "ch-light"}`;
    squaresLayer.append(square);
  }

  const place = (node: HTMLElement, square: string): void => {
    const { col, row } = cell(square, state!.orientation);
    node.style.left = `${col * 12.5}%`;
    node.style.top = `${row * 12.5}%`;
  };

  function drawCoordinates(): void {
    const orientation = state!.orientation;
    files.replaceChildren(...Array.from({ length: 8 }, (_, col) => {
      const label = document.createElement("span");
      label.textContent = squareAt(col, 7, orientation)[0]!;
      return label;
    }));
    ranks.replaceChildren(...Array.from({ length: 8 }, (_, row) => {
      const label = document.createElement("span");
      label.textContent = squareAt(0, row, orientation)[1]!;
      return label;
    }));
  }

  function drawMarks(): void {
    const marks: HTMLElement[] = [];
    const mark = (square: string, className: string, color?: string): void => {
      const node = document.createElement("div");
      node.className = `ch-mark ${className}`;
      if (color) node.style.setProperty("--ink", color);
      place(node, square);
      marks.push(node);
    };
    if (state!.lastMove) {
      mark(state!.lastMove.from, "ch-last");
      mark(state!.lastMove.to, "ch-last");
    }
    for (const highlight of state!.highlights ?? []) mark(highlight.square, "ch-hl", INK[highlight.color]);
    if (selected && interaction) {
      mark(selected, "ch-selected");
      const occupied = pieces(state!.fen);
      for (const target of interaction.targets(selected)) mark(target, occupied.has(target) ? "ch-capture" : "ch-dot");
    }
    marksLayer.replaceChildren(...marks);
  }

  function drawArrows(): void {
    arrows.replaceChildren();
    const defs = document.createElementNS(ns, "defs");
    arrows.append(defs);
    for (const [index, arrow] of (state!.arrows ?? []).entries()) {
      const a = cell(arrow.from, state!.orientation);
      const b = cell(arrow.to, state!.orientation);
      const x1 = a.col + 0.5, y1 = a.row + 0.5, x2 = b.col + 0.5, y2 = b.row + 0.5;
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ex = x2 - ((x2 - x1) / length) * 0.32;
      const ey = y2 - ((y2 - y1) / length) * 0.32;
      const id = `ch-head-${index}-${Math.random().toString(36).slice(2, 7)}`;
      const marker = document.createElementNS(ns, "marker");
      marker.setAttribute("id", id);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "4");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "3");
      marker.setAttribute("markerHeight", "3");
      marker.setAttribute("orient", "auto");
      const head = document.createElementNS(ns, "path");
      head.setAttribute("d", "M0,0 L10,5 L0,10 z");
      head.setAttribute("fill", INK[arrow.color]);
      marker.append(head);
      defs.append(marker);
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(ex));
      line.setAttribute("y2", String(ey));
      line.setAttribute("stroke", INK[arrow.color]);
      line.setAttribute("stroke-width", "0.16");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("opacity", "0.82");
      line.setAttribute("marker-end", `url(#${id})`);
      arrows.append(line);
    }
  }

  function drawPieces(animate: { from: string; to: string } | null): void {
    const next = pieces(state!.fen);
    pieceNodes.forEach((node) => node.remove());
    pieceNodes.clear();
    for (const [square, piece] of next) {
      const node = document.createElement("span");
      const white = piece === piece.toUpperCase();
      node.className = `ch-piece ${white ? "ch-white" : "ch-black"}`;
      node.textContent = (white ? WHITE : BLACK)[piece.toLowerCase()]!;
      node.dataset.square = square;
      place(node, square);
      piecesLayer.append(node);
      pieceNodes.set(square, node);
    }
    if (!animate) return;
    // Slide the moved piece (and the rook of a castle) from where it stood.
    const slides: [string, string][] = [[animate.from, animate.to]];
    const piece = next.get(animate.to);
    if (piece && piece.toLowerCase() === "k" && Math.abs(FILES.indexOf(animate.from[0]!) - FILES.indexOf(animate.to[0]!)) === 2) {
      const rank = animate.to[1];
      slides.push(animate.to[0] === "g" ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`]);
    }
    for (const [from, to] of slides) {
      const node = pieceNodes.get(to);
      if (!node) continue;
      node.classList.add("ch-no-anim");
      place(node, from);
      void node.offsetWidth;
      node.classList.remove("ch-no-anim");
      place(node, to);
    }
  }

  function closePromotion(): void {
    promotion?.remove();
    promotion = null;
  }

  function askPromotion(from: string, to: string): void {
    closePromotion();
    const white = pieces(state!.fen).get(from) === "P";
    const box = document.createElement("div");
    box.className = "ch-promo";
    place(box, to);
    for (const choice of ["q", "r", "b", "n"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ch-piece-button ${white ? "ch-white" : "ch-black"}`;
      button.textContent = (white ? WHITE : BLACK)[choice]!;
      button.addEventListener("click", () => {
        closePromotion();
        interaction?.move(from, to, choice);
      }, { signal });
      box.append(button);
    }
    board.append(box);
  }

  function tryMove(from: string, to: string): boolean {
    if (!interaction || !interaction.targets(from).includes(to)) return false;
    selected = null;
    if (interaction.isPromotion(from, to)) {
      drawMarks();
      askPromotion(from, to);
    } else interaction.move(from, to);
    return true;
  }

  const squareFromPoint = (x: number, y: number): string | null => {
    const rect = board.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return null;
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    return squareAt(Math.min(7, col), Math.min(7, row), state!.orientation);
  };

  board.addEventListener("pointerdown", (event) => {
    if (!interaction || !state || event.button !== 0) return;
    const square = squareFromPoint(event.clientX, event.clientY);
    if (!square) return;
    closePromotion();
    if (selected && selected !== square && tryMove(selected, square)) return;
    if (interaction.targets(square).length === 0) {
      selected = null;
      drawMarks();
      return;
    }
    selected = square;
    drawMarks();
    const node = pieceNodes.get(square);
    if (!node) return;
    board.setPointerCapture(event.pointerId);
    drag = { from: square, ghost: node, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    event.preventDefault();
  }, { signal });
  board.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.ghost.classList.add("ch-dragging");
    drag.ghost.style.transform = `translate(${dx}px, ${dy}px)`;
  }, { signal });
  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const current = drag;
    drag = null;
    current.ghost.classList.remove("ch-dragging");
    current.ghost.style.transform = "";
    if (!current.moved) return;
    const target = squareFromPoint(event.clientX, event.clientY);
    if (!target || target === current.from || !tryMove(current.from, target)) drawMarks();
  };
  board.addEventListener("pointerup", endDrag, { signal });
  board.addEventListener("pointercancel", endDrag, { signal });

  return {
    element: root,
    set(next, animate = null) {
      const orientationChanged = state?.orientation !== next.orientation;
      state = next;
      selected = null;
      closePromotion();
      root.dataset.orientation = next.orientation;
      if (orientationChanged) drawCoordinates();
      drawPieces(animate);
      drawMarks();
      drawArrows();
    },
    setInteraction(next) {
      interaction = next;
      board.classList.toggle("ch-interactive", next !== null);
      selected = null;
      if (state) drawMarks();
    },
    dispose() {
      closePromotion();
      root.remove();
    },
  };
}
