/** Join class names, skipping the falsy ones: cn("a", on && "b", undefined). */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}
