import type { CommandHandler } from "../../../messaging/command-handler.js";
import type { RunAgentTurnHandler } from "../run-agent-turn/run-agent-turn.handler.js";
import type { CancelAgentSteerCommand, SteerAgentTurnCommand } from "./steer-agent-turn.command.js";

export interface AgentSteerResult {
  readonly steerId: string;
  readonly accepted: boolean;
}

export class SteerAgentTurnHandler implements CommandHandler<SteerAgentTurnCommand, AgentSteerResult> {
  constructor(private readonly turns: RunAgentTurnHandler) {}

  async handle(command: SteerAgentTurnCommand): Promise<AgentSteerResult> {
    return {
      steerId: command.steerId,
      accepted: this.turns.queueSteer(command),
    };
  }
}

export class CancelAgentSteerHandler implements CommandHandler<CancelAgentSteerCommand, AgentSteerResult> {
  constructor(private readonly turns: RunAgentTurnHandler) {}

  async handle(command: CancelAgentSteerCommand): Promise<AgentSteerResult> {
    return {
      steerId: command.steerId,
      accepted: this.turns.cancelSteer(command.conversationId, command.traceId, command.steerId),
    };
  }
}
