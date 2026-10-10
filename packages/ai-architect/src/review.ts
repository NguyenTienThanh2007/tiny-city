import type { CityCommandResult, Simulation, WorldState } from '@tiny-city/simulation';
import { PlanError } from './contracts.js';
import type { PlanProposal, ProposalStatus } from './contracts.js';
import { canonical, cityFingerprint, digestPayload, hash } from './integrity.js';
import { createProposal } from './planner.js';

export type PlanningHost = Pick<Simulation,'getState'|'executeBatch'>;
const sessions = new WeakMap<PlanningHost,Map<string,ProposalStatus>>();
const cityData=(w:WorldState)=>canonical({id:w.id,revision:w.revision,plan:w.plan,budget:w.budget,nextBuildingId:w.nextBuildingId});

/** Attach to the existing engine/commit boundary; never create a competing live world. */
export class PlanReview {
  private readonly proposal: PlanProposal;
  private readonly registry: Map<string,ProposalStatus>;
  constructor(private readonly host:PlanningHost, proposal:PlanProposal) {
    this.proposal=JSON.parse(JSON.stringify(proposal)) as PlanProposal;
    this.registry=sessions.get(host) ?? new Map();sessions.set(host,this.registry);
    if(this.registry.has(proposal.planId)) throw new PlanError('ALREADY_APPLIED','This plan already has a review session.');
    this.registry.set(proposal.planId,proposal.status==='REJECTED'?'REJECTED':'VALIDATED');
  }
  get status():ProposalStatus { return this.registry.get(this.proposal.planId)!; }
  private async validate():Promise<string> {
    const world=this.host.getState();
    if(world.id!==this.proposal.sourceWorldId || world.revision!==this.proposal.sourceRevision || await cityFingerprint(world)!==this.proposal.sourceFingerprint) throw new PlanError('STALE_WORLD','The city changed; request a new plan.');
    if(this.proposal.contractVersion!==1 || !this.proposal.validation.valid || !this.proposal.commands.length) throw new PlanError('PLAN_REJECTED','This proposal cannot be applied.');
    const digest=await hash(digestPayload(this.proposal));
    if(digest!==this.proposal.digest || this.proposal.planId!==`plan-${digest}`) throw new PlanError('INVALID_PROPOSAL','The proposal was modified.');
    const expected=await createProposal(world,world.revision,this.proposal.intent,this.proposal.seed,this.proposal.constraints);
    if(!expected.validation.valid) throw new PlanError('PLAN_REJECTED','The simulation no longer accepts this proposal.');
    if(expected.digest!==digest) throw new PlanError('INVALID_PROPOSAL','The commands, geometry or cost do not match authoritative planning.');
    return cityData(world);
  }
  async preview():Promise<PlanProposal> {
    if(this.status!=='VALIDATED') throw new PlanError('PLAN_REJECTED','Only a validated proposal can be previewed.');
    const source=await this.validate();
    if(cityData(this.host.getState())!==source) throw new PlanError('STALE_WORLD','The city changed while validating.');
    if(this.status!=='VALIDATED') throw new PlanError('PLAN_REJECTED','Review was cancelled.');
    this.registry.set(this.proposal.planId,'PREVIEWED');
    return JSON.parse(JSON.stringify({...this.proposal,status:'PREVIEWED'})) as PlanProposal;
  }
  approve(planId:string, options:{allowDestructive?:boolean}={}):void {
    if(this.status!=='PREVIEWED' || planId!==this.proposal.planId) throw new PlanError('APPROVAL_REQUIRED','Preview and approve this exact plan ID first.');
    if(this.proposal.commands.some(c=>c.type==='city.demolish' || c.type==='city.edit-roads' && c.remove.length>0) && options.allowDestructive!==true) throw new PlanError('DESTRUCTIVE_APPROVAL_REQUIRED','Explicitly approve the displayed destructive edits.');
    this.registry.set(this.proposal.planId,'APPROVED');
  }
  reject():void {
    if(this.status==='APPLIED') throw new PlanError('ALREADY_APPLIED','The plan has already been applied.');
    this.registry.set(this.proposal.planId,'REJECTED');
  }
  async apply():Promise<CityCommandResult> {
    if(this.status==='APPLIED') throw new PlanError('ALREADY_APPLIED','This plan was already applied.');
    if(this.status!=='APPROVED') throw new PlanError('APPROVAL_REQUIRED','Explicit approval is required.');
    const source=await this.validate();
    const currentStatus: ProposalStatus = this.registry.get(this.proposal.planId)!;
    if(currentStatus==='APPLIED') throw new PlanError('ALREADY_APPLIED','This plan was already applied.');
    if(currentStatus!=='APPROVED') throw new PlanError('APPROVAL_REQUIRED','Approval was cancelled.');
    if(cityData(this.host.getState())!==source) throw new PlanError('STALE_WORLD','The city changed while validating.');
    // No await between this final check and the authoritative atomic commit.
    const result=this.host.executeBatch(this.proposal.commands);
    if(!result.applied) throw new PlanError('PLAN_REJECTED','The simulation rejected the complete batch; nothing was applied.');
    this.registry.set(this.proposal.planId,'APPLIED');return result;
  }
}
