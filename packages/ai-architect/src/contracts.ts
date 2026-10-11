import type { BuildingType, CityCommand, CityPlan, Position, WorldState } from '@tiny-city/simulation';

export const LIMITS = Object.freeze({ mapTiles: 4096, buildings: 32, operations: 128, candidates: 4096 });
export interface BuildRequest { buildingType: BuildingType; quantity: number; preferredPosition: Position | null }
export interface ArchitectIntent {
  summary: string; language: 'en' | 'vi'; style: 'compact' | 'coastal' | 'mixed';
  near: 'existing' | 'park' | 'road' | 'center';
  region: { x: number; y: number; width: number; height: number } | null;
  budgetLimit: number | null; connectRoads: boolean; builds: BuildRequest[];
  moves: { buildingId: string; position: Position }[]; demolish: string[];
  roadAdd: Position[]; roadRemove: Position[]; preserveBuildingIds: string[];
  unsupportedRequests: string[]; ambiguities: string[];
}
export interface PlanningConstraints {
  allowPartial: boolean; allowDestructive: boolean; allowedDemolitions: string[];
  allowedRoadRemovals: Position[]; preserveBuildingIds: string[];
  budgetLimit: number | null; maxOperations: number;
}
export const DEFAULT_CONSTRAINTS: PlanningConstraints = {
  allowPartial: false, allowDestructive: false, allowedDemolitions: [], allowedRoadRemovals: [],
  preserveBuildingIds: [], budgetLimit: null, maxOperations: LIMITS.operations,
};
export interface PlanWarning { code: string; message: string }
export type ProposalStatus = 'VALIDATED' | 'PREVIEWED' | 'APPROVED' | 'APPLIED' | 'REJECTED';
export interface PlanProposal {
  contractVersion: 1; planId: string; digest: string; sourceWorldId: string;
  sourceRevision: number; sourceFingerprint: string; seed: number;
  status: ProposalStatus; summary: string; explanation: string;
  intent: ArchitectIntent; constraints: PlanningConstraints;
  placements: { buildingId: string; buildingType: BuildingType; position: Position;
    footprint: { width: number; height: number }; operation: 'build' | 'move' }[];
  roads: { add: Position[]; remove: Position[] };
  projectedPlan: CityPlan; estimatedCost: number; projectedBudget: number;
  validation: { valid: boolean; fulfilled: boolean; operationCount: number };
  warnings: PlanWarning[]; commands: CityCommand[];
}
export interface PlanningRequest {
  contractVersion: 1; prompt: string; world: WorldState; sourceRevision: number;
  seed?: number; constraints?: Partial<PlanningConstraints>;
}
export interface ValidationRequest extends Omit<PlanningRequest, 'prompt'> { intent: ArchitectIntent }
export interface PlanningResponse { requestId: string; proposal: PlanProposal }
export interface ArchitectErrorResponse { requestId: string; error: { code: string; message: string; retryable: boolean } }
export class PlanError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PlanError'; }
}
