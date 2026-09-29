import { describe, expect, test } from "bun:test";
import { sanitizeSysPromptForWireFormat, stripStructuralHTML } from "../../../src/backend/secondaryPromptText";

describe("secondary prompt text", () => {
  test("rewrites tracker-shaped fences and references, preserving unrelated JSON", () => {
    const input = [
      "```sim\n{\"worldData\":{}}\n```",
      "```json\n{\"other\":1}\n```",
      "```yaml\ncharacters: []\n```",
      "Use `sim` codeblock next.",
    ].join("\n");
    const output = sanitizeSysPromptForWireFormat(input, "tracker", "sim");
    expect(output).toContain('<tracker type="sim">\n{"worldData":{}}\n</tracker>');
    expect(output).toContain("```json\n{\"other\":1}\n```");
    expect(output).toContain('<tracker type="sim">\ncharacters: []\n</tracker>');
    expect(output).toContain("Use tracker tag next.");
  });

  test("strips structural HTML but keeps plain and inline text", () => {
    expect(stripStructuralHTML("Before <div>hidden</div> <b>bold</b> after"))
      .toBe("Before <b>bold</b> after");
  });
});
