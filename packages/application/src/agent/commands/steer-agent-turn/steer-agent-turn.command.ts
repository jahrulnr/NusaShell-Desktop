import type { Command } from "../../../messaging/command.js";
import type { AgentMessage } from "../../ports/agent-provider.port.js";

export interface SteerAgentTurnCommand extends Command {
  readonly kind: "steer-agent-turn";
  readonly conversationId: string;
  readonly traceId: string;
  readonly steerId: string;
  readonly displayText: string;
  readonly message: Extract<AgentMessage, { role: "user" }>;
}

export interface CancelAgentSteerCommand extends Command {
  readonly kind: "cancel-agent-steer";
  readonly conversationId: string;
  readonly traceId: string;
  readonly steerId: string;
}
