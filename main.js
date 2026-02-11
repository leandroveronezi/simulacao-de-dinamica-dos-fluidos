
/**
 * @class FluidSimulation
 * @description Encapsula toda a lógica e estado para a simulação de dinâmica de fluidos
 * baseada no método Lattice-Boltzmann (LBM).
 */
class FluidSimulation {
    /**
     * @constructor
     * @param {string} containerSelector - O seletor CSS para o elemento principal da aplicação.
     */
    constructor(containerSelector) {
        this.root = document.querySelector(containerSelector);
        if (!this.root) {
            throw new Error(`Container com seletor "${containerSelector}" não foi encontrado.`);
        }

        this.CELL_TYPE = Object.freeze({
            NORMAL: 0,
            BARRIER: 1
        });

        this._queryElements();
        if (!this.canvas.getContext) {
            throw new Error('Seu navegador não suporta o elemento canvas, que é essencial para esta aplicação.');
        }
        this._populateBarrierSelect();
        this._initializeConstants();
        this._initializeState();
        this._setupCanvas();
        this._bindEventListeners();
        this._requestPaint();
    }

    /**
     * @private
     * @description Seleciona e armazena referências a todos os elementos do DOM necessários.
     */
    _queryElements() {
        this.canvasContainer = this.root.querySelector('#canvas-container');
        this.canvas = this.root.querySelector('#theCanvas');
        this.context = this.canvas.getContext('2d');
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
        this.viscosityHelp = this.root.querySelector('#viscosityHelp');
        this.visualizationHelp = this.root.querySelector('#visualizationHelp');
        this.barrierSelect = this.root.querySelector('#barrierSelect');
        this.importCoordsButton = this.root.querySelector('#importCoordsButton');
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
     * @description Define constantes físicas e de configuração para a simulação.
     */
    _initializeConstants() {
        // Pesos para o modelo LBM D2Q9
        this.FOUR_NINTHS = 4.0 / 9.0;
        this.ONE_NINTH = 1.0 / 9.0;
        this.ONE_THIRTY_SIXTH = 1.0 / 36.0;

        // Parâmetros de visualização e configuração
        this.N_TRACERS = 144;
        this.N_COLORS = 400;
        this.RULER_SIZE = 30;
        this.MAX_DYE_TRACERS = 4000;
        this.PARTICLES_PER_FRAME_EMISSION = 10;
    }

    /**
     * @private
     * @description Inicializa o estado da aplicação e da simulação.
     */
    _initializeState() {
        this.running = false;
        this.stepCount = 0;
        this.startTime = 0;
        this.barrierCount = 0;
        this.barrierxSum = 0;
        this.barrierySum = 0;
        this.barrierFx = 0.0;
        this.barrierFy = 0.0;
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
        this.dyeSources = [];
        this.dyeTracers = [];
        this.xdim = 0;
        this.ydim = 0;
        this.isCanvasDirty = true;
        this.animationFrameId = null;
        this.simulationTimeout = null;
        this.resizeTimeout = null;
        this.resizeObserver = null;
    }

    /**
     * @private
     * @description Configura o canvas e inicializa a simulação pela primeira vez.
     */
    _setupCanvas() {
        this._initializeColorMap();
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
        this.importCoordsButton.addEventListener('click', () => this._importBarrierFromCoordinates());
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
        this.plotSelect.addEventListener('change', () => {
            this._requestPaint();
        });
        this.contrastSlider.addEventListener('input', () => {
            this._requestPaint();
        });
        this.barrierSelect.addEventListener('change', () => this.placePresetBarrier());
        this.tracerCheck.addEventListener('change', () => {
            this.initTracers();
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
        this.xdim = Math.floor((this.canvasContainer.clientWidth - this.RULER_SIZE) / this.pxPerSquare);
        this.ydim = Math.floor((this.canvasContainer.clientHeight - this.RULER_SIZE) / this.pxPerSquare);
        this.canvas.width = this.canvasContainer.clientWidth;
        this.canvas.height = this.canvasContainer.clientHeight;

        this._initializeArrays();
        this.initFluid();
        this.initTracers();
        this.initDyeTracers();

        this._clearSelection();
        this._clearClipboard();
        this._setActiveTool('brush'); // Garante estado de UI consistente

        this._saveState();
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

    /**
     * @private
     * @description Aloca e inicializa todos os arrays necessários para a simulação LBM.
     */
    _initializeArrays() {
        const size = this.xdim * this.ydim;
        // Arrays para as 9 distribuições de partículas (D2Q9)
        this.n0 = new Array(size).fill(0);
        this.nN = new Array(size).fill(0);
        this.nS = new Array(size).fill(0);
        this.nE = new Array(size).fill(0);
        this.nW = new Array(size).fill(0);
        this.nNE = new Array(size).fill(0);
        this.nSE = new Array(size).fill(0);
        this.nNW = new Array(size).fill(0);
        this.nSW = new Array(size).fill(0);

        // Arrays temporários para o passo de propagação
        this.temp_n0 = new Array(size).fill(0);
        this.temp_nN = new Array(size).fill(0);
        this.temp_nS = new Array(size).fill(0);
        this.temp_nE = new Array(size).fill(0);
        this.temp_nW = new Array(size).fill(0);
        this.temp_nNE = new Array(size).fill(0);
        this.temp_nSE = new Array(size).fill(0);
        this.temp_nNW = new Array(size).fill(0);
        this.temp_nSW = new Array(size).fill(0);

        // Arrays para as variáveis macroscópicas
        this.rho = new Array(size).fill(1);
        this.ux = new Array(size).fill(0);
        this.uy = new Array(size).fill(0);
        this.curl = new Array(size).fill(0);

        this.cellType = new Array(size).fill(this.CELL_TYPE.NORMAL);
        this.dyeSources = [];
        this.dyeTracers = [];

        this.sensorX = Math.round(this.xdim / 2);
        this.sensorY = Math.round(this.ydim / 2);

        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * @private
     * @description Popula o seletor de formas de barreira com opções pré-definidas.
     */
    _populateBarrierSelect() {
        const basicShapes = ["Linha curta", "Linha longa", "Diagonal", "Diagonal suave", "Círculo pequeno", "Círculo grande", "Ângulo reto", "Cunha", "Retângulo arredondado"];
        const basicGroup = document.createElement('optgroup');
        basicGroup.label = "Formas Básicas";
        basicShapes.forEach(name => {
            const option = document.createElement("option");
            option.text = name;
            basicGroup.appendChild(option);
        });
        this.barrierSelect.appendChild(basicGroup);
    }

    /**
     * @private
     * @description Cria um mapa de cores (colormap) para a visualização dos dados.
     */
    _initializeColorMap() {
        this.redList = new Array(this.N_COLORS + 2);
        this.greenList = new Array(this.N_COLORS + 2);
        this.blueList = new Array(this.N_COLORS + 2);

        for (let c = 0; c <= this.N_COLORS; c++) {
            let r, g, b;
            if (c < this.N_COLORS / 8) {
                r = 0;
                g = 0;
                b = Math.round(255 * (c + this.N_COLORS / 8) / (this.N_COLORS / 4));
            } else if (c < 3 * this.N_COLORS / 8) {
                r = 0;
                g = Math.round(255 * (c - this.N_COLORS / 8) / (this.N_COLORS / 4));
                b = 255;
            } else if (c < 5 * this.N_COLORS / 8) {
                r = Math.round(255 * (c - 3 * this.N_COLORS / 8) / (this.N_COLORS / 4));
                g = 255;
                b = 255 - r;
            } else if (c < 7 * this.N_COLORS / 8) {
                r = 255;
                g = Math.round(255 * (7 * this.N_COLORS / 8 - c) / (this.N_COLORS / 4));
                b = 0;
            } else {
                r = Math.round(255 * (9 * this.N_COLORS / 8 - c) / (this.N_COLORS / 4));
                g = 0;
                b = 0;
            }
            this.redList[c] = r;
            this.greenList[c] = g;
            this.blueList[c] = b;
        }
        this.redList[this.N_COLORS + 1] = 0;
        this.greenList[this.N_COLORS + 1] = 0;
        this.blueList[this.N_COLORS + 1] = 0;
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
            const dx = (gridLoc.x - this.sensorX) * this.pxPerSquare;
            const dy = (gridLoc.y - this.sensorY) * this.pxPerSquare;
            if (Math.sqrt(dx * dx + dy * dy) <= 8) {
                this.draggingSensor = true;
            }
        }

        if (this.draggingSensor) {
            this.sensorX = gridLoc.x;
            this.sensorY = gridLoc.y;
            this._requestPaint();
            return;
        }

        if (['brush', 'spray', 'fill', 'smoke'].includes(this.activeTool)) {
            this._saveState();
        }

        switch (this.activeTool) {
            case 'brush':
                this.setCell(gridLoc.x, gridLoc.y, this.CELL_TYPE.BARRIER);
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
                    this.dyeSources.push({
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
                this.sensorX = this.mouseGridPos.x;
                this.sensorY = this.mouseGridPos.y;
            } else if (this.activeTool === 'brush' && this.lastDrawPoint) {
                if (this.mouseGridPos.x !== this.lastDrawPoint.x || this.mouseGridPos.y !== this.lastDrawPoint.y) {
                    this._drawLineOnGrid(this.lastDrawPoint, this.mouseGridPos, (x, y) => this.setCell(x, y, this.CELL_TYPE.BARRIER));
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
                        this._drawLineOnGrid(this.toolStartPoint, endPoint, (x, y) => this.setCell(x, y, this.CELL_TYPE.BARRIER));
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
            this.setCell(x, y, this.CELL_TYPE.BARRIER);
        }
    }
    _floodFill(startX, startY) {
        if (startX < 0 || startX >= this.xdim || startY < 0 || startY >= this.ydim) return;
        const initialType = this.cellType[startX + startY * this.xdim];
        if (initialType === this.CELL_TYPE.BARRIER) return;
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
            this.setCell(x, y, this.CELL_TYPE.BARRIER);
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
                if (nextX >= 0 && nextX < this.xdim && nextY >= 0 && nextY < this.ydim) {
                    if (this.cellType[nextX + nextY * this.xdim] === initialType) {
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
                if (filled || x === x_start || x === x_end || y === y_start || y === y_end) this.setCell(x, y, this.CELL_TYPE.BARRIER);
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
                    if (norm_dist_sq <= 1) this.setCell(x, y, this.CELL_TYPE.BARRIER);
                } else {
                    if (norm_dist_sq <= 1 && norm_dist_sq > 0.8) this.setCell(x, y, this.CELL_TYPE.BARRIER);
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
            this.setCell(x, y0, this.CELL_TYPE.BARRIER);
            this.setCell(x, y1, this.CELL_TYPE.BARRIER);
        }
        for (let y = y0 + r; y <= y1 - r; y++) {
            this.setCell(x0, y, this.CELL_TYPE.BARRIER);
            this.setCell(x1, y, this.CELL_TYPE.BARRIER);
        }
        for (let a = Math.PI; a < 1.5 * Math.PI; a += 0.1 / r) this.setCell(x0 + r + Math.round(r * Math.cos(a)), y0 + r + Math.round(r * Math.sin(a)), this.CELL_TYPE.BARRIER);
        for (let a = 1.5 * Math.PI; a < 2 * Math.PI; a += 0.1 / r) this.setCell(x1 - r + Math.round(r * Math.cos(a)), y0 + r + Math.round(r * Math.sin(a)), this.CELL_TYPE.BARRIER);
        for (let a = 0; a < 0.5 * Math.PI; a += 0.1 / r) this.setCell(x1 - r + Math.round(r * Math.cos(a)), y1 - r + Math.round(r * Math.sin(a)), this.CELL_TYPE.BARRIER);
        for (let a = 0.5 * Math.PI; a < Math.PI; a += 0.1 / r) this.setCell(x0 + r + Math.round(r * Math.cos(a)), y1 - r + Math.round(r * Math.sin(a)), this.CELL_TYPE.BARRIER);
    }
    _eraseRectangleOnGrid(start, end) {
        const x_start = Math.min(start.x, end.x),
            x_end = Math.max(start.x, end.x);
        const y_start = Math.min(start.y, end.y),
            y_end = Math.max(start.y, end.y);
        for (let x = x_start; x <= x_end; x++) {
            for (let y = y_start; y <= y_end; y++) {
                this.setCell(x, y, this.CELL_TYPE.NORMAL);
            }
        }
        this.dyeSources = this.dyeSources.filter(source => source.x < x_start || source.x > x_end || source.y < y_start || source.y > y_end);
    }
    _drawPreviewShape(start, end) {
        let strokeColor = 'rgba(255, 255, 255, 0.7)';
        if (this.activeTool === 'eraser') {
            strokeColor = 'rgba(255, 150, 150, 0.7)';
        } else if (this.activeTool === 'select') {
            strokeColor = 'rgba(100, 150, 255, 0.8)';
        }
        this.context.strokeStyle = strokeColor;
        this.context.lineWidth = 1;
        this.context.setLineDash([5, 3]);
        if (this.activeTool === 'line') {
            this._previewLine(start, end);
        } else if (this.activeTool.startsWith('rectangle') || this.activeTool.startsWith('ellipse') || this.activeTool === 'rounded_rectangle' || this.activeTool === 'eraser' || this.activeTool === 'select') {
            this._previewRectangle(start, end);
        }
        this.context.setLineDash([]);
    }
    _previewLine(start, end) {
        const s = this.gridToCanvas(start.x, start.y),
            e = this.gridToCanvas(end.x, end.y);
        this.context.beginPath();
        this.context.moveTo(s.x, s.y);
        this.context.lineTo(e.x, e.y);
        this.context.stroke();
    }
    _previewRectangle(start, end) {
        const x = Math.min(start.x, end.x) * this.pxPerSquare;
        const y = (this.ydim - 1 - Math.max(start.y, end.y)) * this.pxPerSquare;
        const w = (Math.abs(end.x - start.x) + 1) * this.pxPerSquare;
        const h = (Math.abs(end.y - start.y) + 1) * this.pxPerSquare;
        this.context.strokeRect(x, y, w, h);
    }

    /**
     * @description O loop principal que avança a simulação no tempo.
     * Executa os passos de colisão, propagação e atualização de contornos.
     */
    async runSimulation() {
        if (!this.running) return;

        const frameStart = performance.now();
        const stepsPerFrame = Number(this.stepsSlider.value);
        for (let s = 0; s < stepsPerFrame; s++) {
            this.collide();
            this.stream();
            this.setBoundaries();
            if (this.tracerCheck.checked) this.moveTracers();
            this.moveDyeTracers();
            this._emitNewDyeTracers();
            this.time++;
        }

        if (!this.checkStability()) {
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
        this.collide();
        this.stream();
        this.setBoundaries();
        if (this.tracerCheck.checked) this.moveTracers();
        this.moveDyeTracers();
        this._emitNewDyeTracers();
        this._requestPaint();
    }

    /**
     * @description Define as condições de contorno do domínio de simulação.
     * - Borda esquerda: Fluxo de entrada com velocidade constante.
     * - Borda direita: Fluxo de saída com gradiente zero.
     * - Bordas superior/inferior: Paredes com deslizamento livre.
     */
    setBoundaries() {
        const u0 = Number(this.speedSlider.value);

        // Borda de entrada (esquerda)
        for (let y = 0; y < this.ydim; y++) {
            this.setEquilibrium(0, y, u0, 0, 1);
        }

        // Borda de saída (direita)
        for (let y = 0; y < this.ydim; y++) {
            const i = this.xdim - 1 + y * this.xdim;
            const i_prev = this.xdim - 2 + y * this.xdim;
            this.n0[i] = this.n0[i_prev] || 0;
            this.nN[i] = this.nN[i_prev] || 0;
            this.nS[i] = this.nS[i_prev] || 0;
            this.nE[i] = this.nE[i_prev] || 0;
            this.nW[i] = this.nW[i_prev] || 0;
            this.nNE[i] = this.nNE[i_prev] || 0;
            this.nSE[i] = this.nSE[i_prev] || 0;
            this.nNW[i] = this.nNW[i_prev] || 0;
            this.nSW[i] = this.nSW[i_prev] || 0;
        }

        // Bordas superior e inferior (paredes com deslizamento)
        for (let x = 0; x < this.xdim; x++) {
            const i_top = x + (this.ydim - 1) * this.xdim;
            const i_bot = x;
            this.nS[i_top] = this.nN[i_top] || 0;
            this.nSE[i_top] = this.nNW[i_top] || 0;
            this.nSW[i_top] = this.nNE[i_top] || 0;

            this.nN[i_bot] = this.nS[i_bot] || 0;
            this.nNE[i_bot] = this.nSW[i_bot] || 0;
            this.nNW[i_bot] = this.nSE[i_bot] || 0;
        }
    }

    /**
     * @description Executa o passo de colisão do algoritmo LBM.
     * 1. Calcula as propriedades macroscópicas (densidade, velocidade).
     * 2. Calcula as distribuições de equilíbrio com base nessas propriedades.
     * 3. Relaxa as distribuições atuais em direção ao equilíbrio.
     */
    collide() {
        const viscosity = Number(this.viscSlider.value);
        const omega = Math.max(0.01, Math.min(1.99, 1.0 / (3.0 * viscosity + 0.5))); // Parâmetro de relaxação

        for (let i = 0; i < this.xdim * this.ydim; i++) {
            // 1. Calcula densidade e velocidades macroscópicas
            const thisrho = this.n0[i] + this.nN[i] + this.nS[i] + this.nE[i] + this.nW[i] + this.nNW[i] + this.nNE[i] + this.nSW[i] + this.nSE[i];

            if (thisrho <= 0) { // Checagem de estabilidade
                this.rho[i] = 1;
                this.ux[i] = 0;
                this.uy[i] = 0;
                continue;
            }
            this.rho[i] = thisrho;

            const thisux = (this.nE[i] + this.nNE[i] + this.nSE[i] - this.nW[i] - this.nNW[i] - this.nSW[i]) / thisrho;
            const thisuy = (this.nN[i] + this.nNE[i] + this.nNW[i] - this.nS[i] - this.nSE[i] - this.nSW[i]) / thisrho;
            this.ux[i] = isFinite(thisux) ? thisux : 0;
            this.uy[i] = isFinite(thisuy) ? thisuy : 0;

            // 2. Calcula as distribuições de equilíbrio (f_eq)
            const one9thrho = this.ONE_NINTH * thisrho;
            const one36thrho = this.ONE_THIRTY_SIXTH * thisrho;
            const ux3 = 3 * this.ux[i];
            const uy3 = 3 * this.uy[i];
            const ux2 = this.ux[i] * this.ux[i];
            const uy2 = this.uy[i] * this.uy[i];
            const uxuy2 = 2 * this.ux[i] * this.uy[i];
            const u2 = ux2 + uy2;
            const u215 = 1.5 * u2;

            const eq0 = this.FOUR_NINTHS * thisrho * (1 - u215);
            const eqE = one9thrho * (1 + ux3 + 4.5 * ux2 - u215);
            const eqW = one9thrho * (1 - ux3 + 4.5 * ux2 - u215);
            const eqN = one9thrho * (1 + uy3 + 4.5 * uy2 - u215);
            const eqS = one9thrho * (1 - uy3 + 4.5 * uy2 - u215);
            const eqNE = one36thrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
            const eqSE = one36thrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
            const eqNW = one36thrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
            const eqSW = one36thrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);

            // 3. Relaxa as distribuições (colisão)
            this.n0[i] += omega * (eq0 - this.n0[i]);
            this.nE[i] += omega * (eqE - this.nE[i]);
            this.nW[i] += omega * (eqW - this.nW[i]);
            this.nN[i] += omega * (eqN - this.nN[i]);
            this.nS[i] += omega * (eqS - this.nS[i]);
            this.nNE[i] += omega * (eqNE - this.nNE[i]);
            this.nSE[i] += omega * (eqSE - this.nSE[i]);
            this.nNW[i] += omega * (eqNW - this.nNW[i]);
            this.nSW[i] += omega * (eqSW - this.nSW[i]);
        }
    }

    /**
     * @description Executa o passo de propagação (streaming) do algoritmo LBM.
     * As distribuições de partículas movem-se para as células vizinhas.
     * A condição de contorno de obstáculo (bounce-back) é aplicada aqui.
     */
    stream() {
        // Propaga as distribuições para células vizinhas usando arrays temporários
        for (let y = 0; y < this.ydim; y++) {
            for (let x = 0; x < this.xdim; x++) {
                const i = x + y * this.xdim;
                this.temp_n0[i] = this.n0[i];
                this.temp_nE[((x + 1) % this.xdim) + y * this.xdim] = this.nE[i];
                this.temp_nW[((x - 1 + this.xdim) % this.xdim) + y * this.xdim] = this.nW[i];
                this.temp_nN[x + ((y + 1) % this.ydim) * this.xdim] = this.nN[i];
                this.temp_nS[x + ((y - 1 + this.ydim) % this.ydim) * this.xdim] = this.nS[i];
                this.temp_nNE[((x + 1) % this.xdim) + ((y + 1) % this.ydim) * this.xdim] = this.nNE[i];
                this.temp_nSE[((x + 1) % this.xdim) + ((y - 1 + this.ydim) % this.ydim) * this.xdim] = this.nSE[i];
                this.temp_nNW[((x - 1 + this.xdim) % this.xdim) + ((y + 1) % this.ydim) * this.xdim] = this.nNW[i];
                this.temp_nSW[((x - 1 + this.xdim) % this.xdim) + ((y - 1 + this.ydim) % this.ydim) * this.xdim] = this.nSW[i];
            }
        }

        // Troca os arrays principal e temporário de forma eficiente
        [this.n0, this.temp_n0] = [this.temp_n0, this.n0];
        [this.nN, this.temp_nN] = [this.temp_nN, this.nN];
        [this.nS, this.temp_nS] = [this.temp_nS, this.nS];
        [this.nE, this.temp_nE] = [this.temp_nE, this.nE];
        [this.nW, this.temp_nW] = [this.temp_nW, this.nW];
        [this.nNE, this.temp_nNE] = [this.temp_nNE, this.nNE];
        [this.nSE, this.temp_nSE] = [this.temp_nSE, this.nSE];
        [this.nNW, this.temp_nNW] = [this.temp_nNW, this.nNW];
        [this.nSW, this.temp_nSW] = [this.temp_nSW, this.nSW];

        // Aplica a condição de contorno de obstáculo (bounce-back) e calcula forças
        this.barrierCount = 0;
        this.barrierxSum = 0;
        this.barrierySum = 0;
        this.barrierFx = 0.0;
        this.barrierFy = 0.0;

        for (let i = 0; i < this.xdim * this.ydim; i++) {
            if (this.cellType[i] === this.CELL_TYPE.BARRIER) {
                const x = i % this.xdim,
                    y = Math.floor(i / this.xdim);
                // Inverte as direções das distribuições que chegaram à barreira
                [this.nE[i], this.nW[i]] = [this.nW[i], this.nE[i]];
                [this.nN[i], this.nS[i]] = [this.nS[i], this.nN[i]];
                [this.nNE[i], this.nSW[i]] = [this.nSW[i], this.nNE[i]];
                [this.nNW[i], this.nSE[i]] = [this.nSE[i], this.nNW[i]];

                // Calcula a força total exercida pelo fluido sobre as barreiras
                this.barrierCount++;
                this.barrierxSum += x;
                this.barrierySum += y;
                this.barrierFx += 2 * (this.nE[i] + this.nNE[i] + this.nSE[i] - this.nW[i] - this.nNW[i] - this.nSW[i]);
                this.barrierFy += 2 * (this.nN[i] + this.nNE[i] + this.nNW[i] - this.nS[i] - this.nSE[i] - this.nSW[i]);
            }
        }
    }
    _bilinearInterpolate(x, y, grid) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        if (x0 < 0 || y0 < 0 || x1 >= this.xdim || y1 >= this.ydim) {
            const clampedX = Math.max(0, Math.min(this.xdim - 1, Math.round(x)));
            const clampedY = Math.max(0, Math.min(this.ydim - 1, Math.round(y)));
            return grid[clampedX + clampedY * this.xdim];
        }

        const v00 = grid[x0 + y0 * this.xdim];
        const v01 = grid[x0 + y1 * this.xdim];
        const v10 = grid[x1 + y0 * this.xdim];
        const v11 = grid[x1 + y1 * this.xdim];
        const wx = x - x0;
        const wy = y - y0;
        return v00 * (1 - wx) * (1 - wy) + v10 * wx * (1 - wy) + v01 * (1 - wx) * wy + v11 * wx * wy;
    }
    moveTracers() {
        if (!this.tracerX) return;
        for (let t = 0; t < this.N_TRACERS; t++) {
            const ux_interp = this._bilinearInterpolate(this.tracerX[t], this.tracerY[t], this.ux);
            const uy_interp = this._bilinearInterpolate(this.tracerX[t], this.tracerY[t], this.uy);
            if (!isFinite(ux_interp) || !isFinite(uy_interp)) continue;
            this.tracerX[t] += ux_interp;
            this.tracerY[t] += uy_interp;
            if (this.tracerX[t] > this.xdim - 1) {
                this.tracerX[t] = 0;
                this.tracerY[t] = Math.random() * this.ydim;
            }
        }
    }
    _emitNewDyeTracers() {
        const activeSources = this.dyeSources.filter(source => {
            const ix = Math.floor(source.x),
                iy = Math.floor(source.y);
            return ix >= 0 && ix < this.xdim && iy >= 0 && iy < this.ydim && this.cellType[ix + iy * this.xdim] !== this.CELL_TYPE.BARRIER;
        });
        if (activeSources.length === 0) return;
        const activeTracers = this.dyeTracers.filter(t => t.x >= 0).length;
        const availableSlots = this.MAX_DYE_TRACERS - activeTracers;
        if (availableSlots <= 0) return;
        const particlesToEmit = Math.min(this.PARTICLES_PER_FRAME_EMISSION, availableSlots);
        for (let i = 0; i < particlesToEmit; i++) {
            const inactiveTracer = this.dyeTracers.find(t => t.x < 0);
            if (inactiveTracer) {
                const source = activeSources[Math.floor(Math.random() * activeSources.length)];
                inactiveTracer.x = source.x + (Math.random() - 0.5) * 0.5;
                inactiveTracer.y = source.y + (Math.random() - 0.5) * 0.5;
            } else {
                break;
            }
        }
    }
    _recycleDyeTracer(tracer) {
        const activeSources = this.dyeSources.filter(source => {
            const ix = Math.floor(source.x),
                iy = Math.floor(source.y);
            return ix >= 0 && ix < this.xdim && iy >= 0 && iy < this.ydim && this.cellType[ix + iy * this.xdim] !== this.CELL_TYPE.BARRIER;
        });
        if (activeSources.length > 0) {
            const source = activeSources[Math.floor(Math.random() * activeSources.length)];
            tracer.x = source.x + (Math.random() - 0.5) * 0.5;
            tracer.y = source.y + (Math.random() - 0.5) * 0.5;
        } else {
            tracer.x = -1;
            tracer.y = -1;
        }
    }
    moveDyeTracers() {
        for (const tracer of this.dyeTracers) {
            if (tracer.x < 0) continue;
            const ux_interp = this._bilinearInterpolate(tracer.x, tracer.y, this.ux);
            const uy_interp = this._bilinearInterpolate(tracer.x, tracer.y, this.uy);
            if (!isFinite(ux_interp) || !isFinite(uy_interp)) {
                this._recycleDyeTracer(tracer);
                continue;
            }
            tracer.x += ux_interp;
            tracer.y += uy_interp;
            const rx = Math.floor(tracer.x);
            const ry = Math.floor(tracer.y);
            if (rx < 0 || rx >= this.xdim || ry < 0 || ry >= this.ydim || this.cellType[rx + ry * this.xdim] === this.CELL_TYPE.BARRIER) {
                this._recycleDyeTracer(tracer);
            }
        }
    }
    setEquilibrium(x, y, newux, newuy, newrho) {
        if (x < 0 || x >= this.xdim || y < 0 || y >= this.ydim) return;
        const i = x + y * this.xdim;
        this.rho[i] = newrho;
        this.ux[i] = newux;
        this.uy[i] = newuy;
        const ux3 = 3 * newux,
            uy3 = 3 * newuy;
        const ux2 = newux * newux,
            uy2 = newuy * newuy;
        const uxuy2 = 2 * newux * newuy,
            u2 = ux2 + uy2,
            u215 = 1.5 * u2;
        this.n0[i] = this.FOUR_NINTHS * newrho * (1 - u215);
        this.nE[i] = this.ONE_NINTH * newrho * (1 + ux3 + 4.5 * ux2 - u215);
        this.nW[i] = this.ONE_NINTH * newrho * (1 - ux3 + 4.5 * ux2 - u215);
        this.nN[i] = this.ONE_NINTH * newrho * (1 + uy3 + 4.5 * uy2 - u215);
        this.nS[i] = this.ONE_NINTH * newrho * (1 - uy3 + 4.5 * uy2 - u215);
        this.nNE[i] = this.ONE_THIRTY_SIXTH * newrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
        this.nSE[i] = this.ONE_THIRTY_SIXTH * newrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
        this.nNW[i] = this.ONE_THIRTY_SIXTH * newrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
        this.nSW[i] = this.ONE_THIRTY_SIXTH * newrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);
    }
    paintCanvas() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this._updateSimulationImage();
        this._drawCanvasOverlays();
    }

    /**
     * @private
     * @description Atualiza a imagem da simulação de forma otimizada usando ImageData.
     * Isso evita chamadas `fillRect` individuais, melhorando drasticamente a performance.
     */
    _updateSimulationImage() {
        if (!this.xdim || !this.ydim) return;

        const imageWidth = this.xdim * this.pxPerSquare;
        const imageHeight = this.ydim * this.pxPerSquare;
        if (imageWidth <= 0 || imageHeight <= 0) return;

        const imageData = this.context.createImageData(imageWidth, imageHeight);
        const data = imageData.data;

        const contrast = Math.pow(1.2, Number(this.contrastSlider.value));
        const plotType = this.plotSelect.selectedIndex;
        if (plotType === 4) this.computeCurl();

        for (let y = 0; y < this.ydim; y++) {
            for (let x = 0; x < this.xdim; x++) {
                const index = x + y * this.xdim;
                let r, g, b;

                if (this.cellType[index] === this.CELL_TYPE.BARRIER) {
                    r = 0;
                    g = 0;
                    b = 0;
                } else {
                    let value;
                    switch (plotType) {
                        case 0:
                            value = (this.rho[index] - 1) * 6 * contrast + 0.5;
                            break;
                        case 1:
                            value = this.ux[index] * 2 * contrast + 0.5;
                            break;
                        case 2:
                            value = this.uy[index] * 2 * contrast + 0.5;
                            break;
                        case 3:
                            value = Math.sqrt(this.ux[index] ** 2 + this.uy[index] ** 2) * 4 * contrast;
                            break;
                        case 4:
                            value = this.curl[index] * 5 * contrast + 0.5;
                            break;
                    }
                    const cIndex = Math.max(0, Math.min(this.N_COLORS, Math.round(this.N_COLORS * value)));
                    r = this.redList[cIndex];
                    g = this.greenList[cIndex];
                    b = this.blueList[cIndex];
                }

                const startX = x * this.pxPerSquare;
                const startY = (this.ydim - 1 - y) * this.pxPerSquare;

                for (let py = 0; py < this.pxPerSquare; py++) {
                    const rowStart = ((startY + py) * imageWidth + startX) * 4;
                    for (let px = 0; px < this.pxPerSquare; px++) {
                        const pixelIndex = rowStart + px * 4;
                        data[pixelIndex] = r;
                        data[pixelIndex + 1] = g;
                        data[pixelIndex + 2] = b;
                        data[pixelIndex + 3] = 255;
                    }
                }
            }
        }
        this.context.putImageData(imageData, this.RULER_SIZE, this.RULER_SIZE);
    }

    _drawCanvasOverlays() {
        this._drawRulersAndGrid();
        this._drawLegend();
        this.context.save();
        this.context.translate(this.RULER_SIZE, this.RULER_SIZE);
        this.drawDyeSources();
        this.drawDyeTracers();
        if (this.tracerCheck.checked) this.drawTracers();
        if (this.forceCheck.checked && this.barrierCount > 0) this.drawForceArrow(this.barrierxSum / this.barrierCount, this.barrierySum / this.barrierCount, this.barrierFx, this.barrierFy);
        if (this.sensorCheck.checked) this.drawSensor();
        if (this.toolStartPoint && this.mouseIsDown) this._drawPreviewShape(this.toolStartPoint, this.mouseGridPos);
        if (this.selectionArea) this._drawSelectionArea();
        if (this.pastePreviewOrigin) this._drawPastePreview();
        this.context.restore();
    }
    _drawRulersAndGrid() {
        this.context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ruler-bg-color').trim();
        this.context.fillRect(0, 0, this.canvas.width, this.RULER_SIZE);
        this.context.fillRect(0, 0, this.RULER_SIZE, this.canvas.height);
        this.context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ruler-line-color').trim();
        this.context.strokeStyle = this.context.fillStyle;
        this.context.font = '10px sans-serif';
        this.context.textAlign = 'center';
        this.context.textBaseline = 'middle';
        for (let x = 0; x < this.xdim; x++) {
            const canvasX = this.RULER_SIZE + (x + 0.5) * this.pxPerSquare;
            if (x % 10 === 0) {
                this.context.fillText(x, canvasX, this.RULER_SIZE / 2);
                this.context.beginPath();
                this.context.moveTo(canvasX, this.RULER_SIZE - 10);
                this.context.lineTo(canvasX, this.RULER_SIZE);
                this.context.stroke();
                this.context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-line-color').trim();
                this.context.beginPath();
                this.context.moveTo(canvasX, this.RULER_SIZE);
                this.context.lineTo(canvasX, this.canvas.height);
                this.context.stroke();
                this.context.strokeStyle = this.context.fillStyle;
            } else if (x % 5 === 0) {
                this.context.beginPath();
                this.context.moveTo(canvasX, this.RULER_SIZE - 5);
                this.context.lineTo(canvasX, this.RULER_SIZE);
                this.context.stroke();
            }
        }
        this.context.textAlign = 'right';
        for (let y = 0; y < this.ydim; y++) {
            const canvasY = this.RULER_SIZE + (this.ydim - 1 - y + 0.5) * this.pxPerSquare;
            if (y % 10 === 0) {
                this.context.fillText(y, this.RULER_SIZE - 10, canvasY);
                this.context.beginPath();
                this.context.moveTo(this.RULER_SIZE - 10, canvasY);
                this.context.lineTo(this.RULER_SIZE, canvasY);
                this.context.stroke();
                this.context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-line-color').trim();
                this.context.beginPath();
                this.context.moveTo(this.RULER_SIZE, canvasY);
                this.context.lineTo(this.canvas.width, canvasY);
                this.context.stroke();
                this.context.strokeStyle = this.context.fillStyle;
            } else if (y % 5 === 0) {
                this.context.beginPath();
                this.context.moveTo(this.RULER_SIZE - 5, canvasY);
                this.context.lineTo(this.RULER_SIZE, canvasY);
                this.context.stroke();
            }
        }
        if (this.mouseGridPos.x >= 0 && this.mouseGridPos.y >= 0) {
            this.context.fillStyle = 'rgba(255, 100, 100, 0.5)';
            const trackerX = this.RULER_SIZE + this.mouseGridPos.x * this.pxPerSquare;
            const trackerY = this.RULER_SIZE + (this.ydim - 1 - this.mouseGridPos.y) * this.pxPerSquare;
            this.context.fillRect(trackerX, 0, this.pxPerSquare, this.RULER_SIZE);
            this.context.fillRect(0, trackerY, this.RULER_SIZE, this.pxPerSquare);
        }
    }
    _drawLegend() {
        const legendWidth = 150,
            legendHeight = 15;
        const legendX = this.canvas.width - legendWidth - 10;
        const legendY = this.canvas.height - legendHeight - 30;
        this.context.clearRect(legendX - 5, legendY - 25, legendWidth + 10, legendHeight + 40);
        const gradient = this.context.createLinearGradient(legendX, legendY, legendX + legendWidth, legendY);
        for (let c = 0; c <= this.N_COLORS; c++) {
            gradient.addColorStop(c / this.N_COLORS, `rgb(${this.redList[c]},${this.greenList[c]},${this.blueList[c]})`);
        }
        this.context.fillStyle = gradient;
        this.context.fillRect(legendX, legendY, legendWidth, legendHeight);
        this.context.strokeStyle = 'rgba(255,255,255,0.7)';
        this.context.strokeRect(legendX, legendY, legendWidth, legendHeight);
        this.context.fillStyle = 'white';
        this.context.font = '11px sans-serif';
        this.context.textAlign = 'center';
        this.context.fillText(this.plotSelect.options[this.plotSelect.selectedIndex].text, legendX + legendWidth / 2, legendY - 10);
        this.context.textAlign = 'left';
        this.context.fillText("Baixo", legendX, legendY + legendHeight + 12);
        this.context.textAlign = 'right';
        this.context.fillText("Alto", legendX + legendWidth, legendY + legendHeight + 12);
    }
    _drawSelectionArea() {
        const x = Math.min(this.selectionArea.start.x, this.selectionArea.end.x) * this.pxPerSquare;
        const y = (this.ydim - 1 - Math.max(this.selectionArea.start.y, this.selectionArea.end.y)) * this.pxPerSquare;
        const w = (Math.abs(this.selectionArea.end.x - this.selectionArea.start.x) + 1) * this.pxPerSquare;
        const h = (Math.abs(this.selectionArea.end.y - this.selectionArea.start.y) + 1) * this.pxPerSquare;
        this.context.strokeStyle = 'rgba(100, 150, 255, 0.9)';
        this.context.fillStyle = 'rgba(100, 150, 255, 0.2)';
        this.context.lineWidth = 2;
        this.context.setLineDash([6, 4]);
        this.context.strokeRect(x, y, w, h);
        this.context.fillRect(x, y, w, h);
        this.context.setLineDash([]);
    }
    _drawPastePreview() {
        if (!this.clipboard || !this.pastePreviewOrigin) return;
        for (const p of this.clipboard.cells) {
            const x = (this.pastePreviewOrigin.x + p.x) * this.pxPerSquare;
            const y = (this.ydim - 1 - (this.pastePreviewOrigin.y + p.y)) * this.pxPerSquare;
            this.context.fillStyle = 'rgba(200, 200, 255, 0.5)';
            this.context.fillRect(x, y, this.pxPerSquare, this.pxPerSquare);
        }
    }
    computeCurl() {
        for (let y = 1; y < this.ydim - 1; y++) {
            for (let x = 1; x < this.xdim - 1; x++) {
                this.curl[x + y * this.xdim] = this.uy[x + 1 + y * this.xdim] - this.uy[x - 1 + y * this.xdim] - this.ux[x + (y + 1) * this.xdim] + this.ux[x + (y - 1) * this.xdim];
            }
        }
        for (let x = 0; x < this.xdim; x++) {
            this.curl[x] = 0;
            this.curl[x + (this.ydim - 1) * this.xdim] = 0;
        }
        for (let y = 0; y < this.ydim; y++) {
            this.curl[y * this.xdim] = 0;
            this.curl[this.xdim - 1 + y * this.xdim] = 0;
        }
    }
    drawTracers() {
        if (!this.tracerX) return;
        this.context.fillStyle = "rgb(200,200,200)";
        for (let t = 0; t < this.N_TRACERS; t++) {
            const cX = (this.tracerX[t] + 0.5) * this.pxPerSquare;
            const cY = (this.ydim - (this.tracerY[t] + 0.5)) * this.pxPerSquare;
            this.context.fillRect(cX - 1, cY - 1, 2, 2);
        }
    }
    drawDyeSources() {
        this.context.fillStyle = "rgba(200, 200, 255, 0.7)";
        for (const source of this.dyeSources) {
            const cX = (source.x + 0.5) * this.pxPerSquare;
            const cY = (this.ydim - (source.y + 0.5)) * this.pxPerSquare;
            this.context.beginPath();
            this.context.arc(cX, cY, 3, 0, 2 * Math.PI);
            this.context.fill();
        }
    }
    drawDyeTracers() {
        this.context.fillStyle = "rgba(220, 220, 255, 0.8)";
        for (const tracer of this.dyeTracers) {
            if (tracer.x < 0) continue;
            const cX = (tracer.x + 0.5) * this.pxPerSquare;
            const cY = (this.ydim - (tracer.y + 0.5)) * this.pxPerSquare;
            this.context.fillRect(cX - 1, cY - 1, 2, 2);
        }
    }
    drawForceArrow(x, y, Fx, Fy) {
        this.context.save();
        this.context.fillStyle = "rgba(200,200,200,0.8)";
        this.context.translate((x + 0.5) * this.pxPerSquare, (this.ydim - (y + 0.5)) * this.pxPerSquare);
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
    drawSensor() {
        const cX = (this.sensorX + 0.5) * this.pxPerSquare;
        let cY = (this.ydim - (this.sensorY + 0.5)) * this.pxPerSquare;

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

        // Em seguida, desenha o painel de texto sobreposto
        let tX = cX + 15,
            tY = cY;
        this.context.font = "12px Monospace";
        const rectWidth = this.context.measureText("ux = -0.000").width + 10,
            rectHeight = 62;
        if (tX + rectWidth > this.xdim * this.pxPerSquare) tX -= (rectWidth + 30);
        if (tY + rectHeight > this.ydim * this.pxPerSquare) tY = this.ydim * this.pxPerSquare - rectHeight;

        this.context.fillStyle = "rgba(255,255,255,0.9)"; // Fundo mais opaco
        this.context.fillRect(tX, tY, rectWidth, rectHeight);

        // E, por último, o texto
        this.context.fillStyle = "#000000";
        tX += 5;
        tY += 12;
        const index = this.sensorX + this.sensorY * this.xdim;
        this.context.fillText(`(${this.sensorX},${this.sensorY})`, tX, tY);
        tY += 16;
        this.context.fillText(`ρ = ${this.rho[index].toFixed(3)}`, tX, tY);
        tY += 16;
        this.context.fillText(`ux = ${this.ux[index].toFixed(3).padStart(6, ' ')}`, tX, tY);
        tY += 16;
        this.context.fillText(`uy = ${this.uy[index].toFixed(3).padStart(6, ' ')}`, tX, tY);
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
        const u0 = Number(this.speedSlider.value);
        for (let i = 0; i < this.xdim * this.ydim; i++) {
            this.setEquilibrium(i % this.xdim, Math.floor(i / this.xdim), u0, 0, 1);
        }
        this._requestPaint();
    }
    initTracers() {
        this.tracerX = new Array(this.N_TRACERS);
        this.tracerY = new Array(this.N_TRACERS);
        if (this.tracerCheck.checked) {
            const nRows = Math.ceil(Math.sqrt(this.N_TRACERS));
            const dx = this.xdim / nRows,
                dy = this.ydim / nRows;
            let nX = dx / 2,
                nY = dy / 2;
            for (let t = 0; t < this.N_TRACERS; t++) {
                this.tracerX[t] = nX;
                this.tracerY[t] = nY;
                nX += dx;
                if (nX > this.xdim) {
                    nX = dx / 2;
                    nY += dy;
                }
            }
        }
    }
    initDyeTracers() {
        this.dyeTracers = [];
        for (let i = 0; i < this.MAX_DYE_TRACERS; i++) {
            this.dyeTracers.push({
                x: -1,
                y: -1
            });
        }
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
    clearBarriers() {
        this.cellType.fill(this.CELL_TYPE.NORMAL);
        this.dyeSources = [];
        this.initFluid();
    }
    checkStability() {
        for (let i = 0; i < this.rho.length; i++) {
            if (this.rho[i] <= 0 || !isFinite(this.rho[i]) || !isFinite(this.ux[i]) || !isFinite(this.uy[i]) || Math.abs(this.ux[i]) > 0.5 || Math.abs(this.uy[i]) > 0.5) {
                console.warn('Instabilidade detectada na célula:', i, {
                    rho: this.rho[i],
                    ux: this.ux[i],
                    uy: this.uy[i]
                });
                return false;
            }
        }
        return true;
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
                const type = this.cellType[x + y * this.xdim];
                if (type !== this.CELL_TYPE.NORMAL) {
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
                const type = this.cellType[x + y * this.xdim];
                if (type !== this.CELL_TYPE.NORMAL) {
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
                    if (newX >= 0 && newX < this.xdim && newY >= 0 && newY < this.ydim) {
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
                const type = this.cellType[x + y * this.xdim];
                if (type !== this.CELL_TYPE.NORMAL) {
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
    async _importBarrierFromCoordinates() {
        this._saveState();
        const {
            value: rawCoords
        } = await Swal.fire({
            title: 'Importar Coordenadas',
            input: 'textarea',
            inputPlaceholder: 'Cole as coordenadas aqui no formato: x1,y1, x2,y2, ...',
            showCancelButton: true,
            confirmButtonText: 'Importar',
            cancelButtonText: 'Cancelar'
        });
        if (!rawCoords) {
            this.undo();
            return;
        }
        try {
            const coordPairs = rawCoords.split(',').map(s => s.trim());
            if (coordPairs.length % 2 !== 0) throw new Error("O número de coordenadas deve ser par (pares de x,y).");
            for (let i = 0; i < coordPairs.length; i += 2) {
                const x = parseInt(coordPairs[i], 10),
                    y = parseInt(coordPairs[i + 1], 10);
                if (isNaN(x) || isNaN(y)) throw new Error(`Coordenada inválida: (${coordPairs[i]}, ${coordPairs[i + 1]})`);
                this.setCell(x, y, this.CELL_TYPE.BARRIER);
            }
            this.initFluid();
        } catch (error) {
            this.undo();
            Swal.fire({
                icon: 'error',
                title: 'Erro de Importação',
                text: error.message
            });
        }
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
        const gridX = Math.floor((canvasX - this.RULER_SIZE) / this.pxPerSquare);
        const gridY = this.ydim - 1 - Math.floor((canvasY - this.RULER_SIZE) / this.pxPerSquare);
        return {
            x: gridX,
            y: gridY
        };
    }
    gridToCanvas(gridX, gridY) {
        return {
            x: (gridX + 0.5) * this.pxPerSquare,
            y: (this.ydim - (gridY + 0.5)) * this.pxPerSquare
        };
    }
    setCell(x, y, type) {
        if (x >= 0 && x < this.xdim && y >= 0 && y < this.ydim) {
            this.cellType[x + y * this.xdim] = type;
            this._requestPaint();
        }
    }

    placePresetBarrier() {
        const selectedIndex = this.barrierSelect.selectedIndex;
        if (selectedIndex === 0) return;
        this._saveState();
        this.clearBarriers();
        const shapeName = this.barrierSelect.options[selectedIndex].text;
        const centerX = Math.round(this.xdim / 3),
            centerY = Math.round(this.ydim / 2);
        const action = (x, y) => this.setCell(x, y, this.CELL_TYPE.BARRIER);
        switch (shapeName) {
            case "Linha curta":
                for (let y = centerY - 5; y <= centerY + 5; y++) action(centerX, y);
                break;
            case "Linha longa":
                for (let y = centerY - 10; y <= centerY + 10; y++) action(centerX, y);
                break;
            case "Diagonal":
                for (let i = -8; i <= 8; i++) action(centerX + i, centerY + i);
                break;
            case "Diagonal suave":
                for (let i = -10; i <= 10; i++) action(centerX + i, centerY + Math.round(i / 2));
                break;
            case "Círculo pequeno":
                for (let a = 0; a < 2 * Math.PI; a += 0.2) action(centerX + Math.round(6 * Math.cos(a)), centerY + Math.round(6 * Math.sin(a)));
                break;
            case "Círculo grande":
                for (let a = 0; a < 2 * Math.PI; a += 0.1) action(centerX + Math.round(10 * Math.cos(a)), centerY + Math.round(10 * Math.sin(a)));
                break;
            case "Ângulo reto":
                for (let y = centerY; y <= centerY + 10; y++) action(centerX, y);
                for (let x = centerX; x <= centerX + 10; x++) action(x, centerY);
                break;
            case "Cunha":
                for (let i = 0; i <= 10; i++) {
                    action(centerX + i, centerY + i);
                    action(centerX + i, centerY - i);
                }
                break;
            case "Retângulo arredondado":
                const w = 15,
                    h = 10,
                    r = 4;
                for (let x = centerX - w + r; x <= centerX + w - r; x++) {
                    action(x, centerY - h);
                    action(x, centerY + h);
                }
                for (let y = centerY - h + r; y <= centerY + h - r; y++) {
                    action(centerX - w, y);
                    action(centerX + w, y);
                }
                for (let a = Math.PI; a < 1.5 * Math.PI; a += 0.1 / r) action(centerX - w + r + Math.round(r * Math.cos(a)), centerY - h + r + Math.round(r * Math.sin(a)));
                for (let a = 1.5 * Math.PI; a < 2 * Math.PI; a += 0.1 / r) action(centerX + w - r + Math.round(r * Math.cos(a)), centerY - h + r + Math.round(r * Math.sin(a)));
                for (let a = 0; a < 0.5 * Math.PI; a += 0.1 / r) action(centerX + w - r + Math.round(r * Math.cos(a)), centerY + h - r + Math.round(r * Math.sin(a)));
                for (let a = 0.5 * Math.PI; a < Math.PI; a += 0.1 / r) action(centerX - w + r + Math.round(r * Math.cos(a)), centerY + h - r + Math.round(r * Math.sin(a)));
                break;
        }
        this.initFluid();
        this.barrierSelect.selectedIndex = 0;
    }

    _saveState() {
        this.undoStack.push({
            cellTypes: [...this.cellType],
            dyeSources: JSON.parse(JSON.stringify(this.dyeSources))
        });
        this.redoStack = [];
        this._updateUndoRedoButtons();
    }
    undo() {
        if (this.undoStack.length <= 1) return;
        this.redoStack.push(this.undoStack.pop());
        const prevState = this.undoStack[this.undoStack.length - 1];
        this.cellType = [...prevState.cellTypes];
        this.dyeSources = JSON.parse(JSON.stringify(prevState.dyeSources));
        this.initFluid();
        this._updateUndoRedoButtons();
    }
    redo() {
        if (this.redoStack.length === 0) return;
        const nextState = this.redoStack.pop();
        this.undoStack.push(nextState);
        this.cellType = [...nextState.cellTypes];
        this.dyeSources = JSON.parse(JSON.stringify(nextState.dyeSources));
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
            cellTypes: this.cellType,
            dyeSources: this.dyeSources,
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
        this.cellType = config.cellTypes;
        this.dyeSources = config.dyeSources || [];
        this._saveState();
        this.initFluid();
        this.initTracers();
        this.initDyeTracers();
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

document.addEventListener('DOMContentLoaded', () => {
    new FluidSimulation('main');
});
