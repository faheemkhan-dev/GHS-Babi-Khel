// src/lib/letterModel.ts — shared model for the board's own duty letter.
// The server returns the letter's text VERBATIM as positioned lines, including
// the board's own table geometry (which grid track a cell starts at, how many
// tracks it spans, and its width="%" hint). This file only groups those lines
// into rows/cells for display; it never adds or rewrites any wording.
export interface LetterRun { t: string; b?: 1; u?: 1 }
export interface LetterLine {
  row: number; col: number; span?: number; w?: number; tbl?: number;
  runs?: LetterRun[]; center?: 1; right?: 1; box?: 1; img?: string;
}
export interface LetterCell { g: number; span: number; lines: LetterLine[] }
export interface LetterRow {
  id: number;
  cells: LetterCell[];
  tracks: number; // grid tracks in this row's table (1 = plain full-width block)
  hints: number[]; // the board's own width="%" hints per track (0 where absent)
}

export const lineText = (l: LetterLine) => (l.runs || []).map((r) => r.t).join("");

export function groupRows(lines: LetterLine[]): LetterRow[] {
  const order: number[] = [];
  const byRow = new Map<number, LetterLine[]>();
  for (const l of lines) {
    if (!byRow.has(l.row)) { byRow.set(l.row, []); order.push(l.row); }
    byRow.get(l.row)!.push(l);
  }

  // Per-table geometry: how many grid tracks the table has, and the board's own
  // width hints for each track (taken from span-1 cells that carry width="%").
  const tblTracks = new Map<number, number>();
  const tblHints = new Map<number, number[]>();
  for (const l of lines) {
    if (!l.tbl) continue;
    const span = l.span || 1;
    tblTracks.set(l.tbl, Math.max(tblTracks.get(l.tbl) || 0, l.col + span));
    if (span === 1 && l.w) {
      const h = tblHints.get(l.tbl) || [];
      h[l.col] = Math.max(h[l.col] || 0, l.w);
      tblHints.set(l.tbl, h);
    }
  }

  return order.map((id) => {
    const ls = byRow.get(id)!;
    const tbl = ls[0].tbl || 0;
    const cellsMap = new Map<number, LetterCell>();
    for (const l of ls) {
      let c = cellsMap.get(l.col);
      if (!c) { c = { g: l.col, span: l.span || 1, lines: [] }; cellsMap.set(l.col, c); }
      c.span = Math.max(c.span, l.span || 1);
      c.lines.push(l);
    }
    return {
      id,
      cells: [...cellsMap.values()].sort((a, b) => a.g - b.g),
      tracks: tbl ? tblTracks.get(tbl) || 1 : 1,
      hints: tbl ? tblHints.get(tbl) || [] : [],
    };
  });
}

/** Facts read straight out of the letter's own sentences (each only if present). */
export function letterFacts(lines: LetterLine[]) {
  const text = lines.filter((l) => l.runs).map(lineText).join("\n");
  const flat = text.replace(/\s+/g, " ");
  const pick = (re: RegExp) => (flat.match(re)?.[1] || "").trim() || undefined;
  return {
    ref: pick(/\bNo\.\s*([^\s]+)/),
    dated: pick(/Dated:\s*([\d-]+)/),
    cnic: pick(/CNIC\s*:\s*(\d{13})/),
    centerName: pick(/Center Name\s*:\s*(.+?)\.\s+You have been/i) || pick(/Center Name\s*:\s*([^.]+)\./i),
    drawDate: pick(/draw held on\s+(.+?)\s+in the/i),
    reportDate: pick(/reach the Examination Centre on\s*([\d-]+)/i),
    reportTime: pick(/reach the Examination Centre on\s*[\d-]+\s*at\s*([\d:]+\s*[AP]M)/i),
    commencing: pick(/COMMENCING ON\s+(.+?)(?:\s+Memo|$)/i),
  };
}
