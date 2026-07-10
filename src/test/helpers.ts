export function iso(date: string): string {
  return new Date(date).toISOString();
}

export function day(date: string): string {
  return date;
}
