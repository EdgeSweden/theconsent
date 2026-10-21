/** Runtime types shared by the core and the build-time schema. No runtime code. */

export interface ConsentState {
  categories: Record<string, boolean>;
  policyVersion: string;
  locale: string;
  /** Stored choice timestamp (unix seconds), or `null` when no valid choice exists. */
  at: number | null;
}

export type ConsentAction = "accept_all" | "reject_all" | "custom" | "withdraw";

export interface ConsentRecord {
  action: ConsentAction;
  categories: Record<string, boolean>;
  policyVersion: string;
  packageVersion: string;
  locale: string;
  /** Unix seconds. */
  at: number;
}

export type ConsentRecorder = (record: ConsentRecord) => void | Promise<void>;
