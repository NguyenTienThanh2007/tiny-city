import { mkdir, writeFile } from 'node:fs/promises';
import { createWorld } from '@tiny-city/simulation';
import { createProposal } from '@tiny-city/ai-architect';
const world=createWorld({id:'villa-gardens-world',seed:7,startingFunds:5000,clock:{paused:true},
  plan:{id:'villa-gardens-plan',name:'Villa Gardens',width:64,height:64,buildings:[],
    roads:Array.from({length:36},(_,i)=>({x:i+5,y:20})),
    blockedTiles:Array.from({length:4096},(_,i)=>({x:i%64,y:Math.floor(i/64)})).filter(p=>p.x+p.y>=120)}});
const intent={summary:'Build two villas and a park',language:'en',style:'compact',near:'existing',region:null,budgetLimit:1000,
  connectRoads:true,builds:[{buildingType:'villa',quantity:2,preferredPosition:null},{buildingType:'park',quantity:1,preferredPosition:null}],
  moves:[],demolish:[],roadAdd:[],roadRemove:[],preserveBuildingIds:[],unsupportedRequests:[],ambiguities:[]};
const request={contractVersion:1,prompt:'Build 2 villas and a park within $1,000; preserve the existing city.',world,sourceRevision:0,seed:7,constraints:{allowPartial:false}};
const proposal=await createProposal(world,0,intent,7,request.constraints);
const root=new URL('../docs/ai-architect/examples/',import.meta.url);await mkdir(root,{recursive:true});
for(const [file,data] of Object.entries({'plan-request.json':request,'validate-request.json':{...request,prompt:undefined,intent},'mock-plan-response.json':{requestId:'offline-example',proposal},'error-response.json':{requestId:'offline-error',error:{code:'PROVIDER_NOT_CONFIGURED',message:'Set GEMINI_API_KEY in the backend .env file.',retryable:false}}})) {
  await writeFile(new URL(file,root),JSON.stringify(data,null,2)+'\n');
}
