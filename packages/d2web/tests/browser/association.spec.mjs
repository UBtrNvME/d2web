import { test, expect } from '@playwright/test';
import { open } from './harness.mjs';

// Spec 0004 end to end in Chromium: a click on a painted object resolves, through the association, to the source text that declares it.
const source = 'direction: right\ndb: Database { shape: cylinder }\napi: API { style.fill: "#fff4cc"; link: https://example.test/api }\napi -> db: query\n';
const host = '<div id="a" style="position:absolute;left:20px;top:20px"></div>';

test('a click resolves to the declaring source text; light and dark give the same association', async ({ page }) => {
  await open(page, { body: host });
  const found = await page.evaluate(async source => {
    document.addEventListener('click', e => { if (e.composedPath().some(n => n.tagName === 'A')) e.preventDefault(); }, true);
    const result = await compile(source);
    const dark = await compile(source, { themeId: 200 });
    const association = result.boards[0].association;
    window.m = d2web.mount(document.getElementById('a'));
    window.clicked = [];
    m.on('click', e => clicked.push(e.id));
    await m.update(result);
    return { sameInDark: JSON.stringify(association) === JSON.stringify(dark.boards[0].association), association };
  }, source);
  expect(found.sameInDark).toBe(true);

  await page.locator('#a [data-id="api:label:0"] [data-k=text]').first().click({ force: true });
  await page.locator('#a [data-id="(api -> db)[0]:path"] path').click({ force: true });
  const ids = await page.evaluate(() => clicked);
  expect(ids).toEqual(['api', '(api -> db)[0]']);

  const text = ({ start, end }) => source.slice(start.offset, end.offset);
  const [api, edge] = ids.map(id => found.association.objects.find(o => o.id === id));
  expect(api.references.map(text)).toContain('api');
  expect(text(api.properties.fill.source)).toContain('"#fff4cc"');
  expect(api.properties.fill.value).toBe('#fff4cc');
  expect(edge.kind).toBe('connection');
  expect(text(edge.references[0])).toBe('api -> db');
  expect([edge.src, edge.dst]).toEqual(['api', 'db']);

  const hit = await page.evaluate(({ association, at }) => d2web.objectsAt(association, at).map(o => o.id), { association: found.association, at: { path: 'main.d2', line: 3, column: 1 } });
  expect(hit[0]).toBe('api');
});
