// Rasterização do FluidSimulationApp: desenho de formas na grade, preenchimento (flood-fill),
// reconstrução de regiões, borracha e corte. Extraído de FluidSimulationApp.js; os métodos são
// anexados ao protótipo do app por applyMixin, então `this` é a instância do app.

import { FluidSolver } from '../FluidSolver.js?v=20261102b';
import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102b';
import { shapeToPolygonRings, clipperBoolean, clipperInflate, rasterizePolygonToCells, traceCellsToRings } from '../PolygonGeometry.js?v=20261102b';

export class Rasterization {
    /**
     * @private
     * @description Monta uma forma `region` a partir de um conjunto de anéis já resultante de uma
     * operação booleana (coordenada absoluta) — deriva `cells` via `_rasterizePolygonToCells`,
     * calcula o retângulo envolvente e converte tudo pra offset relativo (dx/dy). Não define
     * `vx/vy`/`enabled` nem mexe em `sourceGroups` — isso varia entre quem chama (região nasce
     * vs. sobrevive a um corte) e fica por conta de quem chama.
     */
    _buildRegionFromRings(cellType, rings) {
        const cells = rasterizePolygonToCells(rings);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const { x, y } of cells) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return {
            id: this._nextShapeId++,
            cellType,
            tool: 'region',
            x0: minX, y0: minY, x1: maxX, y1: maxY,
            cells: cells.map(c => ({ dx: c.x - minX, dy: c.y - minY })),
            rings: rings.map(ring => ring.map(p => ({ dx: p.x - minX, dy: p.y - minY })))
        };
    }

    /**
     * @private
     * @description Preenchimento por inundação. Se a área preenchida for FECHADA (nunca toca a
     * borda da grade — sempre contida por algo que não é NORMAL), o contorno que a cerca é
     * absorvido: qualquer forma vetorial tocando essa borda é removida de `shapes[]` e fundida
     * com as células preenchidas num único objeto do tipo 'region' — contorno e preenchimento
     * passam a mover/apagar juntos. Se a área tocar a borda da grade (fundo aberto, sem "parede"
     * em algum lado), fica só pintura livre, igual sempre foi — preencher a área externa toda
     * não deveria virar uma "forma" gigante arrastável.
     */
    _floodFill(startX, startY) {
        const xdim = this.solver.xdim,
            ydim = this.solver.ydim;
        if (startX < 0 || startX >= xdim || startY < 0 || startY >= ydim) return;
        const initialType = this.solver.cellType[startX + startY * xdim];
        if (initialType !== FluidSolver.CELL_TYPE.NORMAL) return;
        const queue = [{ x: startX, y: startY }];
        const visited = new Set();
        visited.add(`${startX},${startY}`);
        const interiorCells = [];
        const boundaryKeys = new Set();
        let touchedEdge = false;
        let iterations = 0;
        const MAX_ITERATIONS = 10000; // Limite de segurança mais conservador
        const neighbors = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        while (queue.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;
            const { x, y } = queue.shift();
            interiorCells.push({ x, y });
            if (x === 0 || x === xdim - 1 || y === 0 || y === ydim - 1) touchedEdge = true;
            for (const neighbor of neighbors) {
                const nextX = x + neighbor.dx;
                const nextY = y + neighbor.dy;
                if (nextX < 0 || nextX >= xdim || nextY < 0 || nextY >= ydim) {
                    touchedEdge = true;
                    continue;
                }
                const key = `${nextX},${nextY}`;
                if (visited.has(key)) continue;
                if (this.solver.cellType[nextX + nextY * xdim] === initialType) {
                    visited.add(key);
                    queue.push({ x: nextX, y: nextY });
                } else {
                    boundaryKeys.add(key);
                }
            }
        }

        const unbounded = touchedEdge || iterations >= MAX_ITERATIONS;
        if (unbounded) {
            for (const { x, y } of interiorCells) this._paintRawCell(x, y, this._activeCellType());
            this._rasterizeShapes();
            if (iterations >= MAX_ITERATIONS) {
                console.warn('Flood fill interrompido: área muito grande ou complexa');
                Swal.fire({
                    icon: 'warning',
                    title: 'Área Muito Grande',
                    text: 'O preenchimento foi interrompido para evitar o travamento do navegador.',
                    timer: 2500,
                    showConfirmButton: false
                });
            }
            return;
        }

        // Área fechada: absorve qualquer forma vetorial que toca a borda encontrada.
        const activeCellType = this._activeCellType();
        const absorbed = [];
        const survivors = [];
        for (const shape of this.shapes) {
            if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
                survivors.push(shape);
                continue;
            }
            let touches = false;
            this._replayShapeGeometry(shape, (x, y) => {
                if (boundaryKeys.has(`${x},${y}`)) touches = true;
            });
            (touches ? absorbed : survivors).push(shape);
        }
        this.shapes = survivors;

        // União via Clipper: o anel traçado da área encontrada pelo BFS + o polígono VERDADEIRO
        // de cada forma absorvida (não só suas células rasterizadas) — dá um contorno
        // geometricamente exato, sem depender de guardar segmentos soltos por fora (bugs.md #45).
        const mergedCells = new Map();
        for (const { x, y } of interiorCells) mergedCells.set(`${x},${y}`, { x, y });
        const absorbedRings = [];
        const lineRingsForTrim = [];
        for (const shape of absorbed) {
            const shapeRings = shapeToPolygonRings(shape);
            absorbedRings.push(...shapeRings);
            if (shape.tool === 'line') {
                // 'line' entra no anel-base só via polígono, nunca via célula bruta — ver o motivo
                // logo abaixo (`lineRingsForTrim`/bugs.md #42).
                lineRingsForTrim.push(...shapeRings);
            } else {
                // Toda forma NÃO-'line' (region/elipse/retângulo arredondado) continua entrando no
                // anel-base pela própria rasterização (`_replayShapeGeometry`), igual sempre foi:
                // pra essas, `_shapeToPolygonRings` devolve o disco/área SÓLIDA da forma inteira
                // (não só uma casca fina — ver comentário de 'ellipse_outline' ali), do mesmo
                // tamanho do interior que o BFS já encontrou por dentro dela. Subtrair esse
                // polígono do interior (como se faz abaixo só pra 'line') apagaria a área quase
                // inteira em vez de só uma borda fina — reproduzido isolado: preencher uma elipse
                // vazia sumia com o preenchimento inteiro.
                this._replayShapeGeometry(shape, (x, y) => mergedCells.set(`${x},${y}`, { x, y }));
            }
            if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
                const groupIdx = this._findSourceGroupNear(centroid);
                if (groupIdx >= 0) this.solver.sourceGroups.splice(groupIdx, 1);
            }
        }
        // Anel-base: as células interiores + as de forma NÃO-'line' absorvida (`mergedCells`,
        // igual sempre foi), com a área de cada forma 'line' absorvida SUBTRAÍDA (ctDifference)
        // antes de entrar na união final. `_replayShapeGeometry`/`_drawLineOnGrid` rasteriza uma
        // linha com só 1 célula de largura (Bresenham, ignora `lineWidth` de propósito — é usado
        // pra física/cellType, não pra geometria visual), então incluir essa célula bruta no
        // traçado do anel-base deixa passar até ~1 célula do lado de fora da linha matemática
        // verdadeira, nos trechos onde o degrau do Bresenham "morde" mais fundo o interior do que
        // o meio-fio do polígono espesso (`lineWidth`) alcança cobrir — e esse degrau vaza no
        // contorno final da união (bugs.md #42 — voltou depois do Clipper.js do #45, que nunca
        // tinha mexido nessa mistura célula-bruta + polígono pra 'line', só na geometria booleana
        // em si). Subtrair o polígono exato de cada 'line' absorvida do anel interior ANTES da
        // união garante que o interior nunca reivindica território que já pertence à linha — o
        // contorno final ali fica 100% definido pelo polígono liso. `_clipperInflate(…, 0.08)`
        // antes de subtrair é só uma margem de segurança numérica: subtrair o polígono EXATO
        // deixa a borda resultante encostada pixel a pixel na mesma aresta que entra de novo na
        // união logo abaixo, e dois anéis com aresta em comum EXATA, vindos de operações
        // diferentes, fazem o Clipper cuspir frestas capilares de precisão ali — afastar por essa
        // margem mínima evita isso sem ficar visível em nenhum zoom razoável.
        const baseRingsRaw = traceCellsToRings(Array.from(mergedCells.values()));
        const baseRings = lineRingsForTrim.length > 0
            ? clipperBoolean(ClipperLib.ClipType.ctDifference, baseRingsRaw, clipperInflate(lineRingsForTrim, 0.08)).flat()
            : baseRingsRaw;
        // União INCREMENTAL, um anel de cada vez — não `ctUnion([...baseRings, ...absorbedRings])`
        // de uma vez com tudo junto. Formas absorvidas do tipo 'line' se TOCAM exatamente na ponta
        // uma da outra (vértices compartilhados do contorno original, pontas quadradas sem
        // meia-junta — ver `_shapeToPolygonRings`), e o Clipper embaralha essa configuração
        // quase-degenerada quando processa vários anéis nesse tipo de contato de uma vez só: em
        // vez de um polígono simples, a árvore de resultado saía com um "buraco" espúrio no meio
        // (reproduzido e confirmado: um triângulo de 3 linhas gerava 3 anéis aninhados
        // positivo/negativo/positivo em vez de 1 anel só, visível como uma fresta fina em forma de
        // triângulo por cima do preenchimento). Unir um anel de cada vez evita expor o Clipper a
        // essa configuração de uma vez só. Não deveria sobrar mais de 1 pedaço no final (a área do
        // BFS é conectada por definição, e as formas absorvidas tocam essa borda), mas o `ctUnion`
        // final sem clip continua ali por segurança/corretude — não deveria silenciar dado se
        // acontecer.
        let accRings = baseRings;
        for (const ring of absorbedRings) {
            accRings = clipperBoolean(ClipperLib.ClipType.ctUnion, accRings, [ring]).flat();
        }
        const pieces = clipperBoolean(ClipperLib.ClipType.ctUnion, accRings, []);

        for (const rings of pieces) {
            const shape = this._buildRegionFromRings(activeCellType, rings);
            if (shape.cells.length === 0) continue; // pedaço degenerado (área ~0), ignora
            if (activeCellType === FluidSolver.CELL_TYPE.SOURCE) {
                shape.vx = FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
                shape.vy = 0;
                const absCells = shape.cells.map(c => ({ x: shape.x0 + c.dx, y: shape.y0 + c.dy }));
                this.solver.addSourceGroup(absCells, shape.vx, shape.vy);
            } else if (activeCellType === FluidSolver.CELL_TYPE.ROTOR) {
                Object.assign(shape, this._rotorPropsFrom(this.rotorDefaults));
                const absCells = shape.cells.map(c => ({ x: shape.x0 + c.dx, y: shape.y0 + c.dy }));
                this.solver.addRotatingBody(absCells, null, this._rotorPropsFrom(this.rotorDefaults));
            } else if (activeCellType === FluidSolver.CELL_TYPE.VALVE) {
                shape.enabled = false;
            } else if (activeCellType === FluidSolver.CELL_TYPE.MESH) {
                shape.holeSize = FluidSolver.MESH_DEFAULT_HOLE_SIZE;
            } else if (activeCellType === FluidSolver.CELL_TYPE.SINK) {
                shape.suction = FluidSolver.SINK_DEFAULT_SUCTION;
            }
            this.shapes.push(shape);
        }
        // _rasterizeShapes() reestampa todo `rotatingBodies` por cima no final (bugs.md #41),
        // cobrindo este Rotor recém-criado (já em solver.rotatingBodies pelo addRotatingBody
        // acima) sem precisar repetir o stamp manualmente aqui.
        this._rasterizeShapes();
    }

    _drawLineOnGrid(start, end, actionCallback) {
        let x0 = Math.round(start.x),
            y0 = Math.round(start.y);
        const x1 = Math.round(end.x),
            y1 = Math.round(end.y);
        const dx = Math.abs(x1 - x0),
            dy = Math.abs(y1 - y0),
            sx = (x0 < x1) ? 1 : -1,
            sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        while (true) {
            actionCallback(x0, y0);
            if ((x0 === x1) && (y0 === y1)) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    _drawRectangleOnGrid(start, end, filled, actionCallback) {
        const x_start = Math.min(start.x, end.x),
            x_end = Math.max(start.x, end.x);
        const y_start = Math.min(start.y, end.y),
            y_end = Math.max(start.y, end.y);
        for (let x = x_start; x <= x_end; x++) {
            for (let y = y_start; y <= y_end; y++) {
                if (filled || x === x_start || x === x_end || y === y_start || y === y_end) actionCallback(x, y);
            }
        }
    }

    _drawEllipseOnGrid(start, end, filled, actionCallback) {
        const x_start = Math.min(start.x, end.x),
            x_end = Math.max(start.x, end.x);
        const y_start = Math.min(start.y, end.y),
            y_end = Math.max(start.y, end.y);
        const cx = (x_start + x_end) / 2,
            cy = (y_start + y_end) / 2;
        const rx = (x_end - x_start) / 2,
            ry = (y_end - y_start) / 2;
        if (rx <= 0 || ry <= 0) return;
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
                const norm_dist_sq = ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2);
                if (filled) {
                    if (norm_dist_sq <= 1) actionCallback(x, y);
                } else {
                    if (norm_dist_sq <= 1 && norm_dist_sq > 0.8) actionCallback(x, y);
                }
            }
        }
    }

    _drawRoundedRectangleOnGrid(start, end, actionCallback) {
        const x0 = Math.min(start.x, end.x);
        const y0 = Math.min(start.y, end.y);
        const x1 = Math.max(start.x, end.x);
        const y1 = Math.max(start.y, end.y);
        let r = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) * 0.2));
        for (let x = x0 + r; x <= x1 - r; x++) {
            actionCallback(x, y0);
            actionCallback(x, y1);
        }
        for (let y = y0 + r; y <= y1 - r; y++) {
            actionCallback(x0, y);
            actionCallback(x1, y);
        }
        for (let a = Math.PI; a < 1.5 * Math.PI; a += 0.1 / r) actionCallback(x0 + r + Math.round(r * Math.cos(a)), y0 + r + Math.round(r * Math.sin(a)));
        for (let a = 1.5 * Math.PI; a < 2 * Math.PI; a += 0.1 / r) actionCallback(x1 - r + Math.round(r * Math.cos(a)), y0 + r + Math.round(r * Math.sin(a)));
        for (let a = 0; a < 0.5 * Math.PI; a += 0.1 / r) actionCallback(x1 - r + Math.round(r * Math.cos(a)), y1 - r + Math.round(r * Math.sin(a)));
        for (let a = 0.5 * Math.PI; a < Math.PI; a += 0.1 / r) actionCallback(x0 + r + Math.round(r * Math.cos(a)), y1 - r + Math.round(r * Math.sin(a)));
    }

    /**
     * @private
     * @description Repassa a geometria de uma forma (linha/retângulo/elipse/arredondado) célula
     * a célula pro callback informado — usado por _rasterizeShapes() e por qualquer operação que
     * precise saber exatamente quais células uma forma ocupa (ex.: reformar um Rotor/Entrada).
     */
    _replayShapeGeometry(shape, actionCallback) {
        const start = { x: shape.x0, y: shape.y0 };
        const end = { x: shape.x1, y: shape.y1 };
        switch (shape.tool) {
            case 'line':
                this._drawLineOnGrid(start, end, actionCallback);
                break;
            case 'rectangle_filled':
                this._drawRectangleOnGrid(start, end, true, actionCallback);
                break;
            case 'rectangle_outline':
                this._drawRectangleOnGrid(start, end, false, actionCallback);
                break;
            case 'ellipse_filled':
                this._drawEllipseOnGrid(start, end, true, actionCallback);
                break;
            case 'ellipse_outline':
                this._drawEllipseOnGrid(start, end, false, actionCallback);
                break;
            case 'rounded_rectangle':
                this._drawRoundedRectangleOnGrid(start, end, actionCallback);
                break;
            case 'region':
                // Geometria livre (máscara de célula), não os 2 pontos paramétricos das outras
                // ferramentas — origem em x0/y0 (canto mínimo do retângulo envolvente) + lista de
                // offsets relativos. Guardar como offset relativo (não coordenada absoluta) é o
                // que permite o arraste (mover o corpo) reaproveitar o mesmo código genérico de
                // translação de x0/y0/x1/y1 que já existe pras outras formas, sem precisar tocar
                // em `cells` durante o drag.
                for (const c of shape.cells) actionCallback(shape.x0 + c.dx, shape.y0 + c.dy);
                break;
        }
    }

    /**
     * @private
     * @description Deriva solver.cellType a partir de rawCellType (pintura livre) + shapes[]
     * (formas vetoriais, sempre por cima, na ordem do array = ordem de empilhamento). Rotor é
     * pulado de propósito NESSE loop — repintar a posição de repouso por cima da posição girada
     * atual faria o corpo "sumir" silenciosamente — mas no final da função `stampRotatingBodiesOntoGrid()`
     * reestampa a posição girada ATUAL de cada corpo por cima de tudo (bugs.md #41): sem isso,
     * desenhar qualquer outra forma sobre as células de um Rotor já existente sobrescrevia o
     * tipo dele, e no passo seguinte `_updateRotatingBodies` o removia de `rotatingBodies` por
     * não achar mais nenhuma célula ROTOR (o corpo "sumia" e parava de girar/influenciar).
     */
    _rasterizeShapes() {
        const xdim = this.solver.xdim, ydim = this.solver.ydim;
        this.solver.cellType.set(this.rawCellType);
        this.lineCellMask.fill(0);
        for (const shape of this.shapes) {
            if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) continue;
            const isLine = shape.tool === 'line';
            // Entrada/Saída/Válvula têm semânticas de "fechado" diferentes (bugs.md #38/#39/#40):
            // - Entrada fechada (shape.enabled === false) vira NORMAL: não é parede, é uma
            //   passagem aberta que parou de empurrar/puxar — o fluxo atravessa reto, sem
            //   desviar (pedido explícito do usuário, corrigindo minha primeira tentativa que
            //   fechava como Barreira sólida). undefined conta como aberta (formas de antes
            //   desse recurso existir).
            // - Saída fechada (shape.enabled === false) vira BARRIER: para de absorver e passa
            //   a bloquear de verdade, como uma parede.
            // - Válvula é BARRIER por padrão (shape.enabled precisa ser true, estritamente, pra
            //   abrir) — nasce fechada/visível como parede sólida.
            let effectiveType = shape.cellType;
            if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                if (shape.enabled === false) effectiveType = FluidSolver.CELL_TYPE.NORMAL;
            } else if (shape.cellType === FluidSolver.CELL_TYPE.SINK) {
                if (shape.enabled === false) effectiveType = FluidSolver.CELL_TYPE.BARRIER;
            } else if (shape.cellType === FluidSolver.CELL_TYPE.VALVE) {
                effectiveType = shape.enabled === true ? FluidSolver.CELL_TYPE.NORMAL : FluidSolver.CELL_TYPE.BARRIER;
            }
            this._replayShapeGeometry(shape, (x, y) => {
                if (x < 0 || x >= xdim || y < 0 || y >= ydim) return;
                const i = x + y * xdim;
                this.solver.cellType[i] = effectiveType;
                // Grade sempre entra na máscara, não só quando desenhada com a ferramenta Linha
                // (bugs.md #32): o visual dela é o overlay vetorial translúcido cobrindo a cor
                // do escoamento por baixo (ver Renderer.drawSmoothLineShapes) — sem mascarar
                // aqui, uma Grade retangular/elíptica mostraria um bloco cinza SÓLIDO por baixo
                // do overlay translúcido (as duas camadas juntas somam de volta pra opaco), em
                // vez do efeito "tela translúcida deixando ver o vento resistido atrás dela".
                this.lineCellMask[i] = (isLine || effectiveType === FluidSolver.CELL_TYPE.MESH) ? 1 : 0;
                if (effectiveType === FluidSolver.CELL_TYPE.SOURCE) {
                    this.solver.sourceVx[i] = shape.vx;
                    this.solver.sourceVy[i] = shape.vy;
                } else if (effectiveType === FluidSolver.CELL_TYPE.MESH) {
                    // Furo por célula (bugs.md #32) — mesmo padrão de sourceVx/vy: a "verdade"
                    // do parâmetro mora em `shape.holeSize`, espelhada pro array por célula do
                    // solver toda vez que a grade é rasterizada.
                    this.solver.meshHoleSize[i] = shape.holeSize ?? FluidSolver.MESH_DEFAULT_HOLE_SIZE;
                } else if (effectiveType === FluidSolver.CELL_TYPE.SINK) {
                    // Sucção por célula (bugs.md #52) — mesmo padrão de sourceVx/vy e
                    // meshHoleSize: a "verdade" do parâmetro mora em `shape.suction`, espelhada
                    // pro array por célula do solver toda vez que a grade é rasterizada. Uma
                    // Saída fechada vira BARRIER (effectiveType já não é SINK aqui), então não
                    // passa por este ramo — não precisa zerar sucção nesse caso.
                    this.solver.sinkStrength[i] = shape.suction ?? FluidSolver.SINK_DEFAULT_SUCTION;
                }
            });
        }
        // Toda célula de uma forma `region` COM `rings` entra na máscara — o polígono (via
        // Clipper) cobre a forma INTEIRA agora, não só o entorno de uma aresta absorvida, então
        // não precisa mais de distância ponto-segmento nenhuma pra decidir quais células mascarar
        // (bugs.md #45). O preenchimento quadriculado por baixo ficaria redundante (mesma cor) ou
        // vazaria degrau nas bordas onde o polígono não bate exatamente no limite de célula —
        // mascarar tudo deixa o polígono ser a única fonte visual pra essa forma. Uma `region`
        // SEM `rings` (salva antes do Clipper existir) fica de fora — ela cai no fallback de
        // marching-squares, que só TRAÇA o contorno (não preenche); mascarar as células dela
        // também apagaria o preenchimento sólido sem nada pra substituir.
        for (const shape of this.shapes) {
            if (shape.tool !== 'region' || !shape.rings) continue;
            for (const { dx, dy } of shape.cells) {
                const cx = shape.x0 + dx, cy = shape.y0 + dy;
                if (cx < 0 || cx >= xdim || cy < 0 || cy >= ydim) continue;
                this.lineCellMask[cx + cy * xdim] = 1;
            }
        }
        // Reestampa os Rotores por cima de tudo que acabou de ser rasterizado (bugs.md #41):
        // sem isto, desenhar QUALQUER outra forma (ex.: uma Barreira formando a carcaça ao redor
        // de um Rotor já existente) sobrescrevia as células do Rotor com o tipo novo — aí, no
        // primeiro passo físico, `_updateRotatingBodies` via `stillExists` não achava mais
        // nenhuma célula ROTOR pertencendo ao corpo e o removia silenciosamente de
        // `rotatingBodies` (o Rotor "sumia" e parava de girar/influenciar o fluxo). Rotor sempre
        // vence por cima da pintura livre/outras formas, igual já valia pra undo/redo e
        // importar configuração.
        this.solver.stampRotatingBodiesOntoGrid();
        this._refreshValveWidget();
    }

    /**
     * @private
     * @description Recorte de Liang-Barsky: em que trecho paramétrico [0,1] do segmento
     * (x0,y0)-(x1,y1) ele está dentro do retângulo [minX,maxX]x[minY,maxY]? Devolve [tEnter,
     * tExit], ou `null` se o segmento nunca entra no retângulo. Usado por
     * `_eraseRectangleOnGrid` pra cortar uma forma tipo 'line' em vez de "descer" ela inteira
     * pra pintura livre (bugs.md — apagar parte de uma linha reta virava escada, porque a
     * suavização só existe pra formas vetoriais, não pra pixel solto).
     */
    _clipLineToRect(x0, y0, x1, y1, minX, minY, maxX, maxY) {
        let t0 = 0, t1 = 1;
        const dx = x1 - x0, dy = y1 - y0;
        const edges = [
            [-dx, x0 - minX],
            [dx, maxX - x0],
            [-dy, y0 - minY],
            [dy, maxY - y0]
        ];
        for (const [p, q] of edges) {
            if (p === 0) {
                if (q < 0) return null;
                continue;
            }
            const r = q / p;
            if (p < 0) {
                if (r > t1) return null;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return null;
                if (r < t1) t1 = r;
            }
        }
        return [t0, t1];
    }

    /**
     * @private
     * @description Apaga uma única célula durante o traço contínuo da borracha (bugs.md #46).
     * Reutiliza toda a lógica de `_eraseRectangleOnGrid` mas operando em um ponto 1×1:
     * - Formas 'line' são recortadas (Liang-Barsky) em até 2 segmentos sobreviventes.
     * - Outras formas vetoriais descem para rawCellType (apagamento parcial real).
     * - A célula em {x,y} é limpa em rawCellType e sourceVx/sourceVy.
     * Chama `_rasterizeShapes()` ao final para sincronizar a grade física.
     */
    _eraseAt({ x, y }) {
        if (x < 0 || x >= this.solver.xdim || y < 0 || y >= this.solver.ydim) return;
        this._eraseRectangleOnGrid({ x, y }, { x, y });
    }

    _eraseRectangleOnGrid(start, end) {
        const x_start = Math.min(start.x, end.x),
            x_end = Math.max(start.x, end.x);
        const y_start = Math.min(start.y, end.y),
            y_end = Math.max(start.y, end.y);
        const inRect = (x, y) => x >= x_start && x <= x_end && y >= y_start && y <= y_end;

        // Barreira/Entrada/Saída tocadas pela Borracha "descem" pra pintura livre: a parte
        // coberta pelo retângulo vira fundo, a parte que sobra fica pintada no mesmo lugar —
        // apagamento parcial de verdade (bugs.md #2), igual ao comportamento de antes das
        // formas vetoriais existirem. Rotor fica de fora — não há um jeito físico limpo de
        // "cortar" um corpo rígido girando; apagar um Rotor continua sendo só via seleção +
        // Delete (_deleteRotorBody/_deleteSelectedShape).
        //
        // Exceção: uma forma tipo 'line' NÃO desce pra pixel solto — em vez disso é recortada
        // (Liang-Barsky) em até 2 novas linhas vetoriais (antes/depois do trecho apagado).
        // Sem isso, o pedaço que sobra perde o contorno suave (só formas em shapes[] são
        // suavizadas) e a "escada" inerente da rasterização, antes escondida pelo contorno,
        // reaparece — era exatamente o bug reportado.
        const survivingShapes = [];
        for (const shape of this.shapes) {
            if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
                survivingShapes.push(shape);
                continue;
            }

            if (shape.tool === 'line') {
                const clip = this._clipLineToRect(shape.x0, shape.y0, shape.x1, shape.y1, x_start - 0.5, y_start - 0.5, x_end + 0.5, y_end + 0.5);
                if (!clip) {
                    survivingShapes.push(shape);
                    continue;
                }
                const [tEnter, tExit] = clip;
                if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                    const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
                    const groupIdx = this._findSourceGroupNear(centroid);
                    if (groupIdx >= 0) this.solver.sourceGroups.splice(groupIdx, 1);
                }
                const dx = shape.x1 - shape.x0,
                    dy = shape.y1 - shape.y0;
                const makeSegment = (ta, tb) => {
                    const nx0 = shape.x0 + dx * ta,
                        ny0 = shape.y0 + dy * ta;
                    const nx1 = shape.x0 + dx * tb,
                        ny1 = shape.y0 + dy * tb;
                    if (nx0 === nx1 && ny0 === ny1) return null;
                    return { ...shape, id: this._nextShapeId++, x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
                };
                const segments = [
                    tEnter > 0.001 ? makeSegment(0, tEnter) : null,
                    tExit < 0.999 ? makeSegment(tExit, 1) : null
                ];
                for (const seg of segments) {
                    if (!seg) continue;
                    survivingShapes.push(seg);
                    if (seg.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                        const segCells = [];
                        this._replayShapeGeometry(seg, (x, y) => {
                            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) segCells.push({ x, y });
                        });
                        this.solver.addSourceGroup(segCells, seg.vx, seg.vy);
                    }
                }
                continue;
            }

            // Forma com curva/região (elipse, retângulo arredondado, ou uma region já fundida):
            // NÃO desce inteira pra pixel solto — corta de verdade via diferença de polígono
            // (Clipper), que devolve 0+ pedaços JÁ SEPARADOS se o corte tiver desconectado a
            // forma em partes que não se tocam (bugs.md #45 — antes disso, cortar um triângulo ao
            // meio devia gerar 2 objetos mas gerava só 1, porque a lista de células sobreviventes
            // virava uma única `region` nova sem checar conectividade). Retângulo reto/vazio não
            // tem curva nenhuma pra perder, então continua caindo no fallback abaixo.
            if (shape.tool === 'region' || shape.tool === 'ellipse_outline' || shape.tool === 'ellipse_filled' || shape.tool === 'rounded_rectangle') {
                const cells = [];
                this._replayShapeGeometry(shape, (x, y) => {
                    if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
                });
                if (!cells.some(({ x, y }) => inRect(x, y))) {
                    survivingShapes.push(shape);
                    continue;
                }
                if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                    const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
                    const groupIdx = this._findSourceGroupNear(centroid);
                    if (groupIdx >= 0) this.solver.sourceGroups.splice(groupIdx, 1);
                }
                const subjectRings = shapeToPolygonRings(shape);
                // Retângulo do apagador em coordenada CONTÍNUA — célula x ocupa [x, x+1), então o
                // retângulo vai de x_start a x_end+1 (não +0.5, que era só pro recorte de reta
                // contra centro de célula; aqui é polígono contra polígono, direto nos limites).
                const eraserRing = [
                    { x: x_start, y: y_start }, { x: x_end + 1, y: y_start },
                    { x: x_end + 1, y: y_end + 1 }, { x: x_start, y: y_end + 1 }
                ];
                const pieces = clipperBoolean(ClipperLib.ClipType.ctDifference, subjectRings, [eraserRing]);
                for (const rings of pieces) {
                    const newShape = this._buildRegionFromRings(shape.cellType, rings);
                    if (newShape.cells.length === 0) continue; // pedaço degenerado, ignora
                    if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                        newShape.vx = shape.vx;
                        newShape.vy = shape.vy;
                        const absCells = newShape.cells.map(c => ({ x: newShape.x0 + c.dx, y: newShape.y0 + c.dy }));
                        this.solver.addSourceGroup(absCells, shape.vx, shape.vy);
                    } else if (shape.cellType === FluidSolver.CELL_TYPE.VALVE) {
                        newShape.enabled = shape.enabled;
                    } else if (shape.cellType === FluidSolver.CELL_TYPE.MESH) {
                        newShape.holeSize = shape.holeSize;
                    } else if (shape.cellType === FluidSolver.CELL_TYPE.SINK) {
                        // Preserva estado aberto/fechado e força de sucção do pedaço original —
                        // sem isto, cortar uma Saída com curva (elipse/arredondado/region) via
                        // Borracha reabriria uma Saída fechada e voltaria a sucção pro padrão.
                        newShape.enabled = shape.enabled;
                        newShape.suction = shape.suction;
                    }
                    survivingShapes.push(newShape);
                }
                continue;
            }

            const cells = [];
            this._replayShapeGeometry(shape, (x, y) => {
                if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
            });
            if (!cells.some(({ x, y }) => inRect(x, y))) {
                survivingShapes.push(shape);
                continue;
            }
            // Reestampa toda a geometria como pintura livre primeiro (a parte dentro do
            // retângulo é sobrescrita de volta pra fundo logo abaixo, no loop de apagar).
            for (const { x, y } of cells) {
                this._paintRawCell(x, y, shape.cellType);
            }
        }
        this.shapes = survivingShapes;

        for (let x = x_start; x <= x_end; x++) {
            for (let y = y_start; y <= y_end; y++) {
                if (x < 0 || x >= this.solver.xdim || y < 0 || y >= this.solver.ydim) continue;
                this._paintRawCell(x, y, FluidSolver.CELL_TYPE.NORMAL);
                const i = x + y * this.solver.xdim;
                this.solver.sourceVx[i] = 0;
                this.solver.sourceVy[i] = 0;
            }
        }
        this._rasterizeShapes();
        this.solver.dyeSources = this.solver.dyeSources.filter(source => source.x < x_start || source.x > x_end || source.y < y_start || source.y > y_end);
        // Objetos avulsos (bugs.md #32) não têm fonte — apagar a área embaixo de um deles
        // desativa a partícula em si (mesmo pool, ver `addParticle`), não uma "fonte" que não
        // existe mais.
        for (const p of this.solver.particles) {
            if (p.x >= x_start && p.x <= x_end && p.y >= y_start && p.y <= y_end) {
                p.x = -1;
                p.y = -1;
            }
        }
    }

    /**
     * @description Pinta uma célula na camada livre (rawCellType) — usada por Pincel,
     * Preenchimento, Borracha e pelas operações de seleção (colar/girar/inverter). Formas
     * vetoriais (linha/retângulo/elipse/arredondado) NÃO passam por aqui — vão direto pra
     * `shapes[]` via `_commitShape`. Quem chama esta função é responsável por chamar
     * `_rasterizeShapes()` depois (uma vez por gesto, não por célula).
     */
    _paintRawCell(x, y, type) {
        if (x < 0 || x >= this.solver.xdim || y < 0 || y >= this.solver.ydim) return false;
        this.rawCellType[x + y * this.solver.xdim] = type;
        if (type === FluidSolver.CELL_TYPE.SOURCE && this.pendingSourceCells) {
            this.pendingSourceCells.push({ x, y });
        }
        if (type === FluidSolver.CELL_TYPE.ROTOR && this.pendingRotorCells) {
            this.pendingRotorCells.push({ x, y });
        }
        return true;
    }
}
