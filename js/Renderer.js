import { FluidSolver } from './FluidSolver.js';

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

                if (solver.cellType[index] === FluidSolver.CELL_TYPE.BARRIER) {
                    r = 0;
                    g = 0;
                    b = 0;
                } else if (solver.cellType[index] === FluidSolver.CELL_TYPE.SOURCE) {
                    r = 56;
                    g = 189;
                    b = 248;
                } else if (solver.cellType[index] === FluidSolver.CELL_TYPE.SINK) {
                    r = 255;
                    g = 93;
                    b = 93;
                } else if (solver.cellType[index] === FluidSolver.CELL_TYPE.ROTOR) {
                    r = 167;
                    g = 139;
                    b = 250;
                } else {
                    let value;
                    switch (plotType) {
                        case 0:
                            value = (solver.rho[index] - 1) * 6 * contrast + 0.5;
                            break;
                        case 1:
                            value = solver.ux[index] * 2 * contrast + 0.5;
                            break;
                        case 2:
                            value = solver.uy[index] * 2 * contrast + 0.5;
                            break;
                        case 3:
                            value = Math.sqrt(solver.ux[index] ** 2 + solver.uy[index] ** 2) * 4 * contrast;
                            break;
                        case 4:
                            value = solver.curl[index] * 5 * contrast + 0.5;
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
        this.drawDyeSources(solver, pxPerSquare);
        this.drawDyeTracers(solver, pxPerSquare);
        if (viewState.showTracers) this.drawTracers(solver, pxPerSquare);
        if (viewState.showForce && solver.barrierCount > 0) {
            this.drawForceArrow(
                solver.barrierxSum / solver.barrierCount,
                solver.barrierySum / solver.barrierCount,
                solver.barrierFx, solver.barrierFy, solver.ydim, pxPerSquare
            );
        }
        if (viewState.showSensor) this.drawSensor(solver, pxPerSquare);
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
        this.context.strokeStyle = 'rgba(255,255,255,0.7)';
        this.context.strokeRect(legendX, legendY, legendWidth, legendHeight);
        this.context.fillStyle = 'white';
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
            const cX = (solver.tracerX[t] + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (solver.tracerY[t] + 0.5)) * pxPerSquare;
            this.context.beginPath();
            this.context.arc(cX, cY, radius, 0, 2 * Math.PI);
            this.context.fill();
            this.context.stroke();
        }
    }

    drawDyeSources(solver, pxPerSquare) {
        this.context.fillStyle = "rgba(200, 200, 255, 0.7)";
        for (const source of solver.dyeSources) {
            const cX = (source.x + 0.5) * pxPerSquare;
            const cY = (solver.ydim - (source.y + 0.5)) * pxPerSquare;
            this.context.beginPath();
            this.context.arc(cX, cY, 3, 0, 2 * Math.PI);
            this.context.fill();
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
     * @description Desenha a seta arrastável usada para definir direção/velocidade de uma
     * Entrada recém-desenhada. `vx`/`vy` estão em unidades de velocidade da simulação.
     */
    drawDirectionHandle(originX, originY, vx, vy, ydim, pxPerSquare) {
        const cX = (originX + 0.5) * pxPerSquare;
        const cY = (ydim - (originY + 0.5)) * pxPerSquare;
        const VELOCITY_TO_PIXELS = 300;
        const endX = cX + vx * VELOCITY_TO_PIXELS;
        const endY = cY - vy * VELOCITY_TO_PIXELS;

        this.context.save();
        this.context.strokeStyle = '#38bdf8';
        this.context.fillStyle = '#38bdf8';
        this.context.lineWidth = 2;

        this.context.beginPath();
        this.context.arc(cX, cY, 4, 0, 2 * Math.PI);
        this.context.fill();

        this.context.beginPath();
        this.context.moveTo(cX, cY);
        this.context.lineTo(endX, endY);
        this.context.stroke();

        const angle = Math.atan2(endY - cY, endX - cX);
        const headLength = 8;
        this.context.beginPath();
        this.context.moveTo(endX, endY);
        this.context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
        this.context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
        this.context.closePath();
        this.context.fill();
        this.context.restore();
    }

    drawSensor(solver, pxPerSquare) {
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
        const rectWidth = this.context.measureText("ux = -0.000").width + 10,
            rectHeight = 62;
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
    }

    _drawPreviewShape(activeTool, start, end, ydim, pxPerSquare) {
        let strokeColor = 'rgba(255, 255, 255, 0.7)';
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
        } else if (activeTool.startsWith('rectangle') || activeTool.startsWith('ellipse') || activeTool === 'rounded_rectangle' || activeTool === 'eraser' || activeTool === 'select') {
            this._previewRectangle(start, end, ydim, pxPerSquare);
        }
        this.context.setLineDash([]);
    }

    _previewLine(start, end, ydim, pxPerSquare) {
        const s = this._gridToCanvas(start.x, start.y, ydim, pxPerSquare),
            e = this._gridToCanvas(end.x, end.y, ydim, pxPerSquare);
        this.context.beginPath();
        this.context.moveTo(s.x, s.y);
        this.context.lineTo(e.x, e.y);
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
