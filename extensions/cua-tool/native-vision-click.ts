// Explicit opt-in for native controls absent from the AX tree (e.g. Blender's
// custom Save/Don't Save confirmation). Never fuzzily guess a mutating label.
export interface VisionTextRow {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface VisionTextSnapshot {
  width: number;
  height: number;
  rows: VisionTextRow[];
}

const normalized = (value: string) => value.normalize('NFKD')
  .replace(/[\u2018\u2019'`]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function selectNativeVisionText(snapshot: VisionTextSnapshot, query: string, within: string, occurrence?: number) {
  if (!query?.trim() || !within?.trim()) throw new Error('vision_click requires both exact button text (query) and visible dialog context (within). No click dispatched.');
  if (!Number.isFinite(snapshot.width) || !Number.isFinite(snapshot.height) || snapshot.width < 20 || snapshot.height < 20 || !Array.isArray(snapshot.rows))
    throw new Error('Invalid native OCR screenshot dimensions/rows. No click dispatched.');
  const rows = snapshot.rows.filter(row => row && Number.isFinite(row.confidence) && row.confidence >= 0.55
    && Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.width) && Number.isFinite(row.height));
  const context = normalized(within), label = normalized(query);
  if (!rows.some(row => normalized(row.text).includes(context))) throw new Error(`Visible dialog context “${within}” was not found. No click dispatched.`);
  const matches = rows.filter(row => normalized(row.text) === label
    && row.width >= 28 && row.height >= 10
    && row.x >= 0 && row.y >= 0 && row.x + row.width <= snapshot.width && row.y + row.height <= snapshot.height);
  if (!matches.length) throw new Error(`Exact visible button “${query}” was not found. No click dispatched.`);
  if (matches.length !== 1 && occurrence === undefined) throw new Error(`Ambiguous visible button “${query}”: ${matches.length} matches. No click dispatched.`);
  const selected = matches[occurrence === undefined ? 0 : occurrence - 1];
  if (!selected) throw new Error(`Visible button occurrence ${occurrence} does not exist. No click dispatched.`);
  return { x: Math.round(selected.x + selected.width / 2), y: Math.round(selected.y + selected.height / 2), confidence: selected.confidence };
}
