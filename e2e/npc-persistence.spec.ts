import { expect, test } from '@playwright/test';
import { deserializeWorld, serializeWorld, Simulation } from '@tiny-city/simulation';
import { createCityWorld, projectCity } from '../src/simulation/cityAdapter';
import type { CityState } from '../src/types';

test('managed NPCs survive production UI road editing, undo and save/reload',async({page})=>{
  const city:CityState={size:64,funds:5000,roads:Array.from({length:41},(_,i)=>({x:i+8,y:20})),buildings:[
    {id:'home',name:'Home',kind:'villa',x:12,y:21,createdAt:0},
    {id:'park',name:'Park',kind:'park',x:16,y:21,createdAt:0},
    {id:'office',name:'Office',kind:'office',x:24,y:21,createdAt:0}]};
  const sim=new Simulation(createCityWorld(city));sim.enablePopulation({maxCitizens:100});sim.step(600);
  const original=sim.getState();expect(original.citizens).toHaveLength(2);
  const key='tiny-city-imagine-save-v1',saved={...projectCity(original,city),saveVersion:3,simulation:JSON.parse(serializeWorld(original))};
  await page.addInitScript(({key,saved})=>{if(!sessionStorage.getItem('npc-fixture')){localStorage.setItem(key,JSON.stringify(saved));sessionStorage.setItem('npc-fixture','1');}},{key,saved});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-building-home')).toBeVisible();
  const save=async()=>{await page.getByRole('button',{name:/^(Save|Saved)$/}).click();return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).simulation,key);};
  expect(await save()).toEqual(original);
  await page.getByRole('navigation',{name:'Build tools'}).getByRole('button',{name:'Road $8',exact:true}).click();
  const bounds=(await page.locator('canvas').boundingBox())!;
  const points=(await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map(p=>p.split(',').map(n=>Number(n)*64/100));
  const world=(x:number,y:number)=>({x:(x-y)*28,y:(x+y)*14});
  const origin=world(points[0][0],points[0][1]),right=world(points[1][0],points[1][1]),scale=bounds.width/(right.x-origin.x),target=world(31.5,24.5);
  await page.mouse.click(bounds.x+(target.x-origin.x)*scale,bounds.y+(target.y-origin.y)*scale);
  await expect(page.getByLabel('Latest simulation event')).toContainText('city.roads-edited');
  const changed=deserializeWorld(JSON.stringify(await save()));expect(changed.citizens).toHaveLength(2);expect(changed.budget.balance).toBe(4992);
  await page.getByRole('button',{name:'Undo',exact:true}).click();const undone=deserializeWorld(JSON.stringify(await save()));
  expect(undone.plan).toEqual(original.plan);expect(undone.budget).toEqual(original.budget);
  expect(undone.citizens.map(c=>[c.id,c.name,c.homeBuildingId,c.workBuildingId,c.attributes])).toEqual(original.citizens.map(c=>[c.id,c.name,c.homeBuildingId,c.workBuildingId,c.attributes]));
  await page.reload();await expect(page.locator('canvas')).toBeVisible();expect(await save()).toEqual(undone);expect(errors).toEqual([]);
});
