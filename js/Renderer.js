import { FluidSolver } from './FluidSolver.js?v=20261102b';
import { formatarVelocidade } from './Unidades.js?v=20261102b';

/**
 * @class Renderer
 * @description Responsável por toda a pintura do canvas a partir do estado de um FluidSolver.
 * Não guarda estado de negócio nem lê elementos de formulário diretamente — recebe
 * tudo que precisa via parâmetros de `render()`.
 */
export class Renderer {
    static RULER_SIZE = 30;
    static N_COLORS = 400;

    constructor(canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d');
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenContext = this.offscreenCanvas.getContext('2d');
        this._initializeColorMap();
    }

    /**
     * @private
     * @description Cria um mapa de cores (colormap) para a visualização dos dados.
     */
    _initializeColorMap() {
        const N_COLORS = Renderer.N_COLORS;
        this.redList = new Array(N_COLORS + 2);
        this.greenList = new Array(N_COLORS + 2);
        this.blueList = new Array(N_COLORS + 2);

        for (let c = 0; c <= N_COLORS; c++) {
            let r, g, b;
            if (c < N_COLORS / 8) {
                r = 0;
                g = 0;
                b = Math.round(255 * (c + N_COLORS / 8) / (N_COLORS / 4));
            } else if (c < 3 * N_COLORS / 8) {
                r = 0;
                g = Math.round(255 * (c - N_COLORS / 8) / (N_COLORS / 4));
                b = 255;
            } else if (c < 5 * N_COLORS / 8) {
                r = Math.round(255 * (c - 3 * N_COLORS / 8) / (N_COLORS / 4));
                g = 255;
                b = 255 - r;
            } else if (c < 7 * N_COLORS / 8) {
                r = 255;
                g = Math.round(255 * (7 * N_COLORS / 8 - c) / (N_COLORS / 4));
                b = 0;
            } else {
                r = Math.round(255 * (9 * N_COLORS / 8 - c) / (N_COLORS / 4));
                g = 0;
                b = 0;
            }
            this.redList[c] = r;
            this.greenList[c] = g;
            this.blueList[c] = b;
        }
        this.redList[N_COLORS + 1] = 0;
        this.greenList[N_COLORS + 1] = 0;
        this.blueList[N_COLORS + 1] = 0;
    }

    /**
     * @param {FluidSolver} solver
     * @param {number} pxPerSquare
     * @param {object} viewState - { plotIndex, contrast, showTracers, showForce, showSensor,
     *   activeTool, toolStartPoint, mouseIsDown, mouseGridPos, selectionArea, clipboard,
     *   pastePreviewOrigin, zoom, panX, panY }
     */
    render(solver, pxPerSquare, viewState) {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this._updateSimulationImage(solver, pxPerSquare, viewState);
        this._drawContent(solver, pxPerSquare, viewState);
        this._drawRulersAndGrid(solver, pxPerSquare, viewState);
        this._drawLegend(viewState);
    }

    /**
     * @private
     * @description Atualiza a imagem da simulação de forma otimizada usando ImageData.
     * Isso evita chamadas `fillRect` individuais, melhorando drasticamente a performance.
     */
    _updateSimulationImage(solver, pxPerSquare, viewState) {
        if (!solver.xdim || !solver.ydim) return;

        const imageWidth = solver.xdim * pxPerSquare;
        const imageHeight = solver.ydim * pxPerSquare;
        if (imageWidth <= 0 || imageHeight <= 0) return;

        if (this.offscreenCanvas.width !== imageWidth) this.offscreenCanvas.width = imageWidth;
        if (this.offscreenCanvas.height !== imageHeight) this.offscreenCanvas.height = imageHeight;

        const imageData = this.offscreenContext.createImageData(imageWidth, imageHeight);
        const data = imageData.data;

        const contrast = Math.pow(1.2, Number(viewState.contrast));
        const plotType = viewState.plotIndex;
        if (plotType === 4) solver.computeCurl();

        for (let y = 0; y < solver.ydim; y++) {
            for (let x = 0; x < solver.xdim; x++) {
                const index = x + y * solver.xdim;
                let r, g, b;

                // Célula coberta por uma forma vetorial tipo 'line' (ver
                // FluidSimulationApp._rasterizeShapes/lineCellMask): pula o preenchimento
                // quadriculado sólido aqui — o traço vetorial suave (drawSmoothLineShapes,
                // desenhado por cima) é a ÚNICA representação visual dessa célula. Sem "verdade
                // quadriculada" nenhuma por baixo, não tem canto de degrau pra vazar além do
                // traço, então a espessura escolhida (mesmo fina) nunca mostra espinho.
                const isSmoothedLine = viewState.lineCellMask && viewState.lineCellMask[index] === 1;

                if (!isSmoothedLine && solver.cellType[index] === FluidSolver.CELL_TYPE.BARRIER) {
                    // Cinza-escuro "de aço" — branco puro se perderia contra o fundo claro do
                    // repouso (item 7 do plano premium: fluido parado funde com o canvas, agora
                    // claro em vez de escuro).
                    r = 28;
                    g = 37;
                    b = 48;
                } else if (!isSmoothedLine && solver.cellType[index] === FluidSolver.CELL_TYPE.SOURCE) {
                    r = 56;
                    g = 189;
                    b = 248;
                } else if (!isSmoothedLine && solver.cellType[index] === FluidSolver.CELL_TYPE.SINK) {
                    r = 255;
                    g = 93;
                    b = 93;
                } else if (!isSmoothedLine && solver.cellType[index] === FluidSolver.CELL_TYPE.ROTOR) {
                    r = 167;
                    g = 139;
                    b = 250;
                } else if (!viewState.hasEverStepped) {
                    // Grade "de fábrica", nunca rodada — fica neutra (cor do fundo do app), não
                    // com a ponta azul da paleta ainda: ligar zero=azul só faz sentido quando
                    // zero é um RESULTADO da simulação, não um estado que ela nem começou a
                    // calcular. Assim que passar 1 passo (hasEverStepped), some pra sempre em
                    // favor da paleta completa, mesmo pausando depois.
                    r = 238;
                    g = 241;
                    b = 245;
                } else {
                    // Todo modo usa magnitude (valor absoluto), não desvio com sinal — zero
                    // sempre cai na ponta azul da paleta (cIndex=0), o máximo sempre na ponta
                    // vermelha (cIndex=N), igual "Velocidade (módulo)" já fazia (por isso ele
                    // sempre pareceu "cheio": zero já É a cor mais fria da paleta, não precisa de
                    // nenhum truque de fundir com o fundo pra ficar calmo em repouso). Isso
                    // troca a informação de SINAL (giro horário vs anti-horário no Curl, direita
                    // vs esquerda em Vel. X, etc.) por cobertura de grade cheia + zero=extremo da
                    // legenda em todo modo — sem manchas brancas nunca.
                    let value;
                    switch (plotType) {
                        case 0:
                            // Densidade/Pressão mapeada linearmente (não-absoluto).
                            // rho = 1 fica no meio (0.5). Valores < 1 caem para azul, > 1 sobem para vermelho.
                            value = (solver.rho[index] - 1) * 6 * contrast + 0.5;
                            break;
                        case 1:
                            value = Math.abs(solver.ux[index]) * 4 * contrast;
                            break;
                        case 2:
                            value = Math.abs(solver.uy[index]) * 4 * contrast;
                            break;
                        case 3:
                            value = Math.sqrt(solver.ux[index] ** 2 + solver.uy[index] ** 2) * 4 * contrast;
                            break;
                        case 4:
                            value = Math.abs(solver.curl[index]) * 10 * contrast;
                            break;
                    }
                    const cIndex = Math.max(0, Math.min(Renderer.N_COLORS, Math.round(Renderer.N_COLORS * value)));
                    r = this.redList[cIndex];
                    g = this.greenList[cIndex];
                    b = this.blueList[cIndex];
                }

                const startX = x * pxPerSquare;
                const startY = (solver.ydim - 1 - y) * pxPerSquare;

                for (let py = 0; py < pxPerSquare; py++) {
                    const rowStart = ((startY + py) * imageWidth + startX) * 4;
                    for (let px = 0; px < pxPerSquare; px++) {
                        const pixelIndex = rowStart + px * 4;
                        data[pixelIndex] = r;
                        data[pixelIndex + 1] = g;
                        data[pixelIndex + 2] = b;
                        data[pixelIndex + 3] = 255;
                    }
                }
            }
        }
        this.offscreenContext.putImageData(imageData, 0, 0);
    }

    /**
     * @private
     * @description Desenha o conteúdo que acompanha zoom/pan: o mapa de calor (via canvas
     * offscreen, imune à matriz de transformação) e todos os overlays vetoriais, recortados
     * à área interna da régua.
     */
    _drawContent(solver, pxPerSquare, viewState) {
        const zoom = viewState.zoom || 1;
        const panX = viewState.panX || 0;
        const panY = viewState.panY || 0;

        this.context.save();
        this.context.beginPath();
        this.context.rect(Renderer.RULER_SIZE, Renderer.RULER_SIZE, this.canvas.width - Renderer.RULER_SIZE, this.canvas.height - Renderer.RULER_SIZE);
        this.context.clip();
        this.context.translate(Renderer.RULER_SIZE + panX, Renderer.RULER_SIZE + panY);
        this.context.scale(zoom, zoom);

        this.context.drawImage(this.offscreenCanvas, 0, 0);
        this.drawSmoothLineShapes(viewState.shapes, solver.ydim, pxPerSquare, viewState.hasEverStepped);
        this.drawDyeSources(solver, pxPerSquare, viewState.selectedDyeSourceIndex, viewState.draggingDyeSource);
        this.drawDyeTracers(solver, pxPerSquare);
        this.drawParticles(solver, pxPerSquare);
        this.drawRotorPivots(solver, pxPerSquare, viewState.selectedRotorIndex, viewState.draggingRotorPivot);
        this.drawSourceGroupHandles(solver, pxPerSquare, solver.ydim, viewState.editingSourceGroupIndex);
        this.drawShapeSelection(viewState.shapes, viewState.selectedShapeIndex, solver.ydim, pxPerSquare);
        if (viewState.showTracers) this.drawTracers(solver, pxPerSquare);
        if (viewState.showArrows && viewState.hasEverStepped) this.drawVelocityArrows(solver, pxPerSquare);
        if (viewState.showForce && solver.barrierCount > 0) {
            this.drawForceArrow(
                solver.barrierxSum / solver.barrierCount,
                solver.barrierySum / solver.barrierCount,
                solver.barrierFx, solver.barrierFy, solver.ydim, pxPerSquare
            );
        }
        if (viewState.showSensor) this.drawSensor(solver, pxPerSquare, viewState.velocityScale);
        if (viewState.toolStartPoint && viewState.mouseIsDown) {
            this._drawPreviewShape(viewState.activeTool, viewState.toolStartPoint, viewState.mouseGridPos, solver.ydim, pxPerSquare);
        }
        if (viewState.selectionArea) this._drawSelectionArea(viewState.selectionArea, solver.ydim, pxPerSquare);
        if (viewState.pastePreviewOrigin) this._drawPastePreview(viewState.clipboard, viewState.pastePreviewOrigin, solver.ydim, pxPerSquare);
        if (viewState.directionHandle) {
            this.drawDirectionHandle(viewState.directionHandle.x, viewState.directionHandle.y, viewState.directionHandle.vx, viewState.directionHandle.vy, solver.ydim, pxPerSquare);
        }
        this.context.restore();
    }

    /**
     * @private
     * @description Desenha a régua/grade/legenda em espaço fixo de tela — não pan/zoom junto
     * com o conteúdo, só recalcula onde cada marcação cai dado o zoom/pan atuais.
     */
    _drawRulersAndGrid(solver, pxPerSquare, viewState) {
        const zoom = viewState.zoom || 1;
        const panX = viewState.panX || 0;
        const panY = viewState.panY || 0;
        const scaledPx = pxPerSquare * zoom;

        this.context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ruler-bg-color').trim();
        this.context.fillRect(0, 0, this.canvas.width, Renderer.RULER_SIZE);
        this.context.fillRect(0, 0, Renderer.RULER_SIZE, this.canvas.height);
        this.context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ruler-line-color').trim();
        this.context.strokeStyle = this.context.fillStyle;
        this.context.font = '10px sans-serif';
        this.context.textBaseline = 'middle';
        this.context.textAlign = 'center';
        for (let x = 0; x < solver.xdim; x++) {
            const canvasX = Renderer.RULER_SIZE + panX + (x + 0.5) * scaledPx;
            if (canvasX < Renderer.RULER_SIZE || canvasX > this.canvas.width) continue;
            if (x % 10 === 0) {
                this.context.fillText(x, canvasX, Renderer.RULER_SIZE / 2);
                this.context.beginPath();
                this.context.moveTo(canvasX, Renderer.RULER_SIZE - 10);
                this.context.lineTo(canvasX, Renderer.RULER_SIZE);
                this.context.stroke();
                this.context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-line-color').trim();
                this.context.beginPath();
                this.context.moveTo(canvasX, Renderer.RULER_SIZE);
                this.context.lineTo(canvasX, this.canvas.height);
                this.context.stroke();
                this.context.strokeStyle = this.context.fillStyle;
            } else if (x % 5 === 0) {
                this.context.beginPath();
                this.context.moveTo(canvasX, Renderer.RULER_SIZE - 5);
                this.context.lineTo(canvasX, Renderer.RULER_SIZE);
                this.context.stroke();
            }
        }
        this.context.textAlign = 'right';
        for (let y = 0; y < solver.ydim; y++) {
            const canvasY = Renderer.RULER_SIZE + panY + (solver.ydim - 1 - y + 0.5) * scaledPx;
            if (canvasY < Renderer.RULER_SIZE || canvasY > this.canvas.height) continue;
            if (y % 10 === 0) {
                this.context.fillText(y, Renderer.RULER_SIZE - 10, canvasY);
                this.context.beginPath();
                this.context.moveTo(Renderer.RULER_SIZE - 10, canvasY);
                this.context.lineTo(Renderer.RULER_SIZE, canvasY);
                this.context.stroke();
                this.context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-line-color').trim();
                this.context.beginPath();
                this.context.moveTo(Renderer.RULER_SIZE, canvasY);
                this.context.lineTo(this.canvas.width, canvasY);
                this.context.stroke();
                this.context.strokeStyle = this.context.fillStyle;
            } else if (y % 5 === 0) {
                this.context.beginPath();
                this.context.moveTo(Renderer.RULER_SIZE - 5, canvasY);
                this.context.lineTo(Renderer.RULER_SIZE, canvasY);
                this.context.stroke();
            }
        }
        if (viewState.mouseGridPos && viewState.mouseGridPos.x >= 0 && viewState.mouseGridPos.y >= 0) {
            this.context.fillStyle = 'rgba(255, 100, 100, 0.5)';
            const trackerX = Renderer.RULER_SIZE + panX + viewState.mouseGridPos.x * scaledPx;
            const trackerY = Renderer.RULER_SIZE + panY + (solver.ydim - 1 - viewState.mouseGridPos.y) * scaledPx;
            this.context.fillRect(trackerX, 0, scaledPx, Renderer.RULER_SIZE);
            this.context.fillRect(0, trackerY, Renderer.RULER_SIZE, scaledPx);
        }
    }

    _drawLegend(viewState) {
        const legendWidth = 150,
            legendHeight = 15;
        const legendX = this.canvas.width - legendWidth - 10;
        const legendY = this.canvas.height - legendHeight - 30;
        this.context.clearRect(legendX - 5, legendY - 25, legendWidth + 10, legendHeight + 40);
        const gradient = this.context.createLinearGradient(legendX, legendY, legendX + legendWidth, legendY);
        for (let c = 0; c <= Renderer.N_COLORS; c++) {
            gradient.addColorStop(c / Renderer.N_COLORS, `rgb(${this.redList[c]},${this.greenList[c]},${this.blueList[c]})`);
        }
        this.context.fillStyle = gradient;
        this.context.fillRect(legendX, legendY, legendWidth, legendHeight);
        const inkColor = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
        this.context.strokeStyle = inkColor;
        this.context.strokeRect(legendX, legendY, legendWidth, legendHeight);
        this.context.fillStyle = inkColor;
        this.context.font = '11px sans-serif';
        this.context.textAlign = 'center';
        this.context.fillText(viewState.plotLabel, legendX + legendWidth / 2, legendY - 10);
        this.context.textAlign = 'left';
        this.context.fillText("Baixo", legendX, legendY + legendHeight + 12);
        this.context.textAlign = 'right';
        this.context.fillText("Alto", legendX + legendWidth, legendY + legendHeight + 12);
    }

    _drawSelectionArea(selectionArea, ydim, pxPerSquare) {
        const x = Math.min(selectionArea.start.x, selectionArea.end.x) * pxPerSquare;
        const y = (ydim - 1 - Math.max(selectionArea.start.y, selectionArea.end.y)) * pxPerSquare;
        const w = (Math.abs(selectionArea.end.x - selectionArea.start.x) + 1) * pxPerSquare;
        const h = (Math.abs(selectionArea.end.y - selectionArea.start.y) + 1) * pxPerSquare;
        this.context.strokeStyle = 'rgba(100, 150, 255, 0.9)';
        this.context.fillStyle = 'rgba(100, 150, 255, 0.2)';
        this.context.lineWidth = 2;
        this.context.setLineDash([6, 4]);
        this.context.strokeRect(x, y, w, h);
        this.context.fillRect(x, y, w, h);
        this.context.setLineDash([]);
    }

    _drawPastePreview(clipboard, pastePreviewOrigin, ydim, pxPerSquare) {
        if (!clipboard || !pastePreviewOrigin) return;
        for (const p of clipboard.cells) {
            const x = (pastePreviewOrigin.x + p.x) * pxPerSquare;
            const y = (ydim - 1 - (pastePreviewOrigin.y + p.y)) * pxPerSquare;
            this.context.fillStyle = 'rgba(200, 200, 255, 0.5)';
            this.context.fillRect(x, y, pxPerSquare, pxPerSquare);
        }
    }

    drawTracers(solver, pxPerSquare) {
        if (!solver.tracerX) return;
        const radius = Math.max(1.8, pxPerSquare * 0.35);
        this.context.fillStyle = "#ffffff";
        this.context.strokeStyle = "rgba(0, 0, 0, 0.65)";
        this.context.lineWidth = 1;
        for (let t = 0; t < FluidSolver.N_TRACERS; t++) {
            const tx = solver.tracerX[t], ty = solver.tracerY[t];
            // Traçadores nascem numa grade uniforme (initTracers), sem checar o tipo de célula —
            // e continuam ali até a simulação rodar e a física de movimento os afastar. Um
            // traçador que caia em cima de uma Barreira/Rotor/Entrada/Saída/Válvula fica visível
            // como um pontinho branco solto por cima da forma sólida até isso acontecer (ou pra
            // sempre, se a forma foi desenhada DEPOIS do traçador já existir ali). Como isso é
            // puramente visual — não interfere na física, só decide o que desenhar — pula o
            // desenho enquanto a célula atual não for NORMAL, sem mexer no estado do traçador.
            const gx = Math.floor(tx), gy = Math.floor(ty);
            if (gx >= 0 && gx < solver.xdim && gy >= 0 && gy < solver.ydim) {
                if (solver.cellType[gx + gy * solver.xdim] !== FluidSolver.CELL_TYPE.NORMAL) continue;
            }
            const cX = (tx + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (ty + 0.5)) * pxPerSquare;
            this.context.beginPath();
            this.context.arc(cX, cY, radius, 0, 2 * Math.PI);
            this.context.fill();
            this.context.stroke();
        }
    }

    /**
     * @description Marca o pivô de cada corpo giratório com um pontinho — puramente visual,
     * lido de `body.pivotX/pivotY` (nunca gravado em `cellType`), então não interfere na física
     * nem bloqueia traçadores/fumaça. O corpo em `selectedIndex` (se houver) ganha um anel de
     * destaque na cor de acento, pra indicar qual está com o painel de propriedades aberto.
     */
    drawRotorPivots(solver, pxPerSquare, selectedIndex = -1, dragOverride = null) {
        if (!solver.rotatingBodies || solver.rotatingBodies.length === 0) return;
        const radius = Math.max(2, pxPerSquare * 0.35);
        for (let i = 0; i < solver.rotatingBodies.length; i++) {
            const body = solver.rotatingBodies[i];
            // Enquanto o pivô está sendo arrastado, desenha na posição do mouse em vez da
            // salva — nada de física muda até soltar (ver _handleMouseUp em FluidSimulationApp).
            const useDrag = dragOverride && dragOverride.bodyIndex === i;
            const pivotX = useDrag ? dragOverride.x : body.pivotX;
            const pivotY = useDrag ? dragOverride.y : body.pivotY;
            const cX = (pivotX + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (pivotY + 0.5)) * pxPerSquare;
            const isSelected = i === selectedIndex;
            this.context.fillStyle = "rgba(167, 139, 250, 0.95)";
            this.context.strokeStyle = isSelected ? "rgba(255, 180, 84, 1)" : "rgba(28, 37, 48, 0.85)";
            this.context.lineWidth = isSelected ? 2 : 1;
            this.context.beginPath();
            this.context.arc(cX, cY, isSelected ? radius * 1.6 : radius, 0, 2 * Math.PI);
            this.context.fill();
            this.context.stroke();
        }
    }

    /**
     * @description Contorno suave (anti-aliasing nativo do Canvas) por cima de cada forma
     * vetorial — a física continua discretizada em células (degraus, inerente à grade), mas
     * visualmente qualquer Barreira/Entrada/Saída fica lisa em vez de serrilhada (bug 26).
     *
     * • 'line'              → lineTo direto (já implementado antes)
     * • 'rectangle_outline',
     *   'rectangle_filled'  → strokeRect
     * • 'ellipse_outline',
     *   'ellipse_filled'    → arc (elipse via escala)
     * • 'rounded_rectangle' → arcTo em cada canto
     * • 'region'            → stroke ao redor do bounding-box das células (marching-border
     *                         simplificado: desenha o outline externo da região combinado com
     *                         o contorno do bounding box para suavizar as bordas visíveis)
     *
     * Rotor fica de fora depois do primeiro passo físico: `shape.x0/y0/x1/y1` é a geometria
     * de REPOUSO, que não acompanha a rotação ao vivo.
     */
    drawSmoothLineShapes(shapes, ydim, pxPerSquare, hasEverStepped) {
        if (!shapes || shapes.length === 0) return;
        const colorByType = {
            [FluidSolver.CELL_TYPE.BARRIER]: 'rgb(28, 37, 48)',
            [FluidSolver.CELL_TYPE.SOURCE]: 'rgb(56, 189, 248)',
            [FluidSolver.CELL_TYPE.SINK]: 'rgb(255, 93, 93)',
            [FluidSolver.CELL_TYPE.ROTOR]: 'rgb(167, 139, 250)',
            [FluidSolver.CELL_TYPE.VALVE]: 'rgb(34, 197, 94)',
            // Cinza-azulado, de propósito bem distinto do quase-preto da Barreira — a Grade
            // NUNCA bloqueia de verdade (bugs.md #32), então precisa ler como "permeável" já na
            // cor, antes mesmo de reparar na opacidade menor logo abaixo.
            [FluidSolver.CELL_TYPE.MESH]: 'rgb(100, 116, 139)'
        };
        this.context.save();
        this.context.lineCap = 'round';
        this.context.lineJoin = 'round';

        for (const shape of shapes) {
            if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR && hasEverStepped) continue;

            // Entrada fechada (bugs.md #38) e Válvula aberta (bugs.md #40) não são parede — a
            // célula física vira NORMAL (fluxo atravessa reto). Visualmente marca só com a
            // mesma cor bem apagada, pra ainda dar pra achar/reabrir sem parecer uma barreira
            // sólida. Saída fechada (bugs.md #39) e Válvula fechada (padrão de nascença, bugs.md
            // #40) viram BARRIER de verdade — desenha em opacidade cheia, como uma parede.
            let isPassage = false;
            if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                isPassage = shape.enabled === false;
            } else if (shape.cellType === FluidSolver.CELL_TYPE.VALVE) {
                isPassage = shape.enabled === true;
            }
            const color = colorByType[shape.cellType];
            if (!color) continue;
            // Grade sempre semi-transparente (nunca cheia como Barreira, nem apagada como uma
            // passagem aberta) — não tem estado ligado/desligado, é sempre a mesma coisa: uma
            // tela que deixa o vento passar com resistência (bugs.md #32).
            this.context.globalAlpha = shape.cellType === FluidSolver.CELL_TYPE.MESH ? 0.55 : (isPassage ? 0.35 : 1);

            const lw = (shape.lineWidth ?? 1.75) * pxPerSquare;
            this.context.strokeStyle = color;
            this.context.fillStyle = color;
            this.context.lineWidth = lw;
            this.context.beginPath();

            // Converte coordenadas de célula para pixels do canvas.
            // Centro da célula (x,y) está em pixel ((x+0.5)*px, (ydim-1-y+0.5)*px).
            // Para contornos de forma, usa a borda exterior da célula mais extrema.
            const x0c = Math.min(shape.x0, shape.x1);
            const x1c = Math.max(shape.x0, shape.x1);
            const y0c = Math.min(shape.y0, shape.y1);
            const y1c = Math.max(shape.y0, shape.y1);

            // Pixel do canto superior-esquerdo da célula (x0c, y1c) e inferior-direito de (x1c, y0c)
            const px0 = x0c * pxPerSquare;
            const py0 = (ydim - 1 - y1c) * pxPerSquare;
            const pw  = (x1c - x0c + 1) * pxPerSquare;
            const ph  = (y1c - y0c + 1) * pxPerSquare;

            switch (shape.tool) {
                case 'line': {
                    const s = this._gridToCanvas(shape.x0, shape.y0, ydim, pxPerSquare);
                    const e = this._gridToCanvas(shape.x1, shape.y1, ydim, pxPerSquare);
                    this.context.moveTo(s.x, s.y);
                    this.context.lineTo(e.x, e.y);
                    this.context.stroke();
                    break;
                }

                case 'rectangle_outline':
                    this.context.strokeRect(px0, py0, pw, ph);
                    break;

                case 'rectangle_filled':
                    this.context.fillRect(px0, py0, pw, ph);
                    break;

                case 'ellipse_outline':
                case 'ellipse_filled': {
                    const cx = px0 + pw / 2;
                    const cy = py0 + ph / 2;
                    const rx = pw / 2;
                    const ry = ph / 2;
                    this.context.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                    if (shape.tool === 'ellipse_filled') {
                        this.context.fill();
                    } else {
                        this.context.stroke();
                    }
                    break;
                }

                case 'rounded_rectangle': {
                    const rr = Math.max(1, Math.floor(Math.min(x1c - x0c, y1c - y0c) * 0.2)) * pxPerSquare;
                    const rx2 = px0 + rr, ry2 = py0 + rr;
                    const rx3 = px0 + pw - rr, ry3 = py0 + ph - rr;
                    this.context.moveTo(rx2, py0);
                    this.context.lineTo(rx3, py0);
                    this.context.arcTo(px0 + pw, py0, px0 + pw, ry2, rr);
                    this.context.lineTo(px0 + pw, ry3);
                    this.context.arcTo(px0 + pw, py0 + ph, rx3, py0 + ph, rr);
                    this.context.lineTo(rx2, py0 + ph);
                    this.context.arcTo(px0, py0 + ph, px0, ry3, rr);
                    this.context.lineTo(px0, ry2);
                    this.context.arcTo(px0, py0, rx2, py0, rr);
                    this.context.closePath();
                    this.context.stroke();
                    break;
                }

                case 'region': {
                    // Fonte de verdade geométrica: `shape.rings` (polígono resultante de uma
                    // operação booleana via Clipper — ver FluidSimulationApp._clipperBoolean,
                    // bugs.md #45). Desenha direto via moveTo/lineTo por anel + UM fill('evenodd')
                    // no final — o Canvas já sabe lidar com múltiplos sub-contornos/furos com essa
                    // regra, sem precisar de traçador de marching-squares nem overlay separado.
                    if (shape.rings && shape.rings.length > 0) {
                        this.context.beginPath();
                        for (const ring of shape.rings) {
                            if (ring.length === 0) continue;
                            const p0 = this._gridToCanvas(shape.x0 + ring[0].dx, shape.y0 + ring[0].dy, ydim, pxPerSquare);
                            this.context.moveTo(p0.x, p0.y);
                            for (let i = 1; i < ring.length; i++) {
                                const p = this._gridToCanvas(shape.x0 + ring[i].dx, shape.y0 + ring[i].dy, ydim, pxPerSquare);
                                this.context.lineTo(p.x, p.y);
                            }
                            this.context.closePath();
                        }
                        this.context.fillStyle = color;
                        this.context.fill('evenodd');
                        break;
                    }

                    // Fallback de compatibilidade: forma `region` salva ANTES do Clipper existir
                    // (sem `rings`) — traçador de marching-squares puro, sem overlay de
                    // `smoothLines` (mecanismo removido, ver bugs.md #45). Serrilhado, mas
                    // funcional, até o usuário editar a forma de novo.
                    if (!shape.cells || shape.cells.length === 0) break;

                    const cellSet = new Set();
                    for (const { dx, dy } of shape.cells) {
                        cellSet.add(`${shape.x0 + dx},${shape.y0 + dy}`);
                    }

                    // Arestas dirigidas: chave = "x1,y1" → [x2, y2]
                    // Pode haver mais de uma aresta saindo do mesmo vértice (T-junções),
                    // então usa Map de vértice → lista de destinos.
                    const outEdges = new Map(); // "x,y" -> [[x2,y2], ...]
                    const addEdge = (x1, y1, x2, y2) => {
                        const k = `${x1},${y1}`;
                        if (!outEdges.has(k)) outEdges.set(k, []);
                        outEdges.get(k).push([x2, y2]);
                    };

                    const px = pxPerSquare;
                    for (const { dx, dy } of shape.cells) {
                        const cx = shape.x0 + dx;
                        const cy = shape.y0 + dy;
                        // Cantos da célula em espaço canvas (y do canvas cresce para baixo):
                        //   L = cx*px,  R = (cx+1)*px
                        //   T = (ydim-1-cy)*px  (topo no canvas = y alto no grid)
                        //   B = (ydim-cy)*px
                        const cL = cx * px,      cR = (cx + 1) * px;
                        const cT = (ydim - 1 - cy) * px,  cB = (ydim - cy) * px;

                        // Aresta superior (grid +y ausente): L,T → R,T
                        if (!cellSet.has(`${cx},${cy + 1}`)) addEdge(cL, cT, cR, cT);
                        // Aresta direita  (grid +x ausente): R,T → R,B
                        if (!cellSet.has(`${cx + 1},${cy}`)) addEdge(cR, cT, cR, cB);
                        // Aresta inferior (grid -y ausente): R,B → L,B
                        if (!cellSet.has(`${cx},${cy - 1}`)) addEdge(cR, cB, cL, cB);
                        // Aresta esquerda (grid -x ausente): L,B → L,T
                        if (!cellSet.has(`${cx - 1},${cy}`)) addEdge(cL, cB, cL, cT);
                    }

                    // Percorre polígonos fechados a partir das arestas não visitadas
                    const usedEdges = new Set();
                    this.context.lineWidth = Math.max(1, pxPerSquare * 0.7);
                    this.context.strokeStyle = color;
                    this.context.lineJoin = 'round';

                    for (const [startKey] of outEdges) {
                        const startDests = outEdges.get(startKey);
                        for (let ei = 0; ei < startDests.length; ei++) {
                            const firstEdgeKey = `${startKey}→${startDests[ei][0]},${startDests[ei][1]}`;
                            if (usedEdges.has(firstEdgeKey)) continue;

                            // Inicia um novo polígono
                            const [sx, sy] = startKey.split(',').map(Number);
                            this.context.beginPath();
                            this.context.moveTo(sx, sy);

                            let curVertKey = startKey;
                            let curDest = startDests[ei];
                            let guard = outEdges.size * 4 + 4;

                            while (guard-- > 0) {
                                const edgeKey = `${curVertKey}→${curDest[0]},${curDest[1]}`;
                                if (usedEdges.has(edgeKey)) break;
                                usedEdges.add(edgeKey);
                                this.context.lineTo(curDest[0], curDest[1]);

                                const nextKey = `${curDest[0]},${curDest[1]}`;
                                if (nextKey === startKey) break; // polígono fechado
                                const nextDests = outEdges.get(nextKey);
                                if (!nextDests) break;
                                // Escolhe a próxima aresta ainda não usada
                                const nextEdge = nextDests.find(e => !usedEdges.has(`${nextKey}→${e[0]},${e[1]}`));
                                if (!nextEdge) break;
                                curVertKey = nextKey;
                                curDest = nextEdge;
                            }

                            this.context.closePath();
                            this.context.stroke();
                        }
                    }
                    break;
                }
            }
        }
        this.context.restore();
    }

    /**
     * @description Retângulo envolvente tracejado + 2 handles (x0,y0 e x1,y1) da forma vetorial
     * selecionada — mesma chamada serve tanto pra indicar a seleção em repouso quanto pra
     * mostrar o arraste ao vivo (stretch/mover), já que ambos só leem `shapes[selectedShapeIndex]`
     * no estado atual, sem precisar de um mecanismo de preview separado.
     */
    drawShapeSelection(shapes, selectedShapeIndex, ydim, pxPerSquare) {
        if (selectedShapeIndex < 0 || !shapes || !shapes[selectedShapeIndex]) return;
        const shape = shapes[selectedShapeIndex];
        const x0 = Math.min(shape.x0, shape.x1),
            x1 = Math.max(shape.x0, shape.x1);
        const y0 = Math.min(shape.y0, shape.y1),
            y1 = Math.max(shape.y0, shape.y1);
        const boxX = x0 * pxPerSquare;
        const boxY = (ydim - 1 - y1) * pxPerSquare;
        const boxW = (x1 - x0 + 1) * pxPerSquare;
        const boxH = (y1 - y0 + 1) * pxPerSquare;

        this.context.save();
        this.context.strokeStyle = "rgba(255, 180, 84, 0.9)";
        this.context.lineWidth = 1.5;
        this.context.setLineDash([5, 3]);
        this.context.strokeRect(boxX, boxY, boxW, boxH);
        this.context.setLineDash([]);

        // Região (preenchimento fundido, geometria livre) só move o corpo inteiro — sem pontas
        // de esticar pra desenhar, já que não há um "x0y0"/"x1y1" editável de verdade nela.
        if (shape.tool === 'region') {
            this.context.restore();
            return;
        }

        const handleRadius = Math.max(3, pxPerSquare * 0.5);
        this.context.fillStyle = "rgba(255, 180, 84, 1)";
        this.context.strokeStyle = "rgba(28, 37, 48, 0.85)";
        this.context.lineWidth = 1.5;
        for (const p of [
                this._gridToCanvas(shape.x0, shape.y0, ydim, pxPerSquare),
                this._gridToCanvas(shape.x1, shape.y1, ydim, pxPerSquare)
            ]) {
            this.context.beginPath();
            this.context.arc(p.x, p.y, handleRadius, 0, 2 * Math.PI);
            this.context.fill();
            this.context.stroke();
        }
        this.context.restore();
    }

    drawDyeSources(solver, pxPerSquare, selectedIndex = -1, dragOverride = null) {
        const radius = Math.max(4, pxPerSquare * 0.6);
        for (let i = 0; i < solver.dyeSources.length; i++) {
            const source = solver.dyeSources[i];
            const useDrag = dragOverride && dragOverride.index === i;
            const sx = useDrag ? dragOverride.x : source.x;
            const sy = useDrag ? dragOverride.y : source.y;
            const cX = (sx + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (sy + 0.5)) * pxPerSquare;
            // Bug 24: cor vibrante laranja/âmbar com borda escura para alto contraste em
            // qualquer fundo de canvas (cor anterior era rgba(200,200,255,0.7) — quase branca,
            // desaparecia sobre o fundo claro do estado inicial).
            if (i === selectedIndex) {
                this.context.beginPath();
                this.context.arc(cX, cY, radius * 1.7, 0, 2 * Math.PI);
                this.context.strokeStyle = 'rgba(255, 180, 84, 1)';
                this.context.lineWidth = 2;
                this.context.stroke();
            }
            this.context.beginPath();
            this.context.arc(cX, cY, radius, 0, 2 * Math.PI);
            this.context.strokeStyle = 'rgba(28, 18, 0, 0.7)';
            this.context.lineWidth = 2;
            this.context.stroke();
            this.context.fillStyle = '#f59e0b';
            this.context.fill();
            // Cruz interna para indicar que é uma fonte emissora
            this.context.strokeStyle = 'rgba(28, 18, 0, 0.5)';
            this.context.lineWidth = 1.5;
            this.context.beginPath();
            this.context.moveTo(cX - radius * 0.45, cY);
            this.context.lineTo(cX + radius * 0.45, cY);
            this.context.moveTo(cX, cY - radius * 0.45);
            this.context.lineTo(cX, cY + radius * 0.45);
            this.context.stroke();
        }
    }

    drawDyeTracers(solver, pxPerSquare) {
        const radius = Math.max(1.3, pxPerSquare * 0.28);
        this.context.fillStyle = "rgba(235, 235, 255, 0.9)";
        for (const tracer of solver.dyeTracers) {
            if (tracer.x < 0) continue;
            const cX = (tracer.x + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (tracer.y + 0.5)) * pxPerSquare;
            this.context.beginPath();
            this.context.arc(cX, cY, radius, 0, 2 * Math.PI);
            this.context.fill();
        }
    }

    /**
     * @description Desenha cada partícula física ativa (bugs.md #32) com uma forma dependendo
     * de `shapeType` (só estético — a física em si só depende de `weight`, ver
     * `FluidSolver.particlePhysicsFromWeight`): Folha (elipse achatada verde), Bolinha (círculo
     * laranja com um realce, como uma bola sólida) e Caixa (quadrado marrom). O tamanho em tela
     * vem do `radius` gravado na própria partícula (em células), fixado no nascimento a partir
     * do peso da fonte que a gerou.
     */
    drawParticles(solver, pxPerSquare) {
        if (!solver.particles) return;
        for (const p of solver.particles) {
            if (p.x < 0) continue;
            const cX = (p.x + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (p.y + 0.5)) * pxPerSquare;
            const r = Math.max(1.5, p.radius * pxPerSquare);
            this.context.save();
            this.context.translate(cX, cY);
            if (p.shapeType === 'leaf') {
                this.context.fillStyle = '#4ade80';
                this.context.strokeStyle = 'rgba(6, 78, 32, 0.6)';
                this.context.lineWidth = 1;
                this.context.beginPath();
                // Elipse achatada girada conforme a direção do movimento — dá uma sugestão de
                // "flutuando/tombando ao vento" sem precisar simular rotação de verdade.
                const angle = Math.atan2(-p.vy, p.vx);
                this.context.rotate(angle);
                this.context.ellipse(0, 0, r, r * 0.55, 0, 0, 2 * Math.PI);
                this.context.fill();
                this.context.stroke();
            } else if (p.shapeType === 'box') {
                this.context.fillStyle = '#b45309';
                this.context.strokeStyle = 'rgba(60, 24, 4, 0.7)';
                this.context.lineWidth = 1;
                this.context.fillRect(-r, -r, r * 2, r * 2);
                this.context.strokeRect(-r, -r, r * 2, r * 2);
            } else {
                this.context.fillStyle = '#f97316';
                this.context.strokeStyle = 'rgba(67, 20, 7, 0.7)';
                this.context.lineWidth = 1;
                this.context.beginPath();
                this.context.arc(0, 0, r, 0, 2 * Math.PI);
                this.context.fill();
                this.context.stroke();
                // Pequeno realce — sugere volume 3D numa bolinha sólida, sem custar quase nada.
                this.context.fillStyle = 'rgba(255, 255, 255, 0.35)';
                this.context.beginPath();
                this.context.arc(-r * 0.3, -r * 0.3, r * 0.35, 0, 2 * Math.PI);
                this.context.fill();
            }
            this.context.restore();
        }
    }

    /**
     * @description Campo esparso de setas de velocidade (direção real do escoamento em cada
     * célula amostrada) — puramente cosmético, complementa o mapa de cor por magnitude (que,
     * desde a troca pra módulo, não carrega mais sinal/direção). Amostra em grade espaçada
     * (não célula a célula, senão vira ruído visual) e pula Barreira/Rotor (sem velocidade de
     * escoamento própria ali).
     */
    drawVelocityArrows(solver, pxPerSquare) {
        const stride = Math.max(4, Math.round(Math.min(solver.xdim, solver.ydim) / 24));
        const maxLen = stride * pxPerSquare * 0.42;
        const MIN_SPEED_TO_SHOW = 0.008;
        const REF_SPEED = 0.12;
        this.context.save();
        this.context.lineCap = 'round';
        this.context.lineJoin = 'round';
        for (let gy = Math.floor(stride / 2); gy < solver.ydim; gy += stride) {
            for (let gx = Math.floor(stride / 2); gx < solver.xdim; gx += stride) {
                const i = gx + gy * solver.xdim;
                const t = solver.cellType[i];
                if (t === FluidSolver.CELL_TYPE.BARRIER || t === FluidSolver.CELL_TYPE.ROTOR) continue;
                const ux = solver.ux[i],
                    uy = solver.uy[i];
                const speed = Math.sqrt(ux * ux + uy * uy);
                if (speed < MIN_SPEED_TO_SHOW) continue;

                const len = Math.min(maxLen, (speed / REF_SPEED) * maxLen);
                const angle = Math.atan2(-uy, ux);
                const c = this._gridToCanvas(gx, gy, solver.ydim, pxPerSquare);
                const ex = c.x + Math.cos(angle) * len;
                const ey = c.y + Math.sin(angle) * len;
                const headLen = Math.max(3, len * 0.35);
                const hx1 = ex - headLen * Math.cos(angle - Math.PI / 6),
                    hy1 = ey - headLen * Math.sin(angle - Math.PI / 6);
                const hx2 = ex - headLen * Math.cos(angle + Math.PI / 6),
                    hy2 = ey - headLen * Math.sin(angle + Math.PI / 6);

                // "Halo" escuro por baixo (mais grosso) + branco por cima (mais fino) — a seta
                // inteira (haste + cabeça) fica visível em QUALQUER cor de fundo (do azul mais
                // escuro da paleta ao amarelo mais claro), não só onde uma cor sólida contrasta.
                // Sem o halo escuro, a haste (fina, 1px) ficava praticamente invisível em fundo
                // escuro — sobrava só a cabeça branca "flutuando" sem rabo.
                for (const pass of [
                        { color: 'rgba(15,23,32,0.85)', stemWidth: 2.4 },
                        { color: 'rgba(255,255,255,0.95)', stemWidth: 1 }
                    ]) {
                    this.context.strokeStyle = pass.color;
                    this.context.fillStyle = pass.color;
                    this.context.lineWidth = pass.stemWidth;
                    this.context.beginPath();
                    this.context.moveTo(c.x, c.y);
                    this.context.lineTo(ex, ey);
                    this.context.stroke();

                    this.context.beginPath();
                    this.context.moveTo(ex, ey);
                    this.context.lineTo(hx1, hy1);
                    this.context.lineTo(hx2, hy2);
                    this.context.closePath();
                    this.context.fill();
                }
            }
        }
        this.context.restore();
    }

    drawForceArrow(x, y, Fx, Fy, ydim, pxPerSquare) {
        this.context.save();
        this.context.fillStyle = "rgba(200,200,200,0.8)";
        this.context.translate((x + 0.5) * pxPerSquare, (ydim - (y + 0.5)) * pxPerSquare);
        const magF = Math.sqrt(Fx * Fx + Fy * Fy);
        this.context.scale(4 * magF, 4 * magF);
        this.context.rotate(Math.atan2(-Fy, Fx));
        this.context.beginPath();
        this.context.moveTo(0, 3);
        this.context.lineTo(100, 3);
        this.context.lineTo(100, 12);
        this.context.lineTo(130, 0);
        this.context.lineTo(100, -12);
        this.context.lineTo(100, -3);
        this.context.lineTo(0, -3);
        this.context.closePath();
        this.context.fill();
        this.context.restore();
    }

    /**
     * @description Desenha a seta de direção/velocidade de uma Entrada — usada tanto pro
     * arraste ao vivo (recém-desenhada ou sendo reajustada) quanto pra marcar permanentemente
     * cada grupo já criado. `vx`/`vy` estão em unidades de velocidade da simulação.
     */
    drawDirectionHandle(originX, originY, vx, vy, ydim, pxPerSquare, highlight = false) {
        const cX = (originX + 0.5) * pxPerSquare;
        const cY = (ydim - (originY + 0.5)) * pxPerSquare;
        const VELOCITY_TO_PIXELS = 300;
        const endX = cX + vx * VELOCITY_TO_PIXELS;
        const endY = cY - vy * VELOCITY_TO_PIXELS;

        this.context.save();
        // Uma cor sólida só, ponta a ponta (corpo + cabeça + ponto de origem) — laranja/âmbar,
        // não a cor cyan da própria Entrada: a seta fica em cima da célula/linha de Entrada, que
        // já é desenhada nesse mesmo tom de azul, então com a mesma cor ela literalmente
        // desaparecia sempre que apontasse perto do próprio ângulo da forma (ver bugs.md, "não
        // consigo acesso à seta de ajuste").
        const arrowColor = '#f59e0b';
        this.context.strokeStyle = arrowColor;
        this.context.fillStyle = arrowColor;
        this.context.lineWidth = 3;

        if (highlight) {
            this.context.beginPath();
            this.context.arc(cX, cY, 7, 0, 2 * Math.PI);
            this.context.strokeStyle = 'rgba(255, 180, 84, 1)';
            this.context.lineWidth = 2;
            this.context.stroke();
            this.context.strokeStyle = arrowColor;
            this.context.lineWidth = 3;
        }

        this.context.beginPath();
        this.context.moveTo(cX, cY);
        this.context.lineTo(endX, endY);
        this.context.stroke();

        this.context.beginPath();
        this.context.arc(cX, cY, 4, 0, 2 * Math.PI);
        this.context.fill();

        const angle = Math.atan2(endY - cY, endX - cX);
        const headLength = 8;
        this.context.beginPath();
        this.context.moveTo(endX, endY);
        this.context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
        this.context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
        this.context.closePath();
        this.context.fill();
        this.context.stroke();

        // Alça na ponta — sinaliza visualmente que dá pra pegar e arrastar a ponta pra
        // redirecionar o fluxo, não só a origem (ver bugs.md, "selecionar e arrastar a seta").
        this.context.beginPath();
        this.context.arc(endX, endY, 3.5, 0, 2 * Math.PI);
        this.context.strokeStyle = '#ffffff';
        this.context.lineWidth = 1.5;
        this.context.stroke();
        this.context.restore();
    }

    /**
     * @description Marca a seta de cada grupo de Entrada já criado — permanente, igual ao
     * pontinho do pivô do Rotor. O grupo em `editingIndex` (se houver) é pulado aqui, pois o
     * arraste ao vivo (`directionHandle`) já desenha a versão atualizada dele por cima.
     */
    drawSourceGroupHandles(solver, pxPerSquare, ydim, editingIndex = -1) {
        if (!solver.sourceGroups || solver.sourceGroups.length === 0) return;
        for (let i = 0; i < solver.sourceGroups.length; i++) {
            if (i === editingIndex) continue;
            const group = solver.sourceGroups[i];
            this.drawDirectionHandle(group.originX, group.originY, group.vx, group.vy, ydim, pxPerSquare);
        }
    }

    drawSensor(solver, pxPerSquare, escalaVelocidade = 0) {
        const cX = (solver.sensorX + 0.5) * pxPerSquare;
        let cY = (solver.ydim - (solver.sensorY + 0.5)) * pxPerSquare;

        // Desenha o ícone do sensor primeiro
        this.context.fillStyle = "rgba(180,180,180,0.7)";
        this.context.beginPath();
        this.context.arc(cX, cY, 7, 0, 2 * Math.PI);
        this.context.fill();
        this.context.strokeStyle = "#404040";
        this.context.lineWidth = 1;
        this.context.beginPath();
        this.context.moveTo(cX, cY - 10);
        this.context.lineTo(cX, cY + 10);
        this.context.moveTo(cX - 10, cY);
        this.context.lineTo(cX + 10, cY);
        this.context.stroke();

        // Em seguida, desenha o painel de texto sobreposto, centralizado verticalmente com a mira
        this.context.font = "12px Monospace";
        const rectWidth = this.context.measureText(escalaVelocidade > 0 ? "|u| = 1.230 cm/s" : "ux = -0.000").width + 10,
            rectHeight = escalaVelocidade > 0 ? 78 : 62;
        let tX = cX + 26,
            tY = cY - rectHeight / 2;
        if (tX + rectWidth > solver.xdim * pxPerSquare) tX -= (rectWidth + 52);
        if (tY + rectHeight > solver.ydim * pxPerSquare) tY = solver.ydim * pxPerSquare - rectHeight;
        if (tY < 0) tY = 0;

        this.context.fillStyle = "#ffffff"; // Totalmente opaco para não deixar nada por baixo transparecer
        this.context.fillRect(tX, tY, rectWidth, rectHeight);

        // E, por último, o texto
        this.context.fillStyle = "#000000";
        this.context.textAlign = 'left';
        this.context.textBaseline = 'alphabetic';
        tX += 5;
        tY += 12;
        const index = solver.sensorX + solver.sensorY * solver.xdim;
        this.context.fillText(`(${solver.sensorX},${solver.sensorY})`, tX, tY);
        tY += 16;
        this.context.fillText(`ρ = ${solver.rho[index].toFixed(3)}`, tX, tY);
        tY += 16;
        this.context.fillText(`ux = ${solver.ux[index].toFixed(3).padStart(6, ' ')}`, tX, tY);
        tY += 16;
        this.context.fillText(`uy = ${solver.uy[index].toFixed(3).padStart(6, ' ')}`, tX, tY);
        if (escalaVelocidade > 0) {
            tY += 16;
            const ms = Math.hypot(solver.ux[index], solver.uy[index]) * escalaVelocidade;
            this.context.fillText(`|u| = ${formatarVelocidade(ms)}`, tX, tY);
        }
    }

    _drawPreviewShape(activeTool, start, end, ydim, pxPerSquare) {
        let strokeColor = 'rgba(28, 37, 48, 0.7)';
        if (activeTool === 'eraser') {
            strokeColor = 'rgba(255, 150, 150, 0.7)';
        } else if (activeTool === 'select') {
            strokeColor = 'rgba(100, 150, 255, 0.8)';
        }
        this.context.strokeStyle = strokeColor;
        this.context.lineWidth = 1;
        this.context.setLineDash([5, 3]);
        if (activeTool === 'line') {
            this._previewLine(start, end, ydim, pxPerSquare);
        } else if (activeTool.startsWith('ellipse')) {
            // Preview real da elipse (oval) em vez do bounding box quadrado (bugs.md #48).
            this._previewEllipse(start, end, ydim, pxPerSquare);
        } else if (activeTool === 'rounded_rectangle') {
            // Preview com cantos arredondados, igual à forma que será desenhada.
            this._previewRoundedRectangle(start, end, ydim, pxPerSquare);
        } else if (activeTool.startsWith('rectangle') || activeTool === 'eraser' || activeTool === 'select') {
            this._previewRectangle(start, end, ydim, pxPerSquare);
        }
        this.context.setLineDash([]);
        this._drawDimensionLabel(activeTool, start, end, ydim, pxPerSquare);
    }

    /**
     * @private
     * @description Leitura ao vivo das dimensões da forma sendo arrastada (comprimento/ângulo
     * pra linha; largura×altura pras demais) — só informativo, não altera o fluxo de desenho.
     */
    _drawDimensionLabel(activeTool, start, end, ydim, pxPerSquare) {
        let text;
        if (activeTool === 'line') {
            const dx = end.x - start.x,
                dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            text = `${length.toFixed(1)} cél · ${angle.toFixed(0)}°`;
        } else if (activeTool.startsWith('rectangle') || activeTool.startsWith('ellipse') || activeTool === 'rounded_rectangle') {
            const w = Math.abs(end.x - start.x) + 1;
            const h = Math.abs(end.y - start.y) + 1;
            text = `${w} × ${h} cél`;
        } else {
            return;
        }

        const e = this._gridToCanvas(end.x, end.y, ydim, pxPerSquare);
        this.context.font = "12px 'JetBrains Mono', Monospace";
        const paddingX = 7;
        const boxWidth = this.context.measureText(text).width + paddingX * 2;
        const boxHeight = 20;
        const bx = e.x + 14,
            by = e.y - boxHeight - 6;
        this.context.fillStyle = "rgba(16, 20, 27, 0.92)";
        this.context.strokeStyle = "rgba(255, 180, 84, 0.8)";
        this.context.lineWidth = 1;
        this.context.fillRect(bx, by, boxWidth, boxHeight);
        this.context.strokeRect(bx, by, boxWidth, boxHeight);
        this.context.fillStyle = "#ffb454";
        this.context.textAlign = 'left';
        this.context.textBaseline = 'middle';
        this.context.fillText(text, bx + paddingX, by + boxHeight / 2 + 1);
    }

    _previewLine(start, end, ydim, pxPerSquare) {
        const s = this._gridToCanvas(start.x, start.y, ydim, pxPerSquare),
            e = this._gridToCanvas(end.x, end.y, ydim, pxPerSquare);
        this.context.beginPath();
        this.context.moveTo(s.x, s.y);
        this.context.lineTo(e.x, e.y);
        this.context.stroke();
    }

    _previewEllipse(start, end, ydim, pxPerSquare) {
        const x0 = Math.min(start.x, end.x) * pxPerSquare;
        const y0 = (ydim - 1 - Math.max(start.y, end.y)) * pxPerSquare;
        const w = (Math.abs(end.x - start.x) + 1) * pxPerSquare;
        const h = (Math.abs(end.y - start.y) + 1) * pxPerSquare;
        this.context.beginPath();
        this.context.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
        this.context.stroke();
    }

    _previewRoundedRectangle(start, end, ydim, pxPerSquare) {
        const x0 = Math.min(start.x, end.x) * pxPerSquare;
        const y0 = (ydim - 1 - Math.max(start.y, end.y)) * pxPerSquare;
        const w = (Math.abs(end.x - start.x) + 1) * pxPerSquare;
        const h = (Math.abs(end.y - start.y) + 1) * pxPerSquare;
        // Mesmo cálculo de raio que _drawRoundedRectangleOnGrid: 20% do menor lado.
        const r = Math.max(1, Math.floor(Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * 0.2)) * pxPerSquare;
        this.context.beginPath();
        this.context.moveTo(x0 + r, y0);
        this.context.lineTo(x0 + w - r, y0);
        this.context.arcTo(x0 + w, y0, x0 + w, y0 + r, r);
        this.context.lineTo(x0 + w, y0 + h - r);
        this.context.arcTo(x0 + w, y0 + h, x0 + w - r, y0 + h, r);
        this.context.lineTo(x0 + r, y0 + h);
        this.context.arcTo(x0, y0 + h, x0, y0 + h - r, r);
        this.context.lineTo(x0, y0 + r);
        this.context.arcTo(x0, y0, x0 + r, y0, r);
        this.context.closePath();
        this.context.stroke();
    }

    _previewRectangle(start, end, ydim, pxPerSquare) {
        const x = Math.min(start.x, end.x) * pxPerSquare;
        const y = (ydim - 1 - Math.max(start.y, end.y)) * pxPerSquare;
        const w = (Math.abs(end.x - start.x) + 1) * pxPerSquare;
        const h = (Math.abs(end.y - start.y) + 1) * pxPerSquare;
        this.context.strokeRect(x, y, w, h);
    }

    _gridToCanvas(gridX, gridY, ydim, pxPerSquare) {
        return {
            x: (gridX + 0.5) * pxPerSquare,
            y: (ydim - (gridY + 0.5)) * pxPerSquare
        };
    }
}
