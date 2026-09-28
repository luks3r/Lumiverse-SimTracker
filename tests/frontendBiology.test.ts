import { describe, expect, test } from "bun:test";
import {
  analShaftTopY,
  cervixOsR,
  clampPercent,
  computeBreastGeometry,
  cycleStage,
  cycleStageId,
  fertilityRiskLabel,
  hasFemaleBiology,
  hasMaleBiology,
  percentOf,
  vagDepthBar,
  vagShaftTopY,
} from "../src/frontendBiology";

describe("frontend biology helpers", () => {
  test("resolves stage IDs and legacy stage names", () => {
    expect(cycleStage({ cycle_stage_id: 3 })).toBe("ovulation");
    expect(cycleStageId({ cycle_stage: "RUT" })).toBe(6);
    expect(fertilityRiskLabel({ preg: true })).toBe("Pregnant");
  });

  test("detects biology from sex or tracked state", () => {
    expect(hasFemaleBiology({ sex: "female" })).toBe(true);
    expect(hasMaleBiology({ sex: "male" })).toBe(true);
    expect(hasFemaleBiology({ womb_fullness_pct: 25 })).toBe(true);
    expect(hasMaleBiology({ semen_capacity_ml: 5 })).toBe(true);
    expect(hasMaleBiology({ sex: "female" })).toBe(false);
  });

  test("clamps percentage and preserves geometry limits", () => {
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(50, 0)).toBe(0);
    expect(vagShaftTopY({ vag_depth_pct: 100 })).toBe(90);
    expect(vagShaftTopY({ vag_depth_pct: 130 })).toBe(58);
    expect(vagDepthBar({ vag_depth_pct: 130 })).toBe(100);
    expect(analShaftTopY({ anal_depth_pct: 100 })).toBe(22);
    expect(cervixOsR({ cervix_state_id: 7 })).toBe(5.4);
  });

  test("scales breast geometry while retaining cup labels", () => {
    const small = computeBreastGeometry({ cup_size: "A", breast_fullness_pct: 0 });
    const large = computeBreastGeometry({ cup_size: "FF", breast_fullness_pct: 100 });
    expect(small.cupLabel).toBe("A");
    expect(large.cupLabel).toBe("FF");
    expect(small.fillHeight).toBe(0);
    expect(large.fillHeight).toBeGreaterThan(0);
    expect(large.bottomY).toBeGreaterThan(small.bottomY);
  });
});
