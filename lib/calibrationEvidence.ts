/** A narrow, bilingual evidence gate for analytical calibration, not a global lexical gate. */
export function calibrationEvidence<T extends { raw_content?: string | null; content?: string }>(rows: T[], question: string): T[] {
  if (!/\b(kalibrasi|calibration|kurva baku)\b/i.test(question) || !/\b(linear|linier|regresi|regression|standar|standard|konsentrasi|concentration)\b/i.test(question)) return rows;
  return rows.filter(row => /\b(kalibrasi|calibration|regresi|regression|linearitas|linearity|kurva\s+baku|standard\s+curve|least[ -]squares)\b/i.test(row.raw_content || row.content || ""));
}
