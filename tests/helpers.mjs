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
