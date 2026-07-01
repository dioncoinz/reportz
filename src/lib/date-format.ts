function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return { year, month, day };
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "?";

  const dateOnly = parseDateOnly(value);
  if (dateOnly) return `${dateOnly.day}/${dateOnly.month}/${dateOnly.year}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "?";

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "?";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "?";

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
