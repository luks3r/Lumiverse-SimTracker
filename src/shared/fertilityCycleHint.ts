export type FertilityCycleBias =
  | "random"
  | "menstruating"
  | "start_follicular"
  | "close_ovulation"
  | "ovulating"
  | "start_luteal"
  | "end_luteal";

/**
 * Map a fertility-cycle bias to a concrete day + human-readable stage
 * description for the initial-state hint injected into a brand-new chat.
 *
 * The day ranges assume a standard ~28-day cycle and line up with the
 * stage taxonomy used by the frontend's `FERTILITY_STAGE_BY_ID` map
 * (menstruation → follicular → ovulation → luteal). Each bias rolls a
 * random day inside its window so chats don't all land on the exact same
 * number, while still respecting the user's chosen phase.
 */
function pickInitialCycleState(bias: FertilityCycleBias): { day: number; description: string } {
  const roll = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
  switch (bias) {
    case "menstruating": {
      const day = roll(1, 5);
      return { day, description: `menstruating (cycle_stage_id 1)` };
    }
    case "start_follicular": {
      const day = roll(6, 10);
      return { day, description: `in the early follicular phase (cycle_stage_id 2)` };
    }
    case "close_ovulation": {
      const day = roll(11, 13);
      return { day, description: `late in the follicular phase, approaching ovulation (cycle_stage_id 2)` };
    }
    case "ovulating": {
      const day = roll(14, 16);
      return { day, description: `ovulating (cycle_stage_id 3)` };
    }
    case "start_luteal": {
      const day = roll(17, 21);
      return { day, description: `in the early luteal phase (cycle_stage_id 4)` };
    }
    case "end_luteal": {
      const day = roll(24, 28);
      return { day, description: `late in the luteal phase, pre-menstrual (cycle_stage_id 4)` };
    }
    case "random":
    default: {
      const day = roll(1, 28);
      return { day, description: "" };
    }
  }
}

export function buildFirstMessageHint(bias: FertilityCycleBias): string {
  const { day, description } = pickInitialCycleState(bias);
  if (!description && bias !== "random") return "";
  const qualifier = description ? `, ${description}` : "";
  return `INITIAL STATE: Female and Futanari characters begin on day ${day} of their fertility cycle already${qualifier}. Reflect this in the first tracker.`;
}
