/**
 * The Monarch grammar behind Markdown-style divisions, walked the way Monarch
 * walks it: at each position the first rule matching there wins, and a rule sees
 * only the text from that position on.
 */
import { describe, expect, it } from "vitest";
import { registerMarkdownSyntax } from "../components/editorConfigs/markdownSyntax";

type Action = string | string[] | { token: string; next: string };
type Rule = [RegExp | string, Action] | { include: string };

const grammar = () => {
  let tokenizer: Record<string, Rule[]> = {};
  let flags = "";
  let autoClosed: string[] = [];
  let surrounding: string[] = [];
  registerMarkdownSyntax({
    editor: { defineTheme: () => {}, setTheme: () => {} },
    languages: {
      register: () => {},
      setLanguageConfiguration: (_id: string, configuration: any) => {
        autoClosed = configuration.autoClosingPairs.map((pair: any) => pair.open);
        surrounding = configuration.surroundingPairs.map((pair: any) => pair.open);
      },
      setMonarchTokensProvider: (_id: string, language: any) => {
        tokenizer = language.tokenizer;
        flags = `${language.ignoreCase ? "i" : ""}${language.unicode ? "u" : ""}`;
      },
    },
  });
  return { tokenizer, flags, autoClosed, surrounding };
};

const rulesOf = (
  tokenizer: Record<string, Rule[]>,
  state: string,
): [RegExp, Action][] =>
  tokenizer[state].flatMap((rule) =>
    "include" in rule
      ? rulesOf(tokenizer, rule.include.replace("@", ""))
      : [rule as [RegExp, Action]],
  );

/** The slices of `line` that came out as `token`. */
const tokensOf = (line: string, token: string): string[] => {
  const { tokenizer, flags } = grammar();
  const compiled = (state: string) =>
    rulesOf(tokenizer, state).map(
      ([regex, action]) =>
        [
          new RegExp(
            `^(?:${typeof regex === "string" ? regex : regex.source})`,
            flags,
          ),
          action,
        ] as const,
    );

  const states = ["root"];
  const found: string[] = [];
  let position = 0;
  while (position < line.length) {
    const rest = line.slice(position);
    const rule = compiled(states[states.length - 1]).find(
      ([regex]) =>
        (position === 0 || !regex.source.startsWith("^(?:^")) && regex.test(rest),
    );
    if (!rule) throw new Error(`no rule matches ${rest}`);
    const [regex, action] = rule;
    const match = regex.exec(rest)!;
    const named = typeof action === "object" && !Array.isArray(action);
    if (named && action.next === "@pop") states.pop();
    else if (named) states.push(action.next.replace("@", ""));
    if ((named ? action.token : action) === token) found.push(match[0]);
    position += Math.max(match[0].length, 1);
  }
  return found;
};

describe("the Markdown grammar", () => {
  it.each([
    ["Paid $2 to $5 dollars.", []],
    ["It costs $5.", []],
    ["US$5 and US$6.", []],
    ["Paid \\$5 and \\$6.", []],
    ["https://example.com/$foo/$bar", []],
    ["Let $x^2$ be", ["$x^2$"]],
    ["From $5 to $10, or $x$.", ["$x$"]],
    ["$$x$$ and \\(y\\)", ["$$x$$", "\\(y\\)"]],
  ])("reads the math in %s as the converter does", (line, math) => {
    expect(tokensOf(line, "number")).toEqual(math);
  });

  it("keeps a raw tag whole, `$` included", () => {
    const line = '<url href="https://example.com/$foo">$x$</url>';
    expect(tokensOf(line, "tag")).toEqual([
      '<url href="https://example.com/$foo">',
      "</url>",
    ]);
    expect(tokensOf(line, "number")).toEqual(["$x$"]);
  });

  it("reads an autolink as a link", () => {
    const line = "<https://example.com/$a/$b>";
    expect(tokensOf(line, "string.link")).toEqual([line]);
    expect(tokensOf(line, "number")).toEqual([]);
  });

  it("reads a comment as a comment, `$` included", () => {
    const line = "before <!-- costs $5 and $6$ --> $x$";
    expect(tokensOf(line, "comment").join("")).toBe("<!-- costs $5 and $6$ -->");
    expect(tokensOf(line, "number")).toEqual(["$x$"]);
  });

  it("does not auto-close `$`, but still wraps a selection in it", () => {
    const { autoClosed, surrounding } = grammar();
    expect(autoClosed).not.toContain("$");
    expect(surrounding).toContain("$");
  });
});
