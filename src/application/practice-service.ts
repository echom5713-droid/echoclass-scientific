import { hasRole } from "../domain/authorization.js";
import type { PracticeRepository } from "../domain/repositories.js";
import type { PracticeAnswer, Session } from "../domain/types.js";
import { AppError } from "./errors.js";
import type { IdGenerator } from "./ports.js";

export interface SavePracticeAnswerCommand {
  qid: string;
  level: number;
  correct: boolean;
  selected: number;
}

export class PracticeService {
  constructor(
    private readonly repository: PracticeRepository,
    private readonly ids: IdGenerator,
  ) {}

  async save(command: SavePracticeAnswerCommand, actor: Session | null): Promise<void> {
    if (
      !command.qid ||
      command.qid.length > 20 ||
      !Number.isInteger(command.level) ||
      !Number.isInteger(command.selected)
    )
      throw new AppError("VALIDATION_ERROR", "练习答案格式无效", 400);
    await this.repository.add({
      id: `pa-${this.ids.random(12)}`,
      student: actor
        ? { id: actor.id, name: actor.name, class_name: actor.class_name }
        : { id: "guest", name: "游客", class_name: "—" },
      qid: command.qid,
      level: command.level,
      correct: command.correct,
      selected: command.selected,
      ts: new Date().toISOString(),
    });
  }

  async results(actor: Session | null): Promise<PracticeAnswer[]> {
    if (!hasRole(actor, ["teacher", "admin"])) throw new AppError("FORBIDDEN", "无权限", 403);
    const answers = await this.repository.findAll();
    return actor?.role === "admin"
      ? answers
      : answers.filter((answer) => answer.student.class_name === actor?.class_name);
  }
}
