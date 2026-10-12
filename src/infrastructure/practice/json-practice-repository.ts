import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PracticeAnswer } from "../../domain/types.js";
import type { PracticeRepository } from "../../domain/repositories.js";

export class JsonPracticeRepository implements PracticeRepository {
  private readonly file = path.resolve(process.cwd(), "data/practice_answers.json");

  async findAll(): Promise<PracticeAnswer[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(data) ? (data as PracticeAnswer[]) : [];
    } catch {
      return [];
    }
  }

  async add(answer: PracticeAnswer): Promise<void> {
    const all = await this.findAll();
    all.push(answer);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(all), "utf8");
  }
}
