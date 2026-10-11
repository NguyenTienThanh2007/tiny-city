import { expect, test, type Page, type Response } from '@playwright/test';
import { BUILDING_CATALOG, RoadGraph, type WorldState } from '@tiny-city/simulation';
import type { PlanningResponse } from '@tiny-city/ai-architect';
import type { CityState } from '../src/types';

const SAVE_KEY='tiny-city-imagine-save-v1';
const fixture: CityState={size:64,funds:5000,buildings:[],roads:Array.from({length:41},(_,i)=>({x:i+8,y:20}))};
type SavedCity=CityState & {simulation:WorldState};
const planningResponse=(response:Response)=>response.url().endsWith('/v1/city/plan') && response.request().method()==='POST';

async function openCity(page:Page) {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({key,city})=>{
    if(!sessionStorage.getItem('phase2-fixture')) {
      localStorage.setItem(key,JSON.stringify(city));sessionStorage.setItem('phase2-fixture','1');
    }
  },{key:SAVE_KEY,city:fixture});
  await page.goto('/');await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points',/,/);
  return errors;
}
async function save(page:Page):Promise<SavedCity> {
  await page.getByRole('button',{name:/^(Save|Saved)$/}).click();
  return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),SAVE_KEY);
}
async function generate(page:Page,prompt:string):Promise<PlanningResponse> {
  await page.getByRole('textbox',{name:'Describe a city change'}).fill(prompt);
  const pending=page.waitForResponse(planningResponse);
  await page.getByRole('button',{name:'Generate AI plan'}).click();
  const response=await pending;expect(response.status()).toBe(200);
  const result=await response.json() as PlanningResponse;
  await expect(page.getByRole('button',{name:'Approve & build'})).toBeVisible();
  return result;
}
async function clickTile(page:Page,x:number,y:number) {
  const bounds=(await page.locator('canvas').boundingBox())!;
  const points=(await page.getByTestId('minimap-camera').getAttribute('points'))!
    .split(' ').map(pair=>pair.split(',').map(value=>Number(value)*64/100));
  const world=(gx:number,gy:number)=>({x:(gx-gy)*28,y:(gx+gy)*14});
  const origin=world(points[0][0],points[0][1]),right=world(points[1][0],points[1][1]);
  const scale=bounds.width/(right.x-origin.x),target=world(x+0.5,y+0.5);
  await page.mouse.click(bounds.x+(target.x-origin.x)*scale,bounds.y+(target.y-origin.y)*scale);
}

for(const [language,prompt] of [['en','Build two villas and one park; preserve existing roads.'],['vi','Xây hai biệt thự và một công viên; giữ nguyên đường hiện có.']]) {
  test(`${language}: real planning API, Pixi preview, reject/regenerate, atomic approval, undo/redo and save/reload`,async({page})=>{
    const errors=await openCity(page);const before=await save(page);
    await page.mouse.move(1100,50);const originalCanvas=await page.locator('canvas').screenshot();
    const first=await generate(page,prompt);
    expect(first.proposal.intent.language).toBe(language);
    expect(first.proposal.summary).toContain('Offline fixture'); // CI never claims mocked interpretation is Gemini.
    expect(first.proposal.validation).toMatchObject({valid:true,fulfilled:true});
    expect(first.proposal.placements).toHaveLength(3);
    await page.mouse.move(1100,50);
    await expect.poll(async()=>!(await page.locator('canvas').screenshot()).equals(originalCanvas)).toBe(true);
    expect((await save(page)).simulation).toEqual(before.simulation);
    await page.getByRole('button',{name:'Reject',exact:true}).click();
    await expect(page.getByText('Proposal rejected. Your city is unchanged.')).toBeVisible();
    expect((await save(page)).simulation).toEqual(before.simulation);
    const second=await generate(page,prompt);expect(second.proposal.planId).toBe(first.proposal.planId);
    expect((await save(page)).simulation).toEqual(before.simulation);
    await page.getByRole('button',{name:'Approve & build'}).click();
    await expect(page.getByRole('status',{name:'City notice'})).toContainText('AI city plan applied');
    const applied=await save(page);
    expect(applied.simulation.plan).toEqual(second.proposal.projectedPlan);
    expect(applied.funds).toBe(before.funds-second.proposal.estimatedCost);
    expect(applied.simulation.budget.balance).toBe(second.proposal.projectedBudget);
    expect(applied.buildings).toHaveLength(3);
    const graph=new RoadGraph(applied.simulation.plan.roads);expect(graph.getComponents()).toHaveLength(1);
    for(const building of applied.simulation.plan.buildings) {
      if(building.type && BUILDING_CATALOG[building.type].requiresRoad) expect(graph.getAdjacentComponents(building).length).toBeGreaterThan(0);
    }
    await expect(page.getByRole('button',{name:'Approve & build'})).toHaveCount(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    const undone=await save(page);expect(undone.simulation.plan).toEqual(before.simulation.plan);expect(undone.simulation.budget).toEqual(before.simulation.budget);
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    const redone=await save(page);expect(redone.simulation.plan).toEqual(applied.simulation.plan);expect(redone.simulation.budget).toEqual(applied.simulation.budget);
    await page.reload();await expect(page.getByTestId('minimap-building-building-1')).toBeVisible();
    expect((await save(page)).simulation).toEqual(redone.simulation);
    await expect(page.getByRole('button',{name:'Approve & build'})).toHaveCount(0);expect(errors).toEqual([]);
  });
}

test('provider errors show useful feedback and leave the city unchanged',async({page})=>{
  await openCity(page);const before=await save(page);
  await page.route('**/v1/city/plan',route=>route.fulfill({status:503,json:{requestId:'failure-test',error:{code:'PROVIDER_TIMEOUT',message:'The AI provider timed out. Retry when ready.',retryable:true}}}));
  await page.getByRole('textbox',{name:'Describe a city change'}).fill('Build a park');
  await page.getByRole('button',{name:'Generate AI plan'}).click();
  await expect(page.getByText('The AI provider timed out. Retry when ready.')).toBeVisible();
  await expect(page.getByText('Request failure-test',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve & build'})).toHaveCount(0);
  expect((await save(page)).simulation).toEqual(before.simulation);
});

test('manual road editing invalidates an AI preview without applying its buildings',async({page})=>{
  await openCity(page);const before=await save(page);await generate(page,'Build two villas and a park');
  await page.getByRole('navigation',{name:'Build tools'}).getByRole('button',{name:'Road $8',exact:true}).click();
  await clickTile(page,31,24);
  await expect(page.getByText('The city changed after preview. Generate a fresh plan before applying.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve & build'})).toHaveCount(0);
  const changed=await save(page);expect(changed.buildings).toHaveLength(0);expect(changed.roads).toHaveLength(before.roads.length+1);expect(changed.funds).toBe(before.funds-8);
});

test('cancellation ignores a late real API response',async({page})=>{
  await openCity(page);const before=await save(page);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let received!:()=>void;const ready=new Promise<void>(resolve=>{received=resolve;});
  let calls=0;
  await page.route('**/v1/city/plan',async route=>{
    if(route.request().method()!=='POST') {await route.continue();return;}
    calls+=1;
    const response=await route.fetch();received();await gate;
    await route.fulfill({response}).catch(()=>{}); // The browser may have aborted its socket already.
  });
  await page.getByRole('textbox',{name:'Describe a city change'}).fill('Build two villas and a park');
  await page.getByRole('button',{name:'Generate AI plan'}).click();await ready;
  await page.getByRole('button',{name:'Cancel planning request'}).click();release();
  await expect(page.getByText('Planning was cancelled. Your city is unchanged.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve & build'})).toHaveCount(0);
  expect((await save(page)).simulation).toEqual(before.simulation);
  expect(calls).toBe(1);
});

test('mobile AI panel can reveal the map while preserving a preview and approval',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openCity(page);
  await expect(page.locator('.architect-panel')).toBeHidden();
  await page.getByRole('button',{name:'Show AI Architect panel'}).click();
  await expect(page.getByRole('checkbox',{name:'Protect existing buildings'})).toBeVisible();
  await page.getByRole('button',{name:'Hide AI Architect panel'}).click();
  const before=await save(page);const response=await generate(page,'Build two villas and one park');
  await page.getByRole('button',{name:'Hide AI Architect panel'}).click();
  await expect(page.locator('.architect-panel')).toBeHidden();expect((await save(page)).simulation).toEqual(before.simulation);
  await page.getByRole('button',{name:'Show AI Architect panel'}).click();
  await page.getByRole('button',{name:'Approve & build'}).click();
  await expect(page.getByRole('status',{name:'City notice'})).toContainText('AI city plan applied');
  await expect(page.locator('.architect-panel')).toBeHidden();const applied=await save(page);
  expect(applied.simulation.plan).toEqual(response.proposal.projectedPlan);expect(applied.funds).toBe(response.proposal.projectedBudget);
});
