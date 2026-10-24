/** Escape a string for safe use inside a double-quoted XML attribute value. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/** Escape a string for safe use as XML element text content. */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Decode the entity and character references in a raw XML attribute value —
 * the inverse of {@link escapeAttribute}, plus the other predefined entities
 * and numeric references a hand-written attribute may use.
 */
export function unescapeAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, ref: string) => {
    switch (ref) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10),
        );
    }
  });
}
