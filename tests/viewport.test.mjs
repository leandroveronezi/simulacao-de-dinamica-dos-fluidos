// Zoom, pan e conversões de coordenadas (página <-> canvas <-> grade).
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp } from './helpers.mjs';

test('gridToCanvas e canvasToGrid são inversas em qualquer zoom/pan', async () => {
    const { page, erros, fechar } = await abrirApp();
    try {
        const falhas = await page.evaluate(() => {
            const a = window.__app, out = [];
            for (const [zoom, panX, panY] of [[1, 0, 0], [2.5, -120, 40], [8, -900, -300], [0.7, 30, 10]]) {
                a.zoom = zoom; a.panX = panX; a.panY = panY;
                for (const [x, y] of [[0, 0], [10, 20], [100, 70], [a.solver.xdim - 1, a.solver.ydim - 1]]) {
                    const c = a.gridToCanvas(x, y);
                    // centro da célula, para não cair na fronteira entre duas
                    const g = a.canvasToGrid(c.x + a.pxPerSquare * zoom / 2, c.y + a.pxPerSquare * zoom / 2);
                    if (g.x !== x || g.y !== y) out.push({ zoom, x, y, g });
                }
            }
            return out;
        });
        assert.deepEqual(falhas, []);
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});

test('zoom pela roda mantém ancorado o ponto sob o cursor', async () => {
    const { page, fechar } = await abrirApp();
    try {
        const box = await page.evaluate(() => { const r = window.__app.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        const mx = box.x + box.w * 0.6, my = box.y + box.h * 0.4;
        const sob = () => page.evaluate(([px, py]) => { const a = window.__app, c = a.pageToCanvas(px, py); return a.canvasToGrid(c.x, c.y); }, [mx, my]);
        const antes = await sob();
        await page.mouse.move(mx, my);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(100);
        const zoom = await page.evaluate(() => window.__app.zoom);
        assert.ok(zoom > 1, `zoom = ${zoom}`);
        const depois = await sob();
        assert.ok(Math.abs(depois.x - antes.x) <= 1 && Math.abs(depois.y - antes.y) <= 1, `${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`);
    } finally { await fechar(); }
});

test('zoom respeita os limites e o botão de reset volta a 1x', async () => {
    const { page, fechar } = await abrirApp();
    try {
        const r = await page.evaluate(() => {
            const a = window.__app;
            for (let i = 0; i < 60; i++) a._zoomBy(1.5);
            const max = a.zoom;
            for (let i = 0; i < 60; i++) a._zoomBy(1 / 1.5);
            return { max, min: a.zoom, MAX: a.constructor.MAX_ZOOM, MIN: a.constructor.MIN_ZOOM };
        });
        assert.equal(r.max, r.MAX);
        assert.equal(r.min, r.MIN);
        await page.evaluate(() => window.__app._zoomBy(2));
        await page.click('#resetZoomButton');
        assert.equal(await page.evaluate(() => window.__app.zoom), 1);
    } finally { await fechar(); }
});
