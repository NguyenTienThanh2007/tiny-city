import { createProposal, inspectWorld, interpretLocally, PlanError } from './index.js';
import type { ArchitectIntent, PlanningConstraints } from './contracts.js';

let size=0;const chunks:Buffer[]=[];
try {
  for await(const chunk of process.stdin) {
    const data=Buffer.from(chunk as Buffer);size+=data.length;
    if(size>1048576) throw new PlanError('REQUEST_TOO_LARGE','Planner input exceeds 1 MiB.');chunks.push(data);
  }
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {action:string;world:unknown;sourceRevision:number;intent:ArchitectIntent;seed?:number;constraints?:Partial<PlanningConstraints>;prompt?:unknown;context?:{buildings?:{id:string;name:string}[]}};
  const data=input.action==='inspect' ? inspectWorld(input.world,input.sourceRevision) : input.action==='plan'
    ? await createProposal(input.world,input.sourceRevision,input.intent,input.seed,input.constraints)
    : input.action==='interpret' && typeof input.prompt==='string' && input.prompt.length<=4000
    ? interpretLocally(input.prompt,{buildings:(input.context?.buildings??[]).filter(b=>typeof b?.id==='string'&&typeof b?.name==='string').slice(0,4096)})
    : (()=>{throw new PlanError('INVALID_REQUEST','Unsupported planner action.');})();
  process.stdout.write(JSON.stringify({ok:true,data}));
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false,error:{code:error instanceof PlanError?error.code:'INVALID_REQUEST',message:error instanceof PlanError?error.message:'Invalid planning input.',retryable:false}}));
}
