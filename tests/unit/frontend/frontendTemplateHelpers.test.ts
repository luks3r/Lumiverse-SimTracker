import { describe, expect, test } from "bun:test";
import Handlebars from "handlebars";
import { registerTemplateHelpers } from "../../../src/frontend/frontendTemplateHelpers";

describe("frontend template helper registration", () => {
  test("registers arithmetic and boolean helpers once", () => {
    registerTemplateHelpers();
    const add = Handlebars.helpers.add;
    expect(Handlebars.compile("{{add 2 3}}")({})).toBe("5");
    expect(Handlebars.compile("{{divide 4 0}}")({})).toBe("0");
    expect(Handlebars.compile("{{#if (or false true)}}yes{{/if}}")({})).toBe("yes");
    registerTemplateHelpers();
    expect(Handlebars.helpers.add).toBe(add);
  });

  test("keeps biology helper names available", () => {
    registerTemplateHelpers();
    expect(typeof Handlebars.helpers.cycleStage).toBe("function");
    expect(typeof Handlebars.helpers.hasFemaleBiology).toBe("function");
    expect(typeof Handlebars.helpers.adjustHSL).toBe("function");
  });
});
