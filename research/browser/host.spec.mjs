import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { root } from '../../tests/examples.mjs';

const directory=join(root,'artifacts/research-host');

test('native host mounts independently and React portals clean up under StrictMode',async({page})=>{
  const requests=[],errors=[];
  page.on('request',request=>requests.push(request.url()));
  page.on('pageerror',error=>errors.push(error.message));
  const origin='http://d2-host.test';
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    const file={'/':'index.html','/probe.js':'probe.js'}[url.pathname];
    return url.origin===origin&&file?route.fulfill({path:join(directory,file)}):route.abort('accessdenied');
  });
  await page.goto(origin);
  await page.waitForFunction(()=>document.querySelectorAll('.native-scene > [data-slot]').length===2&&document.querySelectorAll('[data-card]').length===2);
  const buttons=page.getByRole('button');
  await expect(buttons).toHaveCount(2);
  await buttons.nth(0).click();
  await expect.poll(()=>page.evaluate(()=>window.actions)).toEqual(['a:a']);
  const state=await page.evaluate(()=>{
    window.savedA=document.querySelector('#a .native-scene');
    return {path:document.querySelector('#a svg path').getAttribute('d'),slots:[...document.querySelectorAll('.native-scene > [data-slot]')].map(x=>x.getBoundingClientRect().width),
      cards:[...document.querySelectorAll('[data-card]')].map(x=>x.getAttribute('data-card')),nativeActions:[...window.nativeActions]};
  });
  expect(state.path).toBe('M59.5 21 L161 21');
  expect(state.slots).toEqual([56,56]);
  expect(state.cards).toEqual(['a','b']);
  await page.evaluate(()=>window.unmountA());
  expect(await page.evaluate(()=>document.querySelector('#a .native-scene'))).toBeNull();
  await page.evaluate(()=>window.savedA.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await page.getByRole('button',{name:'Open b'}).click();
  await expect.poll(()=>page.evaluate(()=>window.nativeActions)).toEqual(['a','b']);
  await expect.poll(()=>page.evaluate(()=>window.actions)).toEqual(['a:a','b:b']);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
  expect(await page.locator('#b svg path').getAttribute('d')).toBe(state.path);
  expect(requests.every(url=>url.startsWith(origin+'/'))).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(join(directory,'report.json'),JSON.stringify({path:state.path,slotWidths:state.slots,cards:state.cards,
    nativeActionsAfterUnmount:['a','b'],reactActionsAfterUnmount:['a:a','b:b'],errors,requests,
    limits:['One native straight path and fixed slot geometry; no D2 parity claim.','Actual imported shadcn Card component with inline layout CSS; Tailwind theme styling is not included.','StrictMode remount, two instances, detached-root listener removal and sibling survival verified; packaging and complete cleanup are not.']},null,2)+'\n');
});
