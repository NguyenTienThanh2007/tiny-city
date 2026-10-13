import type { BuildingType, CityCommand, CityPlan, Position, WorldState } from '@tiny-city/simulation';
import type { BuildingDesign } from './architecture.js';

export const LIMITS = Object.freeze({ mapTiles: 4096, buildings: 32, operations: 128, candidates: 4096 });
/**
 * Visual World 3.1: a requested architecture for a build. Either part may name the registry ID or the display name
 * ("Luxury Minimalist", "Glass Pavilion Villa"); the planner resolves it and never substitutes an unknown model.
 */
export interface BuildDesignRequest { collection: string | null; model: string | null }
export interface BuildRequest { buildingType: BuildingType; quantity: number; preferredPosition: Position | null; design?: BuildDesignRequest | null }
/** Screen-relative direction in the isometric view: left/right across, back/front up/down the screen. */
export type TargetRelative = 'left' | 'right' | 'back' | 'front';
/**
 * Which existing buildings a command means. Resolved deterministically against the live world by the planner,
 * never guessed: an exact match applies, several candidates require the user to choose, none is rejected.
 */
export interface TargetSelector {
  buildingType: BuildingType | null;
  /** Explicit building IDs (from the city context or the user's selection). */
  ids: string[];
  /** How many buildings are meant when `all` is false. */
  quantity: number;
  all: boolean;
  relative: TargetRelative | null;
}
export interface MoveTarget { target: TargetSelector; near: 'existing' | 'park' | 'road' | 'center'; position: Position | null }
export interface ArchitectIntent {
  summary: string; language: 'en' | 'vi'; style: 'compact' | 'coastal' | 'mixed';
  near: 'existing' | 'park' | 'road' | 'center';
  region: { x: number; y: number; width: number; height: number } | null;
  budgetLimit: number | null; connectRoads: boolean; builds: BuildRequest[];
  moves: { buildingId: string; position: Position }[]; demolish: string[];
  roadAdd: Position[]; roadRemove: Position[]; preserveBuildingIds: string[];
  unsupportedRequests: string[]; ambiguities: string[];
  /** AI Architect 2.0 target selectors (optional on the wire; defaults to empty / false). */
  demolishTargets: TargetSelector[]; moveTargets: MoveTarget[];
  /** "Keep the roads": road removals are a conflict, never applied. */
  preserveRoads: boolean;
  /** Building types the user asked to keep untouched. */
  preserveTypes: BuildingType[];
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
export interface TargetCandidate { buildingId: string; name: string; buildingType: BuildingType | null; position: Position }
/** A target that matched more buildings than requested: the user must pick exactly `quantity` of `candidates`. */
export interface PlanClarification {
  kind: 'demolish' | 'move'; index: number; quantity: number; message: string; candidates: TargetCandidate[];
}
/** Edits the current constraints do not allow; the user can explicitly authorize exactly these items. */
export interface PlanAuthorization {
  demolish: string[]; move: string[]; protectedIds: string[]; destructiveRequired: boolean; message: string;
}
/** Deterministic consequences of applying the plan, computed by the simulation. */
export interface PlanImpact {
  buildingsAdded: number; buildingsRemoved: number; buildingsMoved: number; roomsAdded: number; roomsRemoved: number;
  residentsRemoved: number; residentsRehoused: number; playerHomeRemoved: boolean;
}
export type ProposalStatus = 'VALIDATED' | 'PREVIEWED' | 'APPROVED' | 'APPLIED' | 'REJECTED';
export interface PlanProposal {
  contractVersion: 1; planId: string; digest: string; sourceWorldId: string;
  sourceRevision: number; sourceFingerprint: string; seed: number;
  status: ProposalStatus; summary: string; explanation: string;
  intent: ArchitectIntent; constraints: PlanningConstraints;
  placements: { buildingId: string; buildingType: BuildingType; position: Position;
    footprint: { width: number; height: number }; operation: 'build' | 'move';
    /** The architectural model a new building gets (null: classic look, or a move). */
    design: BuildingDesign | null }[];
  roads: { add: Position[]; remove: Position[] };
  projectedPlan: CityPlan; estimatedCost: number; projectedBudget: number;
  validation: { valid: boolean; fulfilled: boolean; operationCount: number };
  warnings: PlanWarning[]; commands: CityCommand[];
  clarifications: PlanClarification[]; authorization: PlanAuthorization | null; impact: PlanImpact;
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
