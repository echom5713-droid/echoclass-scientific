import * as legacy from "./pages.js";
import type { ExperimentRecord, Session, User } from "../domain/types.js";

type Page = (...args: never[]) => string;

const source = legacy as unknown as {
  DEMO_RECORDS: ExperimentRecord[];
  esc(value: unknown): string;
  analyticsFor(records: ExperimentRecord[]): {
    count: number;
    validCount: number;
    reviewCount: number;
    stats: Array<{
      conc: number;
      count: number;
      meanYield: number;
      stdYield: number;
      meanZone: number;
    }>;
    errorCounts: Record<string, number>;
  };
  trendSvg(
    records: ExperimentRecord[],
    concentration?: number,
    currentYield?: number | null,
  ): string;
  homePage(
    session: Session | null,
    records?: ExperimentRecord[],
    demoCredentialsEnabled?: boolean,
  ): string;
  themePage(session: Session | null, records?: ExperimentRecord[]): string;
  demoPage(session: Session | null): string;
  loginPage(role: string, session: Session | null, demoCredentialsEnabled?: boolean): string;
  studentPage(records: ExperimentRecord[], session: Session | null, demo?: boolean): string;
  teacherPage(records: ExperimentRecord[], session: Session | null, demo?: boolean): string;
  adminPage(records: ExperimentRecord[], users: User[], session: Session | null): string;
  practicePage(session: Session): string;
  resourcesPage(session: Session | null): string;
  llmPage(session: Session | null): string;
  curriculumPage(session: Session | null): string;
  reportPage(records: ExperimentRecord[], session: Session | null, demo?: boolean): string;
};

export const views = source;
export type LegacyPage = Page;
