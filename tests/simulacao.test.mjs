// Simulação rodando no navegador com uma cena completa: todas as visualizações, opções de
// exibição, modos de contorno e fluidos reais, sem erro de console e sem instabilidade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp, gestos } from './helpers.mjs';

async function cenaCompleta(page, g) {
    await g.linha('barrier', [40, 50], [70, 70]);
    await g.linha('source', [15, 40], [15, 70]);
    await g.linha('sink', [190, 40], [190, 70]);
    await g.linha('mesh', [100, 40], [100, 70]);
    await g.linha('rotor', [130, 50], [130, 66]);
    await g.linha('valve', [150, 90], [150, 105]);
    await g.ferramenta('smoke'); await g.click([30, 55]);
    await g.ferramenta('particles'); await g.click([60, 80]); await g.click([80, 90]);
}

test('todas as visualizações e opções de exibição rodam sem erro, em Canal e em Mundo Aberto', async () => {
    const { page, erros, fechar } = await abrirApp(); const g = gestos(page);
    try {
        await cenaCompleta(page, g);
        await page.check('#tracerCheck'); await page.check('#forceCheck'); await page.check('#arrowsCheck'); await page.check('#sensorCheck');
        for (const modo of ['channel', 'open']) {
            await page.selectOption('#boundaryModeSelect', modo);
            const nVis = await page.evaluate(() => document.getElementById('plotSelect').options.length);
            assert.ok(nVis >= 5, `visualizações: ${nVis}`);
            for (let i = 0; i < nVis; i++) {
                await page.selectOption('#plotSelect', { index: i });
                await page.click('#startButton'); await page.waitForTimeout(250); await page.click('#startButton');
                await page.click('#stepButton');
            }
            await page.fill('#contrastSlider', '6'); await page.fill('#contrastSlider', '-6');
        }
        assert.ok(await page.evaluate(() => window.__app.solver.checkStability()), 'simulação instável');
        assert.deepEqual(erros, [], 'erros no console');
    } finally { await fechar(); }
});

test('cada fluido real, calibrado para 0,1 m/s, mantém a simulação estável', async () => {
    const { page, erros, fechar } = await abrirApp(); const g = gestos(page);
    try {
        await cenaCompleta(page, g);
        const fluidos = await page.evaluate(() => [...document.querySelectorAll('#fluidSelect option')].map(o => o.value));
        assert.equal(fluidos.length, 5);
        for (const f of fluidos) {
            await page.selectOption('#fluidSelect', f);
            await page.fill('#targetSpeedInput', '0.1');
            await page.click('#calibrateButton');
            await page.evaluate(() => Swal.close()); // aviso de "calibração no limite", se houver
            await page.click('#startButton'); await page.waitForTimeout(300); await page.click('#startButton');
            assert.ok(await page.evaluate(() => window.__app.solver.checkStability()), `instável com ${f}`);
        }
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});

test('velocidade e viscosidade nos extremos dos sliders não derrubam o app', async () => {
    const { page, erros, fechar } = await abrirApp(); const g = gestos(page);
    try {
        await cenaCompleta(page, g);
        const avisos = [];
        for (const [vel, visc] of [['0.1', '0.005'], ['0', '0.2'], ['0.1', '0.2'], ['0.05', '0.005']]) {
            await page.fill('#speedSlider', vel); await page.fill('#viscSlider', visc);
            await page.click('#resetFluidButton');
            await page.click('.swal2-confirm');
            await page.waitForSelector('.swal2-popup', { state: 'detached' });
            await page.click('#startButton'); await page.waitForTimeout(1500);
            // Se o app detecta instabilidade, ele pausa e abre um diálogo: comportamento válido.
            // Fecha o diálogo ANTES de mexer em qualquer outra coisa (ele cobre a página).
            if (await page.$('.swal2-popup')) {
                avisos.push(`${vel}/${visc}`);
                await page.click('.swal2-cancel');
                await page.waitForSelector('.swal2-popup', { state: 'detached' });
            }
            if (await page.evaluate(() => window.__app.running)) await page.click('#startButton');
            const nan = await page.evaluate(() => { const s = window.__app.solver; return Array.from(s.rho).some(v => !Number.isFinite(v)); });
            assert.equal(nan, false, `NaN com velocidade ${vel} e viscosidade ${visc}`);
        }
        console.log('combinações que dispararam o aviso de instabilidade (velocidade/viscosidade):', avisos.join(', ') || 'nenhuma');
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});
