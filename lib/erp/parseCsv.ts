export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  const normalized = text.replace(/\uFEFF/g, "");
  let current: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const nextChar = normalized[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      current.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      current.push(value);
      if (current.some((cell) => cell.trim() !== "")) {
        rows.push(current);
      }
      current = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || current.length > 0) {
    current.push(value);
    if (current.some((cell) => cell.trim() !== "")) {
      rows.push(current);
    }
  }

  return rows;
}

export function parseCsv(text: string): string[][] {
  return parseDelimited(text, ",");
}

export function parseTsv(text: string): string[][] {
  return parseDelimited(text, "\t");
}
