// Espessura das linhas: padrão para as próximas e "aplicar a todas" (bugs.md #7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp, gestos } from './helpers.mjs';

async function comApp(fn) {
    const app = await abrirApp();
    try {
        await fn({ ...app, g: gestos(app.page) });
        assert.deepEqual(app.erros, [], 'erros no console');
    } finally { await app.fechar(); }
}
const definir = async (page, v) => { await page.fill('#defaultLineWidthInput', String(v)); await page.press('#defaultLineWidthInput', 'Tab'); };

test('as próximas linhas herdam a espessura do campo; com o padrão, a forma não guarda lineWidth', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 40], [60, 40]);
    await definir(page, 3);
    await g.linha('barrier', [30, 60], [60, 60]);
    const f = await g.formas();
    assert.equal(f[0].lineWidth, undefined, 'linha com o padrão não deve gravar lineWidth');
    assert.equal(f[1].lineWidth, 3);
}));

test('o campo limita a espessura entre 1 e 4 e devolve o valor limpo', () => comApp(async ({ page }) => {
    await definir(page, 99);
    assert.equal(await page.inputValue('#defaultLineWidthInput'), '4');
    await definir(page, 0.1);
    assert.equal(await page.inputValue('#defaultLineWidthInput'), '1');
}));

test('Aplicar a todas muda só as linhas, em um passo desfazível', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 40], [60, 40]);
    await g.linha('source', [30, 60], [60, 60]);
    await g.ferramenta('rectangle_outline'); await g.drag([80, 40], [110, 70]);
    const n = (await g.formas()).length;
    await definir(page, 2.5);
    await page.click('#applyLineWidthToAllButton');
    let f = await g.formas();
    assert.equal(f.length, n);
    for (const s of f) {
        if (s.tool === 'line') assert.equal(s.lineWidth, 2.5, `linha ${s.id}`);
        else assert.equal(s.lineWidth, undefined, `forma ${s.tool} não deveria mudar`);
    }
    assert.ok(f.filter(s => s.tool === 'line').length === 2);
    await page.keyboard.press('Control+z');
    f = await g.formas();
    assert.ok(f.every(s => s.lineWidth === undefined), 'desfazer deve restaurar todas');
}));

test('Aplicar a todas sem nenhuma linha avisa em vez de falhar em silêncio', () => comApp(async ({ page, g }) => {
    await page.click('#applyLineWidthToAllButton');
    await page.waitForSelector('.swal2-popup');
    assert.match(await page.textContent('.swal2-popup'), /Nenhuma linha/);
    assert.equal((await g.formas()).length, 0);
}));

test('uma linha selecionada ainda tem a própria espessura no painel flutuante', () => comApp(async ({ page, g }) => {
    await definir(page, 3);
    await g.linha('barrier', [30, 60], [60, 60]);
    await g.ferramenta('pointer'); await g.click([45, 60]);
    await page.waitForFunction(() => !document.getElementById('floatingPropertyPanel').hidden);
    assert.equal(Number(await page.inputValue('#floatingPanelLineWidthInput')), 3);
}));
