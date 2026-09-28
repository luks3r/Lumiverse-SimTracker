import { describe, expect, test } from "bun:test";
import { createFrontendMessageSyntax, readMessageContext } from "../src/frontend/frontendMessageSyntax";

describe("frontend message syntax", () => {
  test("reads configured tag and updates after tag changes", () => {
    let tag = "tracker";
    const syntax = createFrontendMessageSyntax(() => tag);
    expect(syntax.extractTrackerBlock('<tracker type="sim"> {"a":1} </tracker>', "sim"))
      .toBe('{"a":1}');
    tag = "custom";
    expect(syntax.extractTrackerBlock('<custom type="sim"> {"b":2} </custom>', "sim"))
      .toBe('{"b":2}');
    expect(syntax.extractTrackerBlock('<tracker type="sim">old</tracker>', "sim"))
      .toBeNull();
  });

  test("falls back to fenced tracker and reads nested message context", () => {
    const syntax = createFrontendMessageSyntax(() => "tracker");
    expect(syntax.extractTrackerBlock('```sim\n{"a":1}\n```', "sim"))
      .toBe('{"a":1}');
    expect(readMessageContext({ message: { id: "m1", content: "hello", is_user: false } }))
      .toEqual({ content: "hello", messageId: "m1", isUser: false });
  });
});
