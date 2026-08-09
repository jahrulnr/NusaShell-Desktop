/**
 * Todo-status domain (ticket #80, Klaster A).
 *
 * The pure todo rules moved to `packages/domain/src/agent/todo-status.ts`;
 * this module re-exports them so application consumers keep a stable import
 * path and the todo status vocabulary has a single source of truth.
 */
export {
  summarizeTodos,
  countOpenTodos,
  type AgentTodoStatus,
  type AgentTodoItem,
  type AgentTodoList,
  type AgentTodoSummary,
} from "@nusashell/domain";
