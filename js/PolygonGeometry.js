// Geometria de polígonos das formas vetoriais: conversão forma -> anéis, operações booleanas
// (união/diferença/expansão) via Clipper.js e conversão anel <-> células da grade.
// Funções puras (sem estado do app). `ClipperLib` é global, carregado por <script> no index.html.
// Extraído de FluidSimulationApp.js — a numeração "bugs.md #N" nos comentários refere-se ao
// histórico em git (commit 7fd3bfe).

// Espessura padrão (em células) do traço de uma linha vetorial. A justificativa do valor está em
// FluidSimulationApp.DEFAULT_LINE_WIDTH, que reexporta esta constante.
export const DEFAULT_LINE_WIDTH = 1.75;

/**
 * @private
 * @description Extrai o(s) anel(is) (polígono fechado, coordenada ABSOLUTA de grade) que
 * representam a geometria VERDADEIRA de uma forma — usado como entrada de operação booleana
 * via Clipper (`_clipperBoolean`) tanto por `_floodFill` (união) quanto por
 * `_eraseRectangleOnGrid` (diferença/corte), ver bugs.md #45. Devolve uma LISTA de anéis (a
 * maioria das formas tem só 1; `'region'` pode ter mais de um se já tiver furos).
 */
export function shapeToPolygonRings(shape) {
    if (shape.tool === 'line') {
        // Retângulo fino ao redor do segmento (largura = lineWidth, perpendicular à linha).
        // Pontas quadradas (sem arredondar) — simplificação aceita: uma linha isolada
        // raramente aparece sozinha, normalmente forma um contorno fechado com outras linhas
        // no mesmo vértice, que cobrem a ponta.
        const dx = shape.x1 - shape.x0, dy = shape.y1 - shape.y0;
        const len = Math.hypot(dx, dy) || 1;
        const halfW = (shape.lineWidth ?? DEFAULT_LINE_WIDTH) / 2;
        const px = -dy / len * halfW, py = dx / len * halfW;
        return [[
            { x: shape.x0 + px, y: shape.y0 + py },
            { x: shape.x1 + px, y: shape.y1 + py },
            { x: shape.x1 - px, y: shape.y1 - py },
            { x: shape.x0 - px, y: shape.y0 - py }
        ]];
    }
    if (shape.tool === 'region') {
        // Já guarda os anéis, em offset relativo a x0/y0 — só converte pra absoluto.
        return (shape.rings || []).map(ring => ring.map(p => ({ x: shape.x0 + p.dx, y: shape.y0 + p.dy })));
    }
    if (shape.tool === 'ellipse_outline' || shape.tool === 'ellipse_filled') {
        // Mesma fórmula de cx/cy/rx/ry que _drawEllipseOnGrid já usa pra rasterizar. Sempre a
        // elipse CHEIA (não um anel oco) mesmo pro contorno vazio — fundir um contorno de
        // elipse com o preenchimento interno que ele cerca já resulta numa elipse sólida.
        const x_start = Math.min(shape.x0, shape.x1), x_end = Math.max(shape.x0, shape.x1);
        const y_start = Math.min(shape.y0, shape.y1), y_end = Math.max(shape.y0, shape.y1);
        const cx = (x_start + x_end) / 2, cy = (y_start + y_end) / 2;
        const rx = (x_end - x_start) / 2, ry = (y_end - y_start) / 2;
        if (rx <= 0 || ry <= 0) return [];
        const N = 48;
        const ring = [];
        for (let k = 0; k < N; k++) {
            const a = (k / N) * 2 * Math.PI;
            ring.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
        }
        return [ring];
    }
    if (shape.tool === 'rounded_rectangle') {
        // Mesmo raio/cantos/ranges de ângulo que _drawRoundedRectangleOnGrid já usa pra
        // rasterizar — reaproveitar a fórmula exata (não rederivar) garante que o anel
        // capturado bate com o que a física realmente viu. Um anel CONTÍNUO (ordenado ao
        // redor do perímetro), não pares de segmento soltos.
        const x0 = Math.min(shape.x0, shape.x1), y0 = Math.min(shape.y0, shape.y1);
        const x1 = Math.max(shape.x0, shape.x1), y1 = Math.max(shape.y0, shape.y1);
        const r = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) * 0.2));
        const corners = [
            { cx: x1 - r, cy: y0 + r, startA: 1.5 * Math.PI, endA: 2 * Math.PI },
            { cx: x1 - r, cy: y1 - r, startA: 0, endA: 0.5 * Math.PI },
            { cx: x0 + r, cy: y1 - r, startA: 0.5 * Math.PI, endA: Math.PI },
            { cx: x0 + r, cy: y0 + r, startA: Math.PI, endA: 1.5 * Math.PI }
        ];
        const ARC_SAMPLES = 12;
        const ring = [];
        for (const { cx, cy, startA, endA } of corners) {
            for (let k = 0; k <= ARC_SAMPLES; k++) {
                const a = startA + (endA - startA) * (k / ARC_SAMPLES);
                ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
            }
        }
        return [ring];
    }
    return [];
}

/**
 * @private
 * @description Escala usada pra converter coordenadas de grade (float) em inteiros pro
 * Clipper (que trabalha com inteiros pra garantir robustez numérica) — 1000 dá 3 casas
 * decimais de folga, de sobra pra uma grade de algumas centenas de células.
 */
export const CLIPPER_SCALE = 1000;

/**
 * @private
 * @description Normaliza toda aresta pra sentido anti-horário (área com sinal positiva,
 * fórmula do shoelace) e escala pra inteiro — formato que tanto `Clipper` (união/diferença)
 * quanto `ClipperOffset` (inflar) esperam. Sem essa normalização, anéis vindos de geradores
 * diferentes (`_traceCellsToRings`, sentido horário por herdar a convenção do traçador de
 * marching-squares do Renderer, vs. `_shapeToPolygonRings`, sentido anti-horário por amostrar
 * ângulo crescente) entram com sentidos opostos numa mesma operação — pro Clipper isso cancela
 * parcialmente a área via número de voltas (`pftNonZero`); pro ClipperOffset é pior, incha pro
 * lado ERRADO (pode "engolir" a área toda em vez de só crescer a borda um pouco).
 */
export function ringsToClipperPaths(rings) {
    const SCALE = CLIPPER_SCALE;
    const signedArea = (ring) => {
        let area = 0;
        for (let i = 0; i < ring.length; i++) {
            const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
            area += p1.x * p2.y - p2.x * p1.y;
        }
        return area / 2;
    };
    return rings
        .map(ring => {
            const normalized = signedArea(ring) < 0 ? [...ring].reverse() : ring;
            return normalized.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
        })
        .filter(p => p.length >= 3);
}

export function clipperBoolean(clipType, subjectRings, clipRings) {
    const SCALE = CLIPPER_SCALE;
    const subj = ringsToClipperPaths(subjectRings);
    const clip = ringsToClipperPaths(clipRings);
    if (subj.length === 0) return [];
    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    if (clip.length > 0) cpr.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    const tree = new ClipperLib.PolyTree();
    cpr.Execute(clipType, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

    const results = [];
    const collectDescendants = (node, rings) => {
        rings.push(node.m_polygon.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })));
        for (const child of node.Childs()) collectDescendants(child, rings);
    };
    for (const topNode of tree.Childs()) {
        const rings = [];
        collectDescendants(topNode, rings);
        results.push(rings);
    }
    return results;
}

/**
 * @private
 * @description Infla (expande) um conjunto de anéis por `delta` células, em ponto flutuante,
 * via `ClipperLib.ClipperOffset` — usado por `_floodFill` só como MARGEM DE SEGURANÇA numérica
 * antes de subtrair o polígono de uma forma absorvida do anel interior (ver bugs.md #42):
 * subtrair o polígono exato deixa a borda resultante encostada PIXEL A PIXEL na mesma aresta
 * que entra de novo na união logo em seguida — dois anéis com uma aresta em comum exata, vindos
 * de operações booleanas diferentes, deixam o Clipper cuspir frestas capilares de precisão
 * numérica ali (visível de perto, mesmo sem nenhum degrau de grade envolvido). Inflar uns 0,08
 * de célula ANTES de subtrair afasta essa borda pra dentro do polígono por uma margem bem menor
 * que qualquer pixel visível, então a semântica ("nunca deixar o interior reivindicar território
 * da forma") continua valendo, só sem mais compartilhar aresta EXATA com o polígono da união.
 */
export function clipperInflate(rings, delta) {
    const SCALE = CLIPPER_SCALE;
    const out = [];
    // Um `ClipperOffset.Execute()` por anel, não um só pra todos juntos: `FixOrientations()`
    // (interno do Clipper) decide se inverte TODOS os anéis de uma leva olhando só pro anel
    // de vértice mais baixo — pensado pra um grupo "contorno externo + furos" de UMA forma só.
    // Pra anéis de formas DIFERENTES que só se TOCAM sem relação de furo entre si (ex.: as 3
    // retas de um triângulo, cada ponta encostando na ponta da vizinha), essa lógica embaralha
    // o grupo inteiro — reproduzido tentando inflar as 3 retas do triângulo juntas: saíam só 2
    // anéis (não 3) com áreas erradas (uma bem maior, outra invertida/negativa), formando um
    // buraco gigante no meio do preenchimento em vez da margem mínima esperada. Cada anel na
    // sua própria chamada evita esse acoplamento — mais chamadas ao Clipper, mas são poucos
    // anéis (uma por forma absorvida num preenchimento) e delta é sempre pequeno (bugs.md #42).
    for (const ring of rings) {
        const paths = ringsToClipperPaths([ring]);
        if (paths.length === 0) continue;
        const co = new ClipperLib.ClipperOffset();
        co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        const solution = new ClipperLib.PolyTree();
        co.Execute(solution, delta * SCALE);
        const collect = (node) => {
            out.push(node.m_polygon.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })));
            for (const child of node.Childs()) collect(child);
        };
        for (const topNode of solution.Childs()) collect(topNode);
    }
    return out;
}

/**
 * @private
 * @description Rasteriza um conjunto de anéis (polígono, coordenada absoluta de grade) pra
 * uma lista de células `{x,y}` — scanline clássico: pra cada linha de célula, calcula as
 * interseções em X de TODOS os segmentos de TODOS os anéis com essa linha, ordena, preenche
 * os intervalos alternados (regra par-ímpar — trata furos automaticamente, sem precisar saber
 * qual anel é furo). Usado sempre que os `rings` de uma `region` são definidos/atualizados,
 * pra popular `cells` (mantido em cache pra não quebrar hit-test/arrastar/etc., que já esperam
 * uma lista de células — ver bugs.md #45).
 */
export function rasterizePolygonToCells(rings) {
    const edges = [];
    let minY = Infinity, maxY = -Infinity;
    for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
            const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
            if (p1.y === p2.y) continue; // aresta horizontal não cruza nenhuma scanline
            edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
            minY = Math.min(minY, p1.y, p2.y);
            maxY = Math.max(maxY, p1.y, p2.y);
        }
    }
    if (edges.length === 0) return [];
    const cells = [];
    const yStart = Math.floor(minY), yEnd = Math.ceil(maxY);
    for (let y = yStart; y <= yEnd; y++) {
        const scanY = y + 0.5; // testa no centro da célula
        const xs = [];
        for (const e of edges) {
            const yMin = Math.min(e.y1, e.y2), yMax = Math.max(e.y1, e.y2);
            if (scanY < yMin || scanY >= yMax) continue; // meio-aberto: evita contar vértice 2x
            const t = (scanY - e.y1) / (e.y2 - e.y1);
            xs.push(e.x1 + t * (e.x2 - e.x1));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) {
            const xFrom = Math.ceil(xs[i] - 0.5), xTo = Math.floor(xs[i + 1] - 0.5);
            for (let x = xFrom; x <= xTo; x++) cells.push({ x, y });
        }
    }
    return cells;
}

/**
 * @private
 * @description Traça o contorno de um conjunto de células (coordenada absoluta de grade) em
 * anel(is) fechado(s) — mesmo algoritmo de marching-squares/edge-walking que
 * `Renderer.drawSmoothLineShapes` já usa pro caso `'region'`, só que devolvendo coordenada de
 * GRADE (linhas de grade inteiras, cantos de célula) em vez de pixel de canvas. Usado por
 * `_floodFill` pra virar a área encontrada pelo BFS num anel-base, que depois é unido (via
 * Clipper) com o polígono de cada forma absorvida — sem essa fusão, o contorno ficaria preso
 * no degrau da própria rasterização da área preenchida (bugs.md #45).
 */
export function traceCellsToRings(cells) {
    const cellSet = new Set(cells.map(({ x, y }) => `${x},${y}`));
    const outEdges = new Map();
    const addEdge = (x1, y1, x2, y2) => {
        const k = `${x1},${y1}`;
        if (!outEdges.has(k)) outEdges.set(k, []);
        outEdges.get(k).push([x2, y2]);
    };
    for (const { x: cx, y: cy } of cells) {
        const L = cx, R = cx + 1, B = cy, T = cy + 1;
        if (!cellSet.has(`${cx},${cy + 1}`)) addEdge(L, T, R, T);
        if (!cellSet.has(`${cx + 1},${cy}`)) addEdge(R, T, R, B);
        if (!cellSet.has(`${cx},${cy - 1}`)) addEdge(R, B, L, B);
        if (!cellSet.has(`${cx - 1},${cy}`)) addEdge(L, B, L, T);
    }

    const usedEdges = new Set();
    const rings = [];
    for (const [startKey] of outEdges) {
        const startDests = outEdges.get(startKey);
        for (let ei = 0; ei < startDests.length; ei++) {
            const firstEdgeKey = `${startKey}→${startDests[ei][0]},${startDests[ei][1]}`;
            if (usedEdges.has(firstEdgeKey)) continue;

            const [sx, sy] = startKey.split(',').map(Number);
            const ring = [{ x: sx, y: sy }];
            let curVertKey = startKey;
            let curDest = startDests[ei];
            let guard = outEdges.size * 4 + 4;

            while (guard-- > 0) {
                const edgeKey = `${curVertKey}→${curDest[0]},${curDest[1]}`;
                if (usedEdges.has(edgeKey)) break;
                usedEdges.add(edgeKey);
                ring.push({ x: curDest[0], y: curDest[1] });

                const nextKey = `${curDest[0]},${curDest[1]}`;
                if (nextKey === startKey) break;
                const nextDests = outEdges.get(nextKey);
                if (!nextDests) break;
                const nextEdge = nextDests.find(e => !usedEdges.has(`${nextKey}→${e[0]},${e[1]}`));
                if (!nextEdge) break;
                curVertKey = nextKey;
                curDest = nextEdge;
            }
            if (ring.length >= 4) rings.push(ring);
        }
    }
    return rings;
}
