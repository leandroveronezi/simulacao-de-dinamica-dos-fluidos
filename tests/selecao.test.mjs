// Seleção e área de transferência: copiar, colar, recortar, espelhar e girar células pintadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp } from './helpers.mjs';

// Pinta um "L" assimétrico (barreira) de 3x3 com o canto em (x0, y0):
//   x . .      y0+2
//   x . .      y0+1
//   x x x      y0
const L = (x0, y0) => [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]].map(([dx, dy]) => [x0 + dx, y0 + dy]);
const chaves = (arr) => arr.map(([x, y]) => `${x},${y}`).sort();

async function preparar(page, celulas, area) {
    await page.evaluate(({ celulas, area }) => {
        const a = window.__app;
        for (const [x, y] of celulas) a._paintRawCell(x, y, 1);
        a._rasterizeShapes();
        a.selectionArea = { start: { x: area[0], y: area[1] }, end: { x: area[2], y: area[3] } };
    }, { celulas, area });
}
const solidas = (page) => page.evaluate(() => {
    const a = window.__app, s = a.solver, out = [];
    for (let y = 0; y < s.ydim; y++) for (let x = 0; x < s.xdim; x++) if (s.cellType[x + y * s.xdim] === 1) out.push([x, y]);
    return out;
});

test('espelhar na horizontal inverte o L dentro da área', async () => {
    const { page, erros, fechar } = await abrirApp();
    try {
        await preparar(page, L(40, 40), [40, 40, 42, 42]);
        await page.evaluate(() => window.__app._flipSelectionHorizontal());
        // O braço vertical passa da coluna x=40 para x=42.
        assert.deepEqual(chaves(await solidas(page)), chaves([[40, 40], [41, 40], [42, 40], [42, 41], [42, 42]]));
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});

test('espelhar na vertical inverte o L dentro da área', async () => {
    const { page, fechar } = await abrirApp();
    try {
        await preparar(page, L(40, 40), [40, 40, 42, 42]);
        await page.evaluate(() => window.__app._flipSelectionVertical());
        assert.deepEqual(chaves(await solidas(page)), chaves([[40, 42], [41, 42], [42, 42], [40, 41], [40, 40]]));
    } finally { await fechar(); }
});

test('girar 180° e depois 180° volta ao original; 90° x4 também', async () => {
    const { page, fechar } = await abrirApp();
    try {
        const original = chaves(L(40, 40));
        await preparar(page, L(40, 40), [40, 40, 42, 42]);
        for (const graus of [180, 180]) {
            await page.evaluate((g) => { const a = window.__app; a.selectionArea = { start: { x: 40, y: 40 }, end: { x: 42, y: 42 } }; a._rotateSelection(g); }, graus);
        }
        assert.deepEqual(chaves(await solidas(page)), original);
        for (let i = 0; i < 4; i++) {
            await page.evaluate(() => { const a = window.__app; a.selectionArea = { start: { x: 40, y: 40 }, end: { x: 42, y: 42 } }; a._rotateSelection(90); });
        }
        assert.deepEqual(chaves(await solidas(page)), original);
    } finally { await fechar(); }
});

test('girar 90° move o braço horizontal para vertical', async () => {
    const { page, fechar } = await abrirApp();
    try {
        await preparar(page, [[40, 41], [41, 41], [42, 41]], [40, 40, 42, 42]);
        await page.evaluate(() => window.__app._rotateSelection(90));
        assert.deepEqual(chaves(await solidas(page)), chaves([[41, 40], [41, 41], [41, 42]]));
    } finally { await fechar(); }
});

test('copiar e colar duplica as células no destino; recortar remove a origem', async () => {
    const { page, fechar } = await abrirApp();
    try {
        await preparar(page, L(40, 40), [40, 40, 42, 42]);
        await page.evaluate(() => { const a = window.__app; a._copySelection(); a._pasteSelection({ x: 100, y: 80 }); });
        assert.deepEqual(chaves(await solidas(page)), chaves([...L(40, 40), ...L(100, 80)]));
        await page.evaluate(() => { const a = window.__app; a.selectionArea = { start: { x: 40, y: 40 }, end: { x: 42, y: 42 } }; a._cutSelection(); });
        assert.deepEqual(chaves(await solidas(page)), chaves(L(100, 80)));
        // Recortar é desfazível: Ctrl+Z traz a origem de volta.
        await page.evaluate(() => window.__app.undo());
        assert.deepEqual(chaves(await solidas(page)), chaves([...L(40, 40), ...L(100, 80)]));
        await page.evaluate(() => { const a = window.__app; a.selectionArea = { start: { x: 40, y: 40 }, end: { x: 42, y: 42 } }; a._cutSelection(); });
        // O recorte também enche a área de transferência: dá para colar de novo.
        await page.evaluate(() => window.__app._pasteSelection({ x: 10, y: 10 }));
        assert.deepEqual(chaves(await solidas(page)), chaves([...L(100, 80), ...L(10, 10)]));
    } finally { await fechar(); }
});
