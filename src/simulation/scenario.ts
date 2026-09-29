export interface ScenarioMessage {
  text: string;
  afterMs?: number;
}

export interface ScenarioExpectation {
  strikes?: number;
  warnings?: number;
  deletions?: number;
  blocks?: number;
}

export interface Scenario {
  name: string;
  description?: string;
  policy?: string;
  settings?: Record<string, string>;
  messages: ScenarioMessage[];
  flagWords?: string[];
  expect?: ScenarioExpectation;
}

export function parseScenario(raw: unknown, source: string): Scenario {
  const scenario = raw as Partial<Scenario> | null;
  if (!scenario || typeof scenario.name !== 'string' || !Array.isArray(scenario.messages) || scenario.messages.length === 0) {
    throw new Error(`${source}: a scenario needs a "name" and a non-empty "messages" array`);
  }
  const badMessage = scenario.messages.find((message) => typeof message?.text !== 'string' || (message.afterMs !== undefined && !(message.afterMs >= 0)));
  if (badMessage) throw new Error(`${source}: every message needs a "text" string and, optionally, a non-negative "afterMs"`);
  return scenario as Scenario;
}
