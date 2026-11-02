// Utilidades dos testes de interface: servidor estático local e Chrome real via playwright-core.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export function serve() {
    const server = http.createServer((req, res) => {
        const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// Abre o app numa página nova, registrando erros de console/página/HTTP (favicon é tolerado).
export async function abrirApp({ limparStorage = true } = {}) {
    const server = await serve();
    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const erros = [];
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => erros.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) erros.push('console: ' + m.text()); });
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) erros.push(`HTTP ${r.status()}: ${r.url()}`); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url, { waitUntil: 'networkidle' });
    if (limparStorage) await page.evaluate(() => localStorage.clear());
    await page.waitForFunction(() => window.__app);
    const fechar = async () => { await browser.close(); server.close(); };
    return { page, erros, url, fechar };
}

// Espera o layout do canvas estabilizar (ele é redimensionado de forma assíncrona quando o
// painel de controle aparece/some). Sem isso, coordenadas de tela calculadas antes de um arraste
// podem apontar para outra célula no momento do evento, e o resultado depende de timing/carga.
export async function aguardarLayoutEstavel(page, quadrosEstaveis = 6) {
    await page.evaluate(async (n) => {
        const medir = () => { const r = window.__app.canvas.getBoundingClientRect(); return `${r.left}|${r.top}|${r.width}|${r.height}|${window.__app.canvas.width}|${window.__app.canvas.height}`; };
        let anterior = medir(), iguais = 0;
        while (iguais < n) {
            await new Promise(r => requestAnimationFrame(r));
            const atual = medir();
            iguais = atual === anterior ? iguais + 1 : 0;
            anterior = atual;
        }
    }, quadrosEstaveis);
}

// Gestos de alto nível sobre o canvas, em coordenadas de GRADE. Cada gesto espera o layout
// estabilizar e converte para coordenadas de tela no momento de usar.
export function gestos(page) {
    // Mira no CENTRO da célula: o canto exato cai na célula vizinha por arredondamento.
    const pt = (gx, gy) => page.evaluate(([x, y]) => {
        const a = window.__app, c = a.gridToCanvas(x, y), r = a.canvas.getBoundingClientRect();
        const meio = a.pxPerSquare * a.zoom / 2;
        return { x: r.left + (c.x + meio) * r.width / a.canvas.width, y: r.top + (c.y + meio) * r.height / a.canvas.height };
    }, [gx, gy]);
    const drag = async (a, b) => {
        await aguardarLayoutEstavel(page);
        const p = await pt(...a);
        await page.mouse.move(p.x, p.y); await page.mouse.down();
        const m = await pt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        await page.mouse.move(m.x, m.y, { steps: 3 });
        const q = await pt(...b);
        await page.mouse.move(q.x, q.y, { steps: 3 }); await page.mouse.up();
    };
    const click = async (a) => { await aguardarLayoutEstavel(page); const p = await pt(...a); await page.mouse.click(p.x, p.y); };
    const ferramenta = (n) => page.click(`.tool-button[data-tool="${n}"]`);
    const tipo = (n) => page.click(`.paint-type-button[data-paint-type="${n}"]`);
    const linha = async (t, a, b) => { await ferramenta('line'); await tipo(t); await drag(a, b); };
    const formas = () => page.evaluate(() => window.__app.shapes.map(s => ({ ...s })));
    return { pt, drag, click, ferramenta, tipo, linha, formas };
}
