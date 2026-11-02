// Teste de interface (navegador real) — serve de rede de segurança para refatorar o
// FluidSimulationApp.js. Roda um roteiro de desenho e compara o estado resultante com um
// instantâneo. Regravar o instantâneo (só quando a mudança de comportamento for intencional):
//   UPDATE_SNAPSHOT=1 npm run test:ui
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { ROOT, serve } from './helpers.mjs';

const SNAP = path.join(ROOT, 'tests/snapshots/ui-config.json');

test('roteiro de desenho: sem erros no console e estado igual ao instantâneo', async () => {
    const server = await serve();
    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const erros = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        page.on('pageerror', e => erros.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) erros.push('console: ' + m.text()); });
        // 404 só é tolerado para o favicon (o app não tem um); qualquer outro recurso faltando é erro.
        page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) erros.push(`HTTP ${r.status()}: ${r.url()}`); });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
        await page.evaluate(() => { localStorage.clear(); });
        await page.waitForFunction(() => window.__app);

        // Ponto da grade -> coordenadas de página. Atenção: com Entrada e Saída na cena, um widget de
        // controle ocupa o canto inferior do canvas; não comece arrastos perto de y = 0.
        const pt = (gx, gy) => page.evaluate(([x, y]) => {
            const a = window.__app, c = a.gridToCanvas(x, y), r = a.canvas.getBoundingClientRect();
            return { x: r.left + c.x * r.width / a.canvas.width, y: r.top + c.y * r.height / a.canvas.height };
        }, [gx, gy]);
        const drag = async (a, b) => {
            const p = await pt(...a), q = await pt(...b);
            await page.mouse.move(p.x, p.y); await page.mouse.down();
            await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 3 });
            await page.mouse.move(q.x, q.y, { steps: 3 }); await page.mouse.up();
        };
        const click = async (a) => { const p = await pt(...a); await page.mouse.click(p.x, p.y); };
        const tool = (n) => page.click(`.tool-button[data-tool="${n}"]`);
        const type = (n) => page.click(`.paint-type-button[data-paint-type="${n}"]`);

        const linha = async (tipo, a, b) => { await tool('line'); await type(tipo); await drag(a, b); };
        await linha('barrier', [30, 20], [50, 35]);
        await linha('source', [10, 10], [10, 25]);
        await linha('sink', [190, 10], [190, 25]);
        await linha('mesh', [70, 30], [70, 60]);
        await linha('rotor', [110, 20], [110, 34]);
        await linha('valve', [140, 100], [160, 100]);
        await type('barrier');
        await tool('rectangle_outline'); await drag([30, 60], [55, 80]);
        await tool('fill'); await click([40, 70]);
        await tool('ellipse_filled'); await drag([80, 60], [100, 75]);
        await tool('eraser'); await drag([82, 65], [90, 70]);
        await tool('smoke'); await click([20, 18]);
        await tool('particles'); await click([45, 30]);
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+y');

        // Seleciona a barreira diagonal com o Ponteiro e altera a espessura pelo painel.
        await tool('pointer'); await click([40, 27]);
        await page.waitForTimeout(100);

        // O instantâneo é tirado ANTES de rodar a simulação: depois dela o estado depende do
        // relógio (quantos passos coube em 800 ms; ângulo do Rotor), então não é reprodutível.
        const estado = await page.evaluate(() => {
            const a = window.__app, cfg = a._buildConfigObject();
            delete cfg.zoom; delete cfg.panX; delete cfg.panY;
            return {
                cfg,
                tipos: Array.from(a.solver.cellType).reduce((m, t) => (m[t] = (m[t] || 0) + 1, m), {}),
                nShapes: a.shapes.length
            };
        });

        // Roda a simulação por um tempo: só exige que continue estável e sem erros.
        await page.click('#startButton'); await page.waitForTimeout(800); await page.click('#startButton');
        estado.estavel = await page.evaluate(() => window.__app.solver.checkStability());
        assert.deepEqual(erros, [], 'erros no console/página');
        assert.ok(estado.estavel, 'simulação instável após o roteiro');
        assert.ok(estado.nShapes >= 8, `poucas formas: ${estado.cfg.shapes.map(s => s.tool + ':' + s.cellType).join(', ')}`);

        const resumo = {
            hash: crypto.createHash('sha256').update(JSON.stringify(estado.cfg)).digest('hex'),
            nShapes: estado.nShapes,
            tipos: estado.tipos,
            shapeTypes: estado.cfg.shapes.map(s => s.tool + ':' + s.cellType)
        };
        if (process.env.UPDATE_SNAPSHOT || !fs.existsSync(SNAP)) {
            fs.writeFileSync(SNAP, JSON.stringify(resumo, null, 2) + '\n');
            console.log('instantâneo gravado em', SNAP);
        } else {
            assert.deepEqual(resumo, JSON.parse(fs.readFileSync(SNAP, 'utf8')));
        }
    } finally {
        await browser.close();
        server.close();
    }
});
