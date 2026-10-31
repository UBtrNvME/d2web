import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathData, root } from '../../tests/examples.mjs';

test('packed native module supports consumer theming and explicit measured-size native relayout', async ({page}) => {
  const directory=join(root,'artifacts/research-consumer'), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let compilations=0;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://d2-consumer.test')return route.abort();
    if(url.pathname==='/compile-size'){
      const {width,height}=route.request().postDataJSON();
      if(width!==160||height!==80)return route.fulfill({status:400,body:'Unexpected measured dimensions'});
      // The checked-in sizing case is the only measurement this fixture admits.
      const source=readFileSync(join(root,'examples/research/sizing/main.d2'),'utf8');
      const result=spawnSync(join(root,'artifacts/scene-probe/scene-probe'),[source],{encoding:'utf8',timeout:30000});
      if(result.status!==0)return route.fulfill({status:500,body:result.stderr});
      const data=JSON.parse(result.stdout), edge=data.webScene.Root.Children.find(n=>n.ID===data.target.connections[0].id);
      compilations++;
      return route.fulfill({json:{box:data.webScene.Root.Children.find(n=>n.ID==='source').Children[0].Primitive.Box,path:pathData(edge.Children[0].Primitive.Commands)}});
    }
    const file={'/':'index.html','/probe.js':'probe.js','/theme.css':'theme.css'}[url.pathname];
    return file?route.fulfill({path:join(directory,file)}):route.abort();
  });
  await page.goto('http://d2-consumer.test');
  const card=page.locator('[data-card]');await expect(card).toBeVisible();
  await expect(card).toHaveCSS('background-color','rgb(240, 245, 250)');
  await expect(card).toHaveCSS('padding-top','4px');
  await expect(card).toHaveCSS('display','flex');
  await expect(card).toHaveCSS('border-radius','12px');
  await expect(card).toHaveCSS('border-top-color','rgb(100, 110, 120)');
  const original=await page.locator('svg path').getAttribute('d');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await expect(card).toHaveCSS('background-color','rgb(20, 30, 40)');
  await expect(card).toHaveCSS('color','rgb(230, 240, 250)');
  await expect(card).toHaveCSS('border-radius','16px');
  await expect(card).toHaveCSS('border-top-color','rgb(150, 160, 170)');
  await expect(page.locator('svg path')).toHaveCSS('stroke','rgb(123, 44, 191)');
  expect(await page.locator('svg path').getAttribute('d')).toBe(original);
  await page.getByRole('button',{name:'Card 0'}).click();
  await expect(page.getByRole('button',{name:'Card 1'})).toBeVisible();
  await page.evaluate(()=>window.resizeCard());
  expect(compilations).toBe(1);
  await expect(page.locator('[data-native-slot]')).toHaveCSS('width','160px');
  await expect(page.locator('[data-native-slot]')).toHaveCSS('height','80px');
  expect(await page.locator('svg path').getAttribute('d')).not.toBe(original);
  const expected=JSON.parse(readFileSync(join(directory,'evidence.json'),'utf8')).geometryResized;
  expect(await page.evaluate(()=>window.geometry)).toEqual(expected);
  const retained=await page.locator('svg path').getAttribute('d');
  expect(await page.evaluate(()=>{try{window.handle.update({box:{Width:-1},path:'bad'});return false}catch{return true}})).toBe(true);
  expect(await page.locator('svg path').getAttribute('d')).toBe(retained);
  expect(errors).toEqual([]);
});
