import { FluidSolver } from './FluidSolver.js';
import { Renderer } from './Renderer.js';

/**
 * @class FluidSimulationApp
 * @description Controlador da aplicação: DOM, ferramentas de edição, undo/redo e
 * import/export de configuração. Orquestra um FluidSolver (física) e um Renderer (canvas).
 */
export class FluidSimulationApp {
    /**
     * @constructor
     * @param {string} containerSelector - O seletor CSS para o elemento principal da aplicação.
     */
    constructor(containerSelector) {
        this.root = document.querySelector(containerSelector);
        if (!this.root) {
            throw new Error(`Container com seletor "${containerSelector}" não foi encontrado.`);
        }

        this._queryElements();
        if (!this.canvas.getContext) {
            throw new Error('Seu navegador não suporta o elemento canvas, que é essencial para esta aplicação.');
        }
        this._initializeState();
        this._setupCanvas();
        this._bindEventListeners();
        this._initSliderFills();
        this._requestPaint();
    }

    /**
     * @private
     * @description Seleciona e armazena referências a todos os elementos do DOM necessários.
     */
    _queryElements() {
        this.canvasContainer = this.root.querySelector('#canvas-container');
        this.canvas = this.root.querySelector('#theCanvas');
        this.toolButtons = this.root.querySelectorAll('.tool-button');
        this.startButton = document.querySelector('#startButton');
        this.resetFluidButton = document.querySelector('#resetFluidButton');
        this.stepButton = document.querySelector('#stepButton');
        this.clearButton = document.querySelector('#clearButton');
        this.undoButton = document.querySelector('#undoButton');
        this.redoButton = document.querySelector('#redoButton');
        this.importButton = document.querySelector('#importButton');
        this.exportButton = document.querySelector('#exportButton');
        this.screenshotButton = document.querySelector('#screenshotButton');
        this.sizeSelect = this.root.querySelector('#sizeSelect');
        this.stepsSlider = this.root.querySelector('#stepsSlider');
        this.viscSlider = this.root.querySelector('#viscSlider');
        this.viscValue = this.root.querySelector('#viscValue');
        this.viscosityPresetSelect = this.root.querySelector('#viscosityPresetSelect');
        this.viscosityHelp = this.root.querySelector('#viscosityHelp');
        this.visualizationHelp = this.root.querySelector('#visualizationHelp');
        this.plotSelect = this.root.querySelector('#plotSelect');
        this.contrastSlider = this.root.querySelector('#contrastSlider');
        this.tracerCheck = this.root.querySelector('#tracerCheck');
        this.forceCheck = this.root.querySelector('#forceCheck');
        this.sensorCheck = this.root.querySelector('#sensorCheck');
        this.speedReadout = this.root.querySelector('#speedReadout');
        this.toolOptionsPanel = this.root.querySelector('#tool-options-panel');
        this.sprayOptions = this.root.querySelector('#spray-options');
        this.spraySizeSlider = this.root.querySelector('#spraySizeSlider');
        this.spraySizeValue = this.root.querySelector('#spraySizeValue');
        this.selectionOptionsPanel = this.root.querySelector('#selection-options-panel');
        this.copySelectionButton = this.root.querySelector('#copySelectionButton');
        this.cutSelectionButton = this.root.querySelector('#cutSelectionButton');
        this.flipHorizontalButton = this.root.querySelector('#flipHorizontalButton');
        this.flipVerticalButton = this.root.querySelector('#flipVerticalButton');
        this.deleteSelectionButton = this.root.querySelector('#deleteSelectionButton');
        this.clearSelectionButton = this.root.querySelector('#clearSelectionButton');
        this.rotate90Button = this.root.querySelector('#rotate90Button');
        this.rotate180Button = this.root.querySelector('#rotate180Button');
        this.rotate270Button = this.root.querySelector('#rotate270Button');
        this.speedSlider = this.root.querySelector('#speedSlider');
        this.speedValue = this.root.querySelector('#speedValue');
        this.speedHelp = this.root.querySelector('#speedHelp');
    }

    /**
     * @private
     * @description Inicializa o estado de UI/ferramentas (a física fica no FluidSolver).
     */
    _initializeState() {
        this.running = false;
        this.stepCount = 0;
        this.startTime = 0;
        this.draggingSensor = false;
        this.mouseIsDown = false;
        this.mouseGridPos = {
            x: -1,
            y: -1
        };
        this.time = 0;
        this.activeTool = 'brush';
        this.lastDrawPoint = null;
        this.toolStartPoint = null;
        this.selectionArea = null;
        this.clipboard = null;
        this.pastePreviewOrigin = null;
        this.undoStack = [];
        this.redoStack = [];
        this.isCanvasDirty = true;
        this.animationFrameId = null;
        this.simulationTimeout = null;
        this.resizeTimeout = null;
        this.resizeObserver = null;
    }

    /**
     * @private
     * @description Cria o renderer e inicializa a simulação pela primeira vez.
     */
    _setupCanvas() {
        this.renderer = new Renderer(this.canvas);
        this._resetSimulation();
    }

    /**
     * @private
     * @description Associa todos os listeners de eventos aos elementos do DOM.
     */
    _bindEventListeners() {
        this.startButton.addEventListener('click', () => this.startStop());
        this.resetFluidButton.addEventListener('click', () => this.initFluid());
        this.stepButton.addEventListener('click', () => this.simulateSingleStep());
        this.clearButton.addEventListener('click', () => {
            this._saveState();
            this.clearBarriers();
        });
        this.undoButton.addEventListener('click', () => this.undo());
        this.redoButton.addEventListener('click', () => this.redo());
        this.importButton.addEventListener('click', () => this._importConfiguration());
        this.exportButton.addEventListener('click', () => this._exportConfiguration());
        this.screenshotButton.addEventListener('click', () => this._takeScreenshot());
        this.viscosityHelp.addEventListener('click', () => this._showViscosityHelp());
        this.visualizationHelp.addEventListener('click', () => this._showVisualizationHelp());
        this.speedHelp.addEventListener('click', () => this._showSpeedHelp());
        this.copySelectionButton.addEventListener('click', () => this._copySelection());
        this.cutSelectionButton.addEventListener('click', () => this._cutSelection());
        this.flipHorizontalButton.addEventListener('click', () => this._flipSelectionHorizontal());
        this.flipVerticalButton.addEventListener('click', () => this._flipSelectionVertical());
        this.deleteSelectionButton.addEventListener('click', () => this._deleteSelection());
        this.clearSelectionButton.addEventListener('click', () => this._clearSelection());
        this.rotate90Button.addEventListener('click', () => this._rotateSelection(90));
        this.rotate180Button.addEventListener('click', () => this._rotateSelection(180));
        this.rotate270Button.addEventListener('click', () => this._rotateSelection(270));
        this.sizeSelect.addEventListener('change', () => this._handleResolutionChange());
        this.viscSlider.addEventListener('input', () => this.adjustViscosity());
        this.viscosityPresetSelect.addEventListener('change', () => this._applyViscosityPreset());
        this.plotSelect.addEventListener('change', () => {
            this._requestPaint();
        });
        this.contrastSlider.addEventListener('input', () => {
            this._requestPaint();
        });
        this.tracerCheck.addEventListener('change', () => {
            this.solver.initTracers(this.tracerCheck.checked);
            this._requestPaint();
        });
        this.forceCheck.addEventListener('change', () => this._requestPaint());
        this.sensorCheck.addEventListener('change', () => this._requestPaint());
        this.spraySizeSlider.addEventListener('input', () => {
            this.spraySizeValue.textContent = this.spraySizeSlider.value;
        });
        this.speedSlider.addEventListener('input', () => this.adjustSpeed());

        this._setupResizeObserver();
        this.toolButtons.forEach(button => {
            button.addEventListener('click', () => this._setActiveTool(button.dataset.tool));
        });
        this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseleave', this._handleMouseLeave.bind(this));
        document.body.addEventListener('mouseup', this._handleMouseUp.bind(this));
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                this.redo();
            }
            if (e.key === 'Escape') {
                if (this.clipboard) this._clearClipboard();
                if (this.selectionArea) this._clearSelection();
            }
        });
    }

    /**
     * @private
     * @description Configura um ResizeObserver para redesenhar o canvas quando o contêiner mudar de tamanho.
     */
    _setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(() => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this._handleContainerResize(), 100);
        });
        this.resizeObserver.observe(this.canvasContainer);
    }

    /**
     * @private
     * @description Lida com o redimensionamento do contêiner do canvas.
     */
    _handleContainerResize() {
        this.canvas.width = this.canvasContainer.clientWidth;
        this.canvas.height = this.canvasContainer.clientHeight;
        this._requestPaint();
    }

    /**
     * @private
     * @description Sincroniza a variável CSS `--fill` de cada slider com seu valor atual,
     * para que o trilho apareça preenchido até a posição do thumb.
     */
    _initSliderFills() {
        this.root.querySelectorAll('input[type="range"]').forEach(slider => {
            this._updateSliderFill(slider);
            slider.addEventListener('input', () => this._updateSliderFill(slider));
        });
    }

    _updateSliderFill(slider) {
        const min = Number(slider.min) || 0;
        const max = Number(slider.max) || 100;
        const pct = max > min ? ((Number(slider.value) - min) / (max - min)) * 100 : 0;
        slider.style.setProperty('--fill', `${pct}%`);
    }

    _refreshAllSliderFills() {
        this.root.querySelectorAll('input[type="range"]').forEach(slider => this._updateSliderFill(slider));
    }

    /**
     * @private
     * @description Solicita um novo quadro de animação para redesenhar o canvas.
     * Otimiza o processo para evitar redesenhos desnecessários.
     */
    _requestPaint() {
        this.isCanvasDirty = true;
        if (!this.animationFrameId) {
            this.animationFrameId = requestAnimationFrame(this._paintLoop.bind(this));
        }
    }

    /**
     * @private
     * @description O loop de renderização principal. Ele só executa a pintura se o canvas
     * estiver "sujo" e continua a se auto-agendar se a simulação estiver rodando.
     */
    _paintLoop() {
        this.animationFrameId = null;

        if (this.isCanvasDirty) {
            this.paintCanvas();
            this.isCanvasDirty = false;
        }

        if (this.running) {
            this.animationFrameId = requestAnimationFrame(this._paintLoop.bind(this));
        }
    }

    /**
     * @private
     * @description Confirma com o usuário antes de alterar a resolução, pois isso reseta a simulação.
     */
    async _handleResolutionChange() {
        const result = await Swal.fire({
            title: 'Confirmar Alteração de Resolução?',
            text: "Esta ação limpará todas as barreiras e a área de transferência. Deseja continuar?",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, alterar',
            cancelButtonText: 'Cancelar'
        });
        if (result.isConfirmed) {
            this._resetSimulation();
        } else {
            this.sizeSelect.value = this.pxPerSquare;
        }
    }

    /**
     * @private
     * @description Reseta toda a simulação para um estado inicial com base na resolução selecionada.
     */
    _resetSimulation() {
        this.pxPerSquare = Number(this.sizeSelect.value);
        const xdim = Math.floor((this.canvasContainer.clientWidth - Renderer.RULER_SIZE) / this.pxPerSquare);
        const ydim = Math.floor((this.canvasContainer.clientHeight - Renderer.RULER_SIZE) / this.pxPerSquare);
        this.canvas.width = this.canvasContainer.clientWidth;
        this.canvas.height = this.canvasContainer.clientHeight;

        this.solver = new FluidSolver(xdim, ydim);
        this.solver.initFluid(Number(this.speedSlider.value));
        this.solver.initTracers(this.tracerCheck.checked);
        this.solver.initDyeTracers();

        this.undoStack = [];
        this.redoStack = [];

        this._clearSelection();
        this._clearClipboard();
        this._setActiveTool('brush'); // Garante estado de UI consistente

        this._saveState();
        this._requestPaint();
    }

    /**
     * @private
     * @param {string} toolName - O nome da ferramenta a ser ativada.
     * @description Ativa a ferramenta de desenho selecionada e atualiza a UI.
     */
    _setActiveTool(toolName) {
        this._clearSelection();
        this._clearClipboard();
        this.activeTool = toolName;
        this.toolButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tool === toolName);
        });

        const showToolOptions = (toolName === 'spray');
        this.toolOptionsPanel.hidden = !showToolOptions;
        this.sprayOptions.hidden = !showToolOptions;
    }

    _handleMouseDown(e) {
        e.preventDefault();
        const canvasLoc = this.pageToCanvas(e.pageX, e.pageY);
        const gridLoc = this.canvasToGrid(canvasLoc.x, canvasLoc.y);

        if (this.clipboard) {
            this._pasteSelection(gridLoc);
            return;
        }

        this.mouseIsDown = true;
        this.toolStartPoint = gridLoc;

        if (this.sensorCheck.checked && gridLoc.x >= 0 && gridLoc.y >= 0) {
            const dx = (gridLoc.x - this.solver.sensorX) * this.pxPerSquare;
            const dy = (gridLoc.y - this.solver.sensorY) * this.pxPerSquare;
            if (Math.sqrt(dx * dx + dy * dy) <= 8) {
                this.draggingSensor = true;
            }
        }

        if (this.draggingSensor) {
            this.solver.sensorX = gridLoc.x;
            this.solver.sensorY = gridLoc.y;
            this._requestPaint();
            return;
        }

        if (['brush', 'spray', 'fill', 'smoke'].includes(this.activeTool)) {
            this._saveState();
        }

        switch (this.activeTool) {
            case 'brush':
                this.setCell(gridLoc.x, gridLoc.y, FluidSolver.CELL_TYPE.BARRIER);
                this.lastDrawPoint = gridLoc;
                break;
            case 'spray':
                this._applySpray(gridLoc);
                break;
            case 'fill':
                this._floodFill(gridLoc.x, gridLoc.y);
                break;
            case 'smoke':
                if (gridLoc.x >= 0 && gridLoc.y >= 0) {
                    this.solver.dyeSources.push({
                        x: gridLoc.x,
                        y: gridLoc.y
                    });
                }
                break;
        }
        this._requestPaint();
    }
    _handleMouseMove(e) {
        e.preventDefault();
        const canvasLoc = this.pageToCanvas(e.pageX, e.pageY);
        this.mouseGridPos = this.canvasToGrid(canvasLoc.x, canvasLoc.y);

        if (this.clipboard) {
            this.pastePreviewOrigin = this.mouseGridPos;
        } else if (this.mouseIsDown) {
            if (this.draggingSensor) {
                this.solver.sensorX = this.mouseGridPos.x;
                this.solver.sensorY = this.mouseGridPos.y;
            } else if (this.activeTool === 'brush' && this.lastDrawPoint) {
                if (this.mouseGridPos.x !== this.lastDrawPoint.x || this.mouseGridPos.y !== this.lastDrawPoint.y) {
                    this._drawLineOnGrid(this.lastDrawPoint, this.mouseGridPos, (x, y) => this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER));
                    this.lastDrawPoint = this.mouseGridPos;
                }
            } else if (this.activeTool === 'spray') {
                this._applySpray(this.mouseGridPos);
            }
        }
        this._requestPaint();
    }
    _handleMouseLeave(e) {
        this.mouseGridPos = {
            x: -1,
            y: -1
        };
        this.pastePreviewOrigin = null;
        this._requestPaint();
    }
    _handleMouseUp(e) {
        if (!this.mouseIsDown) return;
        e.preventDefault();

        if (this.toolStartPoint && !this.draggingSensor) {
            const endPoint = this.mouseGridPos;
            if (this.activeTool === 'select') {
                this.selectionArea = {
                    start: this.toolStartPoint,
                    end: endPoint
                };
                this.selectionOptionsPanel.hidden = false;
            } else if (!['brush', 'spray', 'fill', 'smoke'].includes(this.activeTool)) {
                this._saveState();
                switch (this.activeTool) {
                    case 'line':
                        this._drawLineOnGrid(this.toolStartPoint, endPoint, (x, y) => this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER));
                        break;
                    case 'rectangle_filled':
                        this._drawRectangleOnGrid(this.toolStartPoint, endPoint, true);
                        break;
                    case 'ellipse_filled':
                        this._drawEllipseOnGrid(this.toolStartPoint, endPoint, true);
                        break;
                    case 'rectangle_outline':
                        this._drawRectangleOnGrid(this.toolStartPoint, endPoint, false);
                        break;
                    case 'ellipse_outline':
                        this._drawEllipseOnGrid(this.toolStartPoint, endPoint, false);
                        break;
                    case 'rounded_rectangle':
                        this._drawRoundedRectangleOnGrid(this.toolStartPoint, endPoint);
                        break;
                    case 'eraser':
                        this._eraseRectangleOnGrid(this.toolStartPoint, endPoint);
                        break;
                }
            }
        }
        this._requestPaint();
        this.mouseIsDown = false;
        this.draggingSensor = false;
        this.lastDrawPoint = null;
        this.toolStartPoint = null;
    }
    _applySpray(center) {
        const radius = Number(this.spraySizeSlider.value);
        const density = 10;
        for (let i = 0; i < density; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const r = Math.random() * radius;
            const x = Math.round(center.x + r * Math.cos(angle));
            const y = Math.round(center.y + r * Math.sin(angle));
            this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER);
        }
    }
    _floodFill(startX, startY) {
        const xdim = this.solver.xdim,
            ydim = this.solver.ydim;
        if (startX < 0 || startX >= xdim || startY < 0 || startY >= ydim) return;
        const initialType = this.solver.cellType[startX + startY * xdim];
        if (initialType === FluidSolver.CELL_TYPE.BARRIER) return;
        const queue = [{
            x: startX,
            y: startY
        }];
        const visited = new Set();
        visited.add(`${startX},${startY}`);
        let iterations = 0;
        const MAX_ITERATIONS = 10000; // Limite de segurança mais conservador
        while (queue.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;
            const {
                x,
                y
            } = queue.shift();
            this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER);
            const neighbors = [{
                dx: 0,
                dy: 1
            }, {
                dx: 0,
                dy: -1
            }, {
                dx: 1,
                dy: 0
            }, {
                dx: -1,
                dy: 0
            }];
            for (const neighbor of neighbors) {
                const nextX = x + neighbor.dx;
                const nextY = y + neighbor.dy;
                const key = `${nextX},${nextY}`;
                if (visited.has(key)) continue;
                if (nextX >= 0 && nextX < xdim && nextY >= 0 && nextY < ydim) {
                    if (this.solver.cellType[nextX + nextY * xdim] === initialType) {
                        visited.add(key);
                        queue.push({
                            x: nextX,
                            y: nextY
                        });
                    }
                }
            }
        }
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
    }
    _drawLineOnGrid(start, end, actionCallback) {
        let x0 = start.x,
            y0 = start.y;
        const x1 = end.x,
            y1 = end.y;
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
    _drawRectangleOnGrid(start, end, filled) {
        const x_start = Math.min(start.x, end.x),
            x_end = Math.max(start.x, end.x);
        const y_start = Math.min(start.y, end.y),
            y_end = Math.max(start.y, end.y);
        for (let x = x_start; x <= x_end; x++) {
            for (let y = y_start; y <= y_end; y++) {
                if (filled || x === x_start || x === x_end || y === y_start || y === y_end) this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER);
            }
        }
    }
    _drawEllipseOnGrid(start, end, filled) {
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
                    if (norm_dist_sq <= 1) this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER);
                } else {
                    if (norm_dist_sq <= 1 && norm_dist_sq > 0.8) this.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER);
                }
            }
        }
    }
    _drawRoundedRectangleOnGrid(start, end) {
        const x0 = Math.min(start.x, end.x);
        const y0 = Math.min(start.y, end.y);
        const x1 = Math.max(start.x, end.x);
        const y1 = Math.max(start.y, end.y);
        let r = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) * 0.2));
        for (let x = x0 + r; x <= x1 - r; x++) {
            this.setCell(x, y0, FluidSolver.CELL_TYPE.BARRIER);
            this.setCell(x, y1, FluidSolver.CELL_TYPE.BARRIER);
        }
        for (let y = y0 + r; y <= y1 - r; y++) {
            this.setCell(x0, y, FluidSolver.CELL_TYPE.BARRIER);
            this.setCell(x1, y, FluidSolver.CELL_TYPE.BARRIER);
        }
        for (let a = Math.PI; a < 1.5 * Math.PI; a += 0.1 / r) this.setCell(x0 + r + Math.round(r * Math.cos(a)), y0 + r + Math.round(r * Math.sin(a)), FluidSolver.CELL_TYPE.BARRIER);
        for (let a = 1.5 * Math.PI; a < 2 * Math.PI; a += 0.1 / r) this.setCell(x1 - r + Math.round(r * Math.cos(a)), y0 + r + Math.round(r * Math.sin(a)), FluidSolver.CELL_TYPE.BARRIER);
        for (let a = 0; a < 0.5 * Math.PI; a += 0.1 / r) this.setCell(x1 - r + Math.round(r * Math.cos(a)), y1 - r + Math.round(r * Math.sin(a)), FluidSolver.CELL_TYPE.BARRIER);
        for (let a = 0.5 * Math.PI; a < Math.PI; a += 0.1 / r) this.setCell(x0 + r + Math.round(r * Math.cos(a)), y1 - r + Math.round(r * Math.sin(a)), FluidSolver.CELL_TYPE.BARRIER);
    }
    _eraseRectangleOnGrid(start, end) {
        const x_start = Math.min(start.x, end.x),
            x_end = Math.max(start.x, end.x);
        const y_start = Math.min(start.y, end.y),
            y_end = Math.max(start.y, end.y);
        for (let x = x_start; x <= x_end; x++) {
            for (let y = y_start; y <= y_end; y++) {
                this.setCell(x, y, FluidSolver.CELL_TYPE.NORMAL);
            }
        }
        this.solver.dyeSources = this.solver.dyeSources.filter(source => source.x < x_start || source.x > x_end || source.y < y_start || source.y > y_end);
    }

    /**
     * @description O loop principal que avança a simulação no tempo.
     * Executa os passos de colisão, propagação e atualização de contornos.
     */
    async runSimulation() {
        if (!this.running) return;

        const frameStart = performance.now();
        const stepsPerFrame = Number(this.stepsSlider.value);
        const u0 = Number(this.speedSlider.value);
        const viscosity = Number(this.viscSlider.value);
        const moveTracers = this.tracerCheck.checked;
        for (let s = 0; s < stepsPerFrame; s++) {
            this.solver.step({
                u0,
                viscosity,
                moveTracers
            });
            this.time++;
        }

        if (!this.solver.checkStability()) {
            this.startStop();
            const result = await Swal.fire({
                title: 'Simulação Instável!',
                html: 'A simulação se tornou numericamente instável (e.g., densidade negativa, velocidade infinita).<br><br>Isso geralmente ocorre com <strong>baixa viscosidade</strong> e/ou <strong>alta velocidade</strong>. Tente diminuir a velocidade ou aumentar a viscosidade.<br><br>Deseja resetar o fluido?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sim, resetar',
                cancelButtonText: 'Não'
            });
            if (result.isConfirmed) this.initFluid();
            return;
        }

        this._requestPaint();

        this.stepCount += stepsPerFrame;
        const elapsedTime = (new Date().getTime() - this.startTime) / 1000;
        this.speedReadout.innerHTML = (this.stepCount / elapsedTime || 0).toFixed(0);

        if (this.running) {
            const frameTime = performance.now() - frameStart;
            const delay = Math.max(0, 16 - frameTime); // Mantém ~60 FPS
            this.simulationTimeout = setTimeout(() => this.runSimulation(), delay);
        }
    }

    /**
     * @description Executa um único passo de tempo da simulação.
     */
    simulateSingleStep() {
        if (this.running) this.startStop();
        this.solver.step({
            u0: Number(this.speedSlider.value),
            viscosity: Number(this.viscSlider.value),
            moveTracers: this.tracerCheck.checked
        });
        this._requestPaint();
    }

    paintCanvas() {
        this.renderer.render(this.solver, this.pxPerSquare, this._buildViewState());
    }

    /**
     * @private
     * @description Monta o objeto de estado de visualização consumido pelo Renderer.
     */
    _buildViewState() {
        return {
            plotIndex: this.plotSelect.selectedIndex,
            plotLabel: this.plotSelect.options[this.plotSelect.selectedIndex].text,
            contrast: this.contrastSlider.value,
            showTracers: this.tracerCheck.checked,
            showForce: this.forceCheck.checked,
            showSensor: this.sensorCheck.checked,
            activeTool: this.activeTool,
            toolStartPoint: this.toolStartPoint,
            mouseIsDown: this.mouseIsDown,
            mouseGridPos: this.mouseGridPos,
            selectionArea: this.selectionArea,
            clipboard: this.clipboard,
            pastePreviewOrigin: this.pastePreviewOrigin
        };
    }

    startStop() {
        this.running = !this.running;
        if (this.running) {
            this.startButton.innerHTML = `<i class="fa-solid fa-pause"></i> Pausar`;
            this.resetTimer();
            this.runSimulation();
            this._requestPaint(); // Inicia o loop de pintura
        } else {
            this.startButton.innerHTML = `<i class="fa-solid fa-play"></i> Iniciar`;
            clearTimeout(this.simulationTimeout);
        }
    }
    initFluid() {
        this.solver.initFluid(Number(this.speedSlider.value));
        this._requestPaint();
    }
    resetTimer() {
        this.stepCount = 0;
        this.startTime = new Date().getTime();
    }
    adjustSpeed() {
        this.speedValue.innerHTML = Number(this.speedSlider.value).toFixed(3);
        if (!this.running) {
            this.initFluid();
        }
    }
    adjustViscosity() {
        this.viscValue.innerHTML = Number(this.viscSlider.value).toFixed(3);
    }
    _applyViscosityPreset() {
        const selectedIndex = this.viscosityPresetSelect.selectedIndex;
        if (selectedIndex === 0) return;
        this.viscSlider.value = this.viscosityPresetSelect.options[selectedIndex].dataset.viscosity;
        this.adjustViscosity();
        this._updateSliderFill(this.viscSlider);
        this.viscosityPresetSelect.selectedIndex = 0;
    }
    clearBarriers() {
        this.solver.cellType.fill(FluidSolver.CELL_TYPE.NORMAL);
        this.solver.dyeSources = [];
        this.initFluid();
    }

    _getSelectionBounds() {
        if (!this.selectionArea) return null;
        const x_start = Math.min(this.selectionArea.start.x, this.selectionArea.end.x);
        const x_end = Math.max(this.selectionArea.start.x, this.selectionArea.end.x);
        const y_start = Math.min(this.selectionArea.start.y, this.selectionArea.end.y);
        const y_end = Math.max(this.selectionArea.start.y, this.selectionArea.end.y);
        return {
            x_start,
            x_end,
            y_start,
            y_end
        };
    }
    _copySelection() {
        if (!this.selectionArea) return;
        const bounds = this._getSelectionBounds();
        const cells = [];
        for (let x = bounds.x_start; x <= bounds.x_end; x++) {
            for (let y = bounds.y_start; y <= bounds.y_end; y++) {
                const type = this.solver.cellType[x + y * this.solver.xdim];
                if (type !== FluidSolver.CELL_TYPE.NORMAL) {
                    cells.push({
                        x: x - bounds.x_start,
                        y: y - bounds.y_start,
                        type: type
                    });
                }
            }
        }
        this.clipboard = {
            width: bounds.x_end - bounds.x_start + 1,
            height: bounds.y_end - bounds.y_start + 1,
            cells: cells
        };
        this._clearSelection();
        this.canvas.style.cursor = 'copy';
    }
    _cutSelection() {
        if (!this.selectionArea) return;
        this._copySelection();
        this._deleteSelection(false);
    }
    _pasteSelection(origin) {
        if (!this.clipboard) return;
        this._saveState();
        for (const p of this.clipboard.cells) {
            this.setCell(origin.x + p.x, origin.y + p.y, p.type);
        }
        this.initFluid();
    }
    _flipSelectionHorizontal() {
        this._transformSelection((x, y, b) => ({
            newX: b.x_start + b.x_end - x,
            newY: y
        }));
    }
    _flipSelectionVertical() {
        this._transformSelection((x, y, b) => ({
            newX: x,
            newY: b.y_start + b.y_end - y
        }));
    }
    _rotateSelection(degrees) {
        if (!this.selectionArea) return;
        this._saveState();
        const bounds = this._getSelectionBounds();
        const centerX = (bounds.x_start + bounds.x_end) / 2;
        const centerY = (bounds.y_start + bounds.y_end) / 2;
        const newCells = [];
        for (let x = bounds.x_start; x <= bounds.x_end; x++) {
            for (let y = bounds.y_start; y <= bounds.y_end; y++) {
                const type = this.solver.cellType[x + y * this.solver.xdim];
                if (type !== FluidSolver.CELL_TYPE.NORMAL) {
                    const dx = x - centerX;
                    const dy = y - centerY;
                    let newX, newY;
                    if (degrees === 90) {
                        newX = Math.round(centerX - dy);
                        newY = Math.round(centerY + dx);
                    } else if (degrees === 180) {
                        newX = Math.round(centerX - dx);
                        newY = Math.round(centerY - dy);
                    } else if (degrees === 270) {
                        newX = Math.round(centerX + dy);
                        newY = Math.round(centerY - dx);
                    }
                    if (newX >= 0 && newX < this.solver.xdim && newY >= 0 && newY < this.solver.ydim) {
                        newCells.push({
                            x: newX,
                            y: newY,
                            type: type
                        });
                    }
                }
            }
        }
        this._deleteSelection(false);
        for (const p of newCells) {
            this.setCell(p.x, p.y, p.type);
        }
        this.initFluid();
    }
    _transformSelection(transformFunc) {
        if (!this.selectionArea) return;
        this._saveState();
        const bounds = this._getSelectionBounds();
        const newCells = [];
        for (let x = bounds.x_start; x <= bounds.x_end; x++) {
            for (let y = bounds.y_start; y <= bounds.y_end; y++) {
                const type = this.solver.cellType[x + y * this.solver.xdim];
                if (type !== FluidSolver.CELL_TYPE.NORMAL) {
                    const {
                        newX,
                        newY
                    } = transformFunc(x, y, bounds);
                    newCells.push({
                        x: newX,
                        y: newY,
                        type: type
                    });
                }
            }
        }
        this._deleteSelection(false);
        for (const p of newCells) {
            this.setCell(p.x, p.y, p.type);
        }
        this.initFluid();
    }
    _deleteSelection(saveState = true) {
        if (!this.selectionArea) return;
        if (saveState) this._saveState();
        this._eraseRectangleOnGrid(this.selectionArea.start, this.selectionArea.end);
        this._clearSelection();
        this.initFluid();
    }
    _clearSelection() {
        if (this.selectionArea) {
            this.selectionArea = null;
            this.selectionOptionsPanel.hidden = true;
            this._requestPaint();
        }
    }
    _clearClipboard() {
        this.clipboard = null;
        this.pastePreviewOrigin = null;
        this.canvas.style.cursor = 'crosshair';
    }
    _showViscosityHelp() {
        Swal.fire({
            title: 'Valores de Referência de Viscosidade',
            html: `<p>A viscosidade nesta simulação é um parâmetro adimensional. Use os valores abaixo como ponto de partida.</p><table><thead><tr><th>Fluido (a 20°C)</th><th>Viscosidade (Aprox.)</th></tr></thead><tbody><tr><td>Ar</td><td>0.010 - 0.020</td></tr><tr><td>Água</td><td>0.020 - 0.040</td></tr><tr><td>Mercúrio</td><td>0.050 - 0.080</td></tr><tr><td>Mel</td><td>0.100 - 0.150</td></tr><tr><td>Óleo de Motor</td><td>0.150 - 0.200</td></tr></tbody></table><small>Fonte: Valores adaptados para esta simulação. Para dados reais, consulte <a href="https://www.engineersedge.com/fluid_flow/kinematic-viscosity-table.htm" target="_blank">recursos de engenharia</a>.</small>`,
            icon: 'info'
        });
    }
    _showSpeedHelp() {
        const u0 = Number(this.speedSlider.value);
        const speed_scaling_factor = 150;
        const speed_ms = u0 * speed_scaling_factor;
        const speed_kmh = speed_ms * 3.6;
        Swal.fire({
            title: 'Equivalência da Velocidade do Fluxo',
            icon: 'info',
            html: ` <p>A velocidade na simulação (<strong>${u0.toFixed(3)}</strong>) é um valor adimensional. Para correlacioná-la com o mundo real, precisamos fazer algumas suposições sobre a escala.</p> <table> <thead><tr><th>Velocidade Atual (Aprox.)</th></tr></thead> <tbody> <tr><td><strong>${speed_ms.toFixed(1)} m/s</strong></td></tr> <tr><td><strong>${speed_kmh.toFixed(1)} km/h</strong></td></tr> </tbody> </table> <div class="note"> <strong>Nota sobre a escala:</strong> Esta conversão assume que um objeto como o aerofólio (com ~40 células de largura) mede 1 metro na vida real, e que o fator de escala temporal da simulação resulta em uma multiplicação por ${speed_scaling_factor}. Altere este fator no código para ajustar a calibração para diferentes cenários. </div>`
        });
    }
    _showVisualizationHelp() {
        Swal.fire({
            title: 'Entendendo as Visualizações',
            icon: 'info',
            html: ` <p>As cores no canvas representam uma propriedade física do fluido em cada ponto. A legenda no canto inferior direito do canvas é atualizada com base na sua seleção.</p> <ul> <li><strong>Densidade:</strong> Mostra a pressão do fluido. <br><em>Vermelho = Alta Pressão</em>, <em>Azul = Baixa Pressão</em>.</li> <li><strong>Velocidade X:</strong> Componente horizontal da velocidade. <br><em>Vermelho = Direita</em>, <em>Azul = Esquerda</em>.</li> <li><strong>Velocidade Y:</strong> Componente vertical da velocidade. <br><em>Vermelho = Cima</em>, <em>Azul = Baixo</em>.</li> <li><strong>Velocidade (módulo):</strong> Magnitude total da velocidade. <br><em>Vermelho = Rápido</em>, <em>Azul = Lento</em>.</li> <li><strong>Rotação (Curl):</strong> Mede a "vorticidade" ou giro do fluido. É ideal para ver vórtices e turbulência. <br><em>Vermelho = Giro Horário</em>, <em>Azul = Giro Anti-horário</em>.</li> </ul>`
        });
    }

    pageToCanvas(pageX, pageY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: pageX - rect.left,
            y: pageY - rect.top
        };
    }
    canvasToGrid(canvasX, canvasY) {
        const gridX = Math.floor((canvasX - Renderer.RULER_SIZE) / this.pxPerSquare);
        const gridY = this.solver.ydim - 1 - Math.floor((canvasY - Renderer.RULER_SIZE) / this.pxPerSquare);
        return {
            x: gridX,
            y: gridY
        };
    }
    setCell(x, y, type) {
        if (this.solver.setCell(x, y, type)) {
            this._requestPaint();
        }
    }

    _saveState() {
        this.undoStack.push({
            cellTypes: this.solver.cellType.slice(),
            dyeSources: JSON.parse(JSON.stringify(this.solver.dyeSources))
        });
        this.redoStack = [];
        this._updateUndoRedoButtons();
    }
    undo() {
        if (this.undoStack.length <= 1) return;
        this.redoStack.push(this.undoStack.pop());
        const prevState = this.undoStack[this.undoStack.length - 1];
        this.solver.cellType = prevState.cellTypes.slice();
        this.solver.dyeSources = JSON.parse(JSON.stringify(prevState.dyeSources));
        this.initFluid();
        this._updateUndoRedoButtons();
    }
    redo() {
        if (this.redoStack.length === 0) return;
        const nextState = this.redoStack.pop();
        this.undoStack.push(nextState);
        this.solver.cellType = nextState.cellTypes.slice();
        this.solver.dyeSources = JSON.parse(JSON.stringify(nextState.dyeSources));
        this.initFluid();
        this._updateUndoRedoButtons();
    }
    _updateUndoRedoButtons() {
        this.undoButton.disabled = this.undoStack.length <= 1;
        this.redoButton.disabled = this.redoStack.length === 0;
    }

    _exportConfiguration() {
        const config = {
            version: 12,
            cellTypes: Array.from(this.solver.cellType),
            dyeSources: this.solver.dyeSources,
            flowSpeed: this.speedSlider.value,
            viscosity: this.viscSlider.value,
            resolution: this.sizeSelect.value,
            animationSpeed: this.stepsSlider.value,
            plotMode: this.plotSelect.selectedIndex,
            contrast: this.contrastSlider.value,
            showTracers: this.tracerCheck.checked,
            showForce: this.forceCheck.checked,
            showSensor: this.sensorCheck.checked
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], {
            type: "application/json"
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fluid-sim-config.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }
    _importConfiguration() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const config = JSON.parse(event.target.result);
                    if (config.version < 12) throw new Error('Formato de arquivo antigo ou incompatível.');
                    this._applyConfiguration(config);
                } catch (err) {
                    Swal.fire('Erro', `Não foi possível importar a configuração: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    _applyConfiguration(config) {
        this.speedSlider.value = config.flowSpeed;
        this.adjustSpeed();
        this.viscSlider.value = config.viscosity;
        this.adjustViscosity();
        this.stepsSlider.value = config.animationSpeed;
        this.plotSelect.selectedIndex = config.plotMode;
        this.contrastSlider.value = config.contrast;
        this.tracerCheck.checked = config.showTracers;
        this.forceCheck.checked = config.showForce;
        this.sensorCheck.checked = config.showSensor;
        this.sizeSelect.value = config.resolution;
        this._resetSimulation();
        this.solver.cellType = Uint8Array.from(config.cellTypes);
        this.solver.dyeSources = config.dyeSources || [];
        this._saveState();
        this.initFluid();
        this.solver.initTracers(this.tracerCheck.checked);
        this.solver.initDyeTracers();
        this._refreshAllSliderFills();
        Swal.fire('Sucesso!', 'Configuração importada com sucesso.', 'success');
    }
    _takeScreenshot() {
        const url = this.canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `fluid-simulation-${new Date().toISOString()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /**
     * @description Limpa todos os recursos pendentes (timers, observers) para evitar vazamentos de memória.
     */
    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.simulationTimeout) {
            clearTimeout(this.simulationTimeout);
            this.simulationTimeout = null;
        }
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }
}
