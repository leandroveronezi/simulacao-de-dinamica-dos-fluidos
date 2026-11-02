// Estresse da interface: sequências pseudo-aleatórias (semente fixa, reproduzíveis) de ações de
// usuário. Falha se aparecer erro de script/console/HTTP ou NaN no campo de escoamento. O aviso
// "Simulação Instável!" e a confirmação de reset NÃO são erros: são diálogos normais do app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp, gestos } from './helpers.mjs';

async function estresse(semente, nAcoes) {
    let seed = semente;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const { page, erros, fechar } = await abrirApp(); const g = gestos(page);
    page.setDefaultTimeout(8000);
    const log = [];
    const ferramentas = ['brush', 'line', 'rectangle_filled', 'ellipse_filled', 'rectangle_outline', 'ellipse_outline', 'rounded_rectangle', 'fill', 'eraser', 'eraser_line', 'smoke', 'particles', 'select', 'pointer', 'pan'];
    const tipos = ['barrier', 'source', 'sink', 'rotor', 'valve', 'mesh'];
    const rg = () => [Math.floor(15 + rnd() * 180), Math.floor(20 + rnd() * 105)];
    const acoes = [
        async () => { const t = pick(ferramentas); log.push('ferramenta ' + t); await g.ferramenta(t); },
        async () => { const t = pick(tipos); log.push('tipo ' + t); await g.tipo(t); },
        async () => { const a = rg(), b = rg(); log.push(`arrasto ${a}->${b}`); await g.drag(a, b); },
        async () => { const a = rg(); log.push(`clique ${a}`); await g.click(a); },
        async () => { log.push('desfazer'); await page.keyboard.press('Control+z'); },
        async () => { log.push('refazer'); await page.keyboard.press('Control+y'); },
        async () => { log.push('delete'); await page.keyboard.press('Delete'); },
        async () => { log.push('esc'); await page.keyboard.press('Escape'); },
        async () => { log.push('rodar/pausar'); await page.click('#startButton'); await page.waitForTimeout(150); await page.click('#startButton'); },
        async () => { log.push('passo'); await page.click('#stepButton'); },
        async () => { log.push('visualização'); await page.selectOption('#plotSelect', { index: Math.floor(rnd() * 5) }); },
        async () => { log.push('modo'); await page.selectOption('#boundaryModeSelect', pick(['channel', 'open'])); },
        async () => { log.push('roda'); await page.mouse.wheel(0, pick([-200, 200])); },
        async () => { log.push('espessura'); await page.fill('#defaultLineWidthInput', pick(['1', '2.5', '4', '99'])); await page.press('#defaultLineWidthInput', 'Tab'); },
        async () => { const w = String(40 + Math.floor(rnd() * 220)), h = String(40 + Math.floor(rnd() * 120)); log.push(`grade ${w}x${h}`); await page.fill('#gridWidthInput', w); await page.fill('#gridHeightInput', h); await page.click('#applyGridSizeButton'); },
        async () => { log.push('exportar/importar'); await page.evaluate(() => { const a = window.__app; a._applyConfiguration(JSON.parse(JSON.stringify(a._buildConfigObject())), { silent: true }); }); },
        async () => { log.push('projeto'); await page.evaluate(() => { const a = window.__app; const p = { id: 'f' + Math.random(), name: 'fuzz', savedAt: Date.now(), config: a._buildConfigObject() }; a._persistProjects([p]); a._loadProject(p.id); }); },
        async () => { log.push('válvulas'); await page.evaluate(() => { for (const el of document.querySelectorAll('#controlPanelBar .control-unit-switch')) { el.checked = !el.checked; el.dispatchEvent(new Event('change')); } }); },
        async () => { const w = 900 + Math.floor(rnd() * 700), h = 600 + Math.floor(rnd() * 400); log.push(`janela ${w}x${h}`); await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(200); },
        async () => { log.push('reiniciar fluido'); await page.click('#resetFluidButton'); },
    ];
    let nan = false;
    try {
        for (let n = 0; n < nAcoes; n++) {
            await pick(acoes)();
            if (await page.$('.swal2-popup')) { log.push('diálogo'); await page.click('.swal2-confirm').catch(() => {}); await page.waitForSelector('.swal2-popup', { state: 'detached', timeout: 3000 }).catch(() => {}); }
            if (erros.length) break;
        }
        nan = await page.evaluate(() => Array.from(window.__app.solver.rho).some(v => !Number.isFinite(v)));
    } catch (e) { erros.push('exceção do teste: ' + e.message.split('\n')[0]); }
    await fechar();
    return { erros, nan, ultimas: log.slice(-8) };
}

for (const semente of [11, 21]) {
    test(`estresse da interface (semente ${semente}): sem erros e sem NaN`, async () => {
        const r = await estresse(semente, 70);
        assert.deepEqual(r.erros, [], 'erros; últimas ações: ' + r.ultimas.join(' | '));
        assert.equal(r.nan, false, 'NaN no campo de escoamento; últimas ações: ' + r.ultimas.join(' | '));
    });
}
