// Explicit manual paid smoke only. Playwright excludes this file by default and refuses it in CI.
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { RoadGraph, type WorldState } from '@tiny-city/simulation';
import type { PlanningResponse } from '@tiny-city/ai-architect';
import type { CityState } from '../src/types';

const key='tiny-city-imagine-save-v1';
const fixture:CityState={size:64,funds:5000,roads:Array.from({length:41},(_,i)=>({x:i+8,y:20})),
  buildings:[{id:'existing-villa',name:'Existing villa',kind:'villa',x:30,y:21,createdAt:0}]};
async function save(page:Page):Promise<CityState & {simulation:WorldState}> {
  await page.getByRole('button',{name:/^(Save|Saved)$/}).click();
  return page.evaluate(storageKey=>JSON.parse(localStorage.getItem(storageKey)!),key);
}

test('live Gemini prompt through the production UI, immutable preview, approval, undo/redo and reload',async({page})=>{
  test.setTimeout(90_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({storageKey,city})=>{
    if(!sessionStorage.getItem('live-ui-fixture')) {
      localStorage.setItem(storageKey,JSON.stringify(city));sessionStorage.setItem('live-ui-fixture','1');
    }
  },{storageKey:key,city:fixture});
  await page.goto('/');await expect(page.locator('canvas')).toBeVisible();
  const before=await save(page);await page.mouse.move(1100,50);
  const originalCanvas=await page.locator('canvas').screenshot();
  const prompt='Build exactly two villas at preferred tiles (10,10) and (14,10), and one park at preferred tile (10,14). Connect the villas to existing roads. Spend at most 500 including roads. Preserve every existing building and road. No demolition or partial quantities.';
  await page.getByRole('textbox',{name:'Describe a city change'}).fill(prompt);
  const pending=page.waitForResponse(response=>response.url().endsWith('/v1/city/plan')&&response.request().method()==='POST');
  const started=Date.now();await page.getByRole('button',{name:'Generate AI plan'}).click();
  const response=await pending;const elapsedMs=Date.now()-started;expect(response.status()).toBe(200);
  const data=await response.json() as PlanningResponse;const proposal=data.proposal;
  expect(proposal.summary).not.toContain('Offline fixture');expect(proposal.intent.language).toBe('en');
  expect(proposal.validation).toMatchObject({valid:true,fulfilled:true});expect(proposal.placements).toHaveLength(3);
  expect(proposal.placements.filter(p=>p.buildingType==='villa')).toHaveLength(2);
  expect(proposal.placements.filter(p=>p.buildingType==='park')).toHaveLength(1);
  expect(proposal.estimatedCost).toBeLessThanOrEqual(500);expect(proposal.roads.add.length).toBeGreaterThan(0);
  await expect(page.getByRole('button',{name:'Approve & build'})).toBeVisible();
  await page.mouse.move(1100,50);
  await expect.poll(async()=>!(await page.locator('canvas').screenshot()).equals(originalCanvas)).toBe(true);
  expect((await save(page)).simulation).toEqual(before.simulation);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/phase2-live-preview.png',fullPage:true});
  await page.getByRole('button',{name:'Approve & build'}).click();
  await expect(page.getByRole('status',{name:'City notice'})).toContainText('AI city plan applied');
  const applied=await save(page);expect(applied.simulation.plan).toEqual(proposal.projectedPlan);
  expect(applied.funds).toBe(before.funds-proposal.estimatedCost);expect(applied.buildings).toHaveLength(4);
  expect(applied.simulation.plan.buildings.find(b=>b.id==='existing-villa')).toEqual(before.simulation.plan.buildings[0]);
  expect(new RoadGraph(applied.simulation.plan.roads).getComponents()).toHaveLength(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();const undone=await save(page);
  expect(undone.simulation.plan).toEqual(before.simulation.plan);expect(undone.simulation.budget).toEqual(before.simulation.budget);
  await page.getByRole('button',{name:'Redo',exact:true}).click();const redone=await save(page);
  expect(redone.simulation.plan).toEqual(applied.simulation.plan);expect(redone.simulation.budget).toEqual(applied.simulation.budget);
  await page.reload();await expect(page.getByTestId('minimap-building-building-1')).toBeVisible();
  expect((await save(page)).simulation).toEqual(redone.simulation);expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/phase2-live-applied.png',fullPage:true});
  await writeFile('test-results/phase2-live-ui-result.json',JSON.stringify({result:'PASS',executedAt:new Date().toISOString(),
    provider:'Gemini',httpStatus:response.status(),elapsedMs,requestId:data.requestId,planId:proposal.planId,
    buildingsAdded:3,roadTilesAdded:proposal.roads.add.length,commands:proposal.commands.length,
    estimatedCost:proposal.estimatedCost,fundsBefore:before.funds,fundsAfter:applied.funds,
    previewImmutable:true,previewRendered:true,atomicApproval:true,undoRedo:true,saveReload:true,
    preservedExisting:true,warnings:proposal.warnings.map(w=>w.code)},null,2)+'\n');
});
