import { describe, expect, test } from "bun:test";
import { buildSavedFrontendConfig } from "../../../src/frontend/frontendSettingsValues";
import { DEFAULT_CONFIG } from "../../../src/shared/trackerConfig";

describe("frontend settings values", () => {
  test("Save maps form values using the current defaults and limits", () => {
    const config = buildSavedFrontendConfig(DEFAULT_CONFIG, {
      selectedTemplate: "custom",
      tag: " My Tracker! ",
      identifier: " State ID! ",
      hide: true,
      inline: false,
      format: "yaml",
      retain: "25",
      llmEnable: true,
      llmConnection: "connection-1",
      llmModel: "string",
      llmMsgCount: "99",
      llmTemp: "0",
      llmStrip: true,
      llmJsonResponseFormat: true,
      cycleBias: "ovulating",
      tsEnable: true,
      tsKey: "  secret  ",
      tsModel: "",
      tsQuick: false,
      tsVerify: true,
      tsConception: false,
      tsConfidence: "0.1",
    }, "fallback-id");
    expect(config).toMatchObject({
      templateId: "custom", trackerTagName: "mytracker", codeBlockIdentifier: "stateid",
      trackerFormat: "yaml", retainTrackerCount: 20,
      useSecondaryLLM: true, secondaryLLMConnectionId: "connection-1", secondaryLLMModel: "",
      secondaryLLMMessageCount: 50, secondaryLLMTemperature: 0.7,
      secondaryLLMJsonResponseFormat: false,
      fertilityCycleBias: "ovulating", typeSafeApiKey: "secret",
      typeSafeModel: DEFAULT_CONFIG.typeSafeModel, typeSafeConfidenceFloor: 0.3,
    });
  });

  test("JSON response format is saved only for JSON trackers", () => {
    const config = buildSavedFrontendConfig(DEFAULT_CONFIG, { format: "json", llmJsonResponseFormat: true }, "sim");

    expect(config.secondaryLLMJsonResponseFormat).toBe(true);
  });
});
