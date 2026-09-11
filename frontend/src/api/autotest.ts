// ============================================================================
// 自动化测试接口客户端：方案 / 执行 / 运行记录 / 报告
// ============================================================================

import { apiUrl } from "./base";

export type AutoTestStepType = "write" | "wait" | "collect" | "judge";
export type JudgeMode = "absDevLte" | "gte" | "lte" | "between";
export type JudgeAgg = "avg" | "max" | "min" | "last" | "first";

export interface AutoTestStep {
  type: AutoTestStepType;
  label?: string;
  key?: string;
  value?: number;
  seconds?: number;
  count?: number;
  interval?: number;
  mode?: JudgeMode;
  agg?: JudgeAgg;
  ref?: number;
  min?: number;
  max?: number;
}

export interface AutoTestPlan {
  id: string;
  name: string;
  deviceId: string;
  loops: number;
  steps: AutoTestStep[];
  createdAt?: number;
  updatedAt?: number;
}

export interface AutoTestJudgment {
  loop: number;
  key: string;
  label: string;
  mode: string;
  agg: string;
  expect: string;
  actual: number | null;
  samples: number;
  pass: boolean;
}

export interface AutoTestRun {
  id: string;
  planId: string;
  planName: string;
  deviceId: string;
  deviceName: string;
  sampleId: string;
  loops: number;
  currentLoop: number;
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt: number;
  progress: string[];
  series: Record<string, { t: number; loop: number; values: Record<string, number> }[]>;
  judgments: AutoTestJudgment[];
  conclusion: "" | "qualified" | "unqualified";
  error: string;
  report: Record<string, any>[];
}

const BASE = "/api/autotest";

async function request<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(url), { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchPlans(): Promise<{ plans: AutoTestPlan[] } | null> {
  return request(`${BASE}/plans`);
}
export function savePlan(plan: Partial<AutoTestPlan>): Promise<{ plan: AutoTestPlan } | null> {
  return request(`${BASE}/plans`, { method: "POST", body: JSON.stringify({ plan }) });
}
export function deletePlan(id: string): Promise<{ ok: boolean } | null> {
  return request(`${BASE}/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function runPlan(
  planId: string,
  deviceId: string,
  sampleId = ""
): Promise<{ ok: boolean; run?: { id: string; planName: string; deviceName: string }; error?: string } | null> {
  return request(`${BASE}/plans/${encodeURIComponent(planId)}/run`, {
    method: "POST",
    body: JSON.stringify({ deviceId, sampleId }),
  });
}
export function fetchRuns(): Promise<{ runs: AutoTestRun[] } | null> {
  return request(`${BASE}/runs`);
}
export function fetchRun(id: string): Promise<{ run: AutoTestRun } | null> {
  return request(`${BASE}/runs/${encodeURIComponent(id)}`);
}
export function reportUrl(id: string): string {
  return apiUrl(`${BASE}/runs/${encodeURIComponent(id)}/report.csv`);
}
