import { describe, expect, test } from "bun:test";
import { compileTemplate, executeTemplateLogic, resolveTrackerMountMode } from "../src/frontend/frontendTemplate";

describe("frontend template helpers", () => {
  test("resolves mount position from preset before HTML marker", () => {
    const preset = { id: "position-test", templateName: "Position", templatePosition: "LEFT", htmlTemplate: "<!-- POSITION: TOP -->" };
    expect(resolveTrackerMountMode(preset)).toBe("side_left");
    expect(resolveTrackerMountMode({ ...preset, templatePosition: undefined })).toBe("message_top");
    expect(resolveTrackerMountMode({ ...preset, templatePosition: undefined, htmlTemplate: "" })).toBe("message_bottom");
  });

  test("executes encoded template logic and preserves input on failure", () => {
    const input = { count: 2 };
    const preset = {
      id: "logic-test",
      templateName: "Logic",
      htmlTemplate: '&lt;script type="text/x-handlebars-template-logic"&gt;data.count += 3;&lt;/script&gt;',
    };
    expect(executeTemplateLogic(input, "single", preset)).toBe(input);
    expect(input.count).toBe(5);
    const broken = { ...preset, htmlTemplate: '<script type="text/x-handlebars-template-logic">throw new Error("bad")</script>' };
    expect(executeTemplateLogic(input, "single", broken)).toBe(input);
    expect(input.count).toBe(5);
  });

  test("compiles card section and caches by preset id and source", () => {
    const preset = {
      id: "card-test",
      templateName: "Card",
      htmlTemplate: "header<!-- CARD_TEMPLATE_START -->{{name}}<!-- CARD_TEMPLATE_END -->footer",
    };
    const compiled = compileTemplate(preset);
    expect(compiled?.({ name: "Alice" })).toBe("Alice");
    expect(compileTemplate(preset)).toBe(compiled);
    expect(compileTemplate({ ...preset, htmlTemplate: "{{name}}!" })?.({ name: "Alice" })).toBe("Alice!");
  });
});
