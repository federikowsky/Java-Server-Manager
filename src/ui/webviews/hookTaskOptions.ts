import * as vscode from 'vscode';
import type { Logger } from '@core/types';

export interface HookTaskOption {
  value: string;
  label: string;
}

export async function fetchHookTaskOptions(logger: Logger): Promise<HookTaskOption[]> {
  if (!('tasks' in vscode) || typeof vscode.tasks.fetchTasks !== 'function') {
    return [];
  }

  try {
    const tasks = await vscode.tasks.fetchTasks();
    const taskGroups = new Map<string, vscode.Task[]>();

    for (const task of tasks) {
      const taskName = task.name.trim();
      if (taskName.length === 0) {
        continue;
      }

      const existing = taskGroups.get(taskName);
      if (existing) {
        existing.push(task);
      } else {
        taskGroups.set(taskName, [task]);
      }
    }

    return [...taskGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([taskName, group]) => ({
        value: taskName,
        label: group.length > 1 ? `${taskName} (ambiguous: ${group.length} tasks)` : taskName,
      }));
  } catch (error) {
    logger.warn(`Failed to fetch VS Code tasks for hook options: ${String(error)}`);
    return [];
  }
}

export function areHookTaskOptionsEqual(left: HookTaskOption[], right: HookTaskOption[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((option, index) => option.value === right[index]?.value && option.label === right[index]?.label);
}