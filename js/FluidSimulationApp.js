import { FluidSolver } from './FluidSolver.js?v=20260713p';
import { Renderer } from './Renderer.js?v=20260713p';

/**
 * @class FluidSimulationApp
 * @description Controlador da aplicação: DOM, ferramentas de edição, undo/redo e
 * import/export de configuração. Orquestra um FluidSolver (física) e um Renderer (canvas).
 */
export class FluidSimulationApp {
    static PX_PER_SQUARE = 5;
    static GRID_SIZE_MULTIPLIER = 1;
    static MIN_ZOOM = 1 / FluidSimulationApp.GRID_SIZE_MULTIPLIER;
    static MAX_ZOOM = 8;
    static ZOOM_STEP = 1.15;
    static MAX_SOURCE_SPEED = 0.15;
    static DRAG_CELLS_FOR_MAX_SPEED = 20;
    // Espelha Renderer.drawDirectionHandle's VELOCITY_TO_PIXELS (300) — precisa bater com o
    // desenho pra achar a PONTA da seta em coordenadas de grade no hit-test de clique/arraste
    // (_findSourceGroupNear). pxPerSquare aqui é o valor BASE (sem zoom), igual ao passado pro
    // Renderer — o mesmo espaço de coordenadas que canvasToGrid() já devolve.
    static DIRECTION_HANDLE_TIP_SCALE = 300 / FluidSimulationApp.PX_PER_SQUARE;
    // Multiplicador de pxPerSquare pro contorno suave de uma linha (puramente cosmético, ver
    // Renderer.drawSmoothLineShapes). bugs.md #29 pediu 1.0 (mais fina que o padrão antigo de
    // 2.1), mas 1.0 fica ABAIXO do mínimo teórico (~1.414x) pra cobrir o pior caso de desvio de
    // canto da rasterização — na prática mostrava espinhos visíveis até em zoom normal numa
    // diagonal genérica (não só em 45° exato/zoom extremo, como o teste inicial sugeriu). 1.75
    // já foi testado extensivamente sem espinhos em vários ângulos/zooms. Quem quiser mais fina
    // mesmo assim ainda pode digitar até 1.0 no campo "Espessura" do painel, por forma.
    static DEFAULT_LINE_WIDTH = 1.75;
    static AUTOSAVE_KEY = 'fluidSim.autoSave.v1';
    static AUTOSAVE_DEBOUNCE_MS = 1000;
    static PROJECTS_KEY = 'fluidSim.projects.v1';

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
        this._initTooltip();
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
        // A ribbon de ferramentas vive em .ribbon, fora de <main> (this.root) — precisa de
        // document.querySelectorAll, não this.root, senão a busca não encontra nada.
        this.toolButtons = document.querySelectorAll('.tool-button');
        this.startButton = document.querySelector('#startButton');
        this.resetFluidButton = document.querySelector('#resetFluidButton');
        this.stepButton = document.querySelector('#stepButton');
        this.clearButton = document.querySelector('#clearButton');
        this.zoomUndoButton = document.querySelector('#zoomUndoButton');
        this.zoomRedoButton = document.querySelector('#zoomRedoButton');
        this.importButton = document.querySelector('#importButton');
        this.exportButton = document.querySelector('#exportButton');
        this.screenshotButton = document.querySelector('#screenshotButton');
        this.zoomOutButton = document.querySelector('#zoomOutButton');
        this.zoomInButton = document.querySelector('#zoomInButton');
        this.resetZoomButton = document.querySelector('#resetZoomButton');
        this.newProjectButton = document.querySelector('#newProjectButton');
        this.saveProjectButton = document.querySelector('#saveProjectButton');
        this.saveAsProjectButton = document.querySelector('#saveAsProjectButton');
        this.openProjectButton = document.querySelector('#openProjectButton');
        this.projectIndicator = document.querySelector('#projectIndicator');
        // A barra de menu vive em <header>, fora de <main> (this.root) — precisa de
        // document.querySelectorAll, não this.root, senão a busca não encontra nada.
        this.menuItems = document.querySelectorAll('.menu-item');
        this.boundaryModeSelect = this.root.querySelector('#boundaryModeSelect');
        this.paintTypeButtons = this.root.querySelectorAll('.paint-type-button');
        this.stepsSlider = this.root.querySelector('#stepsSlider');
        this.viscSlider = this.root.querySelector('#viscSlider');
        this.viscValue = this.root.querySelector('#viscValue');
        this.viscosityPresetSelect = this.root.querySelector('#viscosityPresetSelect');
        this.viscosityHelp = this.root.querySelector('#viscosityHelp');
        this.rotorMassSlider = this.root.querySelector('#rotorMassSlider');
        this.rotorMassValue = this.root.querySelector('#rotorMassValue');
        this.rotorDampingSlider = this.root.querySelector('#rotorDampingSlider');
        this.rotorDampingValue = this.root.querySelector('#rotorDampingValue');
        this.rotorStiffnessSlider = this.root.querySelector('#rotorStiffnessSlider');
        this.rotorStiffnessValue = this.root.querySelector('#rotorStiffnessValue');
        this.rotorStiffnessHelp = this.root.querySelector('#rotorStiffnessHelp');
        this.floatingPropertyPanel = this.root.querySelector('#floatingPropertyPanel');
        this.floatingPanelHeader = this.root.querySelector('.floating-panel-header');
        this.simulationControlsWidget = this.root.querySelector('#simulationControlsWidget');
        this.valveControlsWidget = this.root.querySelector('#valveControlsWidget');
        this.floatingPanelTitle = this.root.querySelector('#floatingPanelTitle');
        this.floatingPanelCloseButton = this.root.querySelector('#floatingPanelCloseButton');
        this.floatingPanelPositionEdit = this.root.querySelector('#floatingPanelPositionEdit');
        this.floatingPanelXInput = this.root.querySelector('#floatingPanelXInput');
        this.floatingPanelYInput = this.root.querySelector('#floatingPanelYInput');
        this.floatingPanelGeometryLine = this.root.querySelector('#floatingPanelGeometryLine');
        this.floatingPanelGeometryRect = this.root.querySelector('#floatingPanelGeometryRect');
        this.floatingPanelLengthInput = this.root.querySelector('#floatingPanelLengthInput');
        this.floatingPanelAngleInput = this.root.querySelector('#floatingPanelAngleInput');
        this.floatingPanelWidthInput = this.root.querySelector('#floatingPanelWidthInput');
        this.floatingPanelHeightInput = this.root.querySelector('#floatingPanelHeightInput');
        this.floatingPanelLineWidthInput = this.root.querySelector('#floatingPanelLineWidthInput');
        this.floatingPanelSourceControls = this.root.querySelector('#floatingPanelSourceControls');
        this.floatingPanelSpeedInput = this.root.querySelector('#floatingPanelSpeedInput');
        this.floatingPanelFlowAngleInput = this.root.querySelector('#floatingPanelFlowAngleInput');
        this.floatingPanelRotorControls = this.root.querySelector('#floatingPanelRotorControls');
        this.deleteShapeButton = this.root.querySelector('#deleteShapeButton');
        this.visualizationHelp = this.root.querySelector('#visualizationHelp');
        this.plotSelect = this.root.querySelector('#plotSelect');
        this.contrastSlider = this.root.querySelector('#contrastSlider');
        this.tracerCheck = this.root.querySelector('#tracerCheck');
        this.forceCheck = this.root.querySelector('#forceCheck');
        this.arrowsCheck = this.root.querySelector('#arrowsCheck');
        this.sensorCheck = this.root.querySelector('#sensorCheck');
        this.speedReadout = this.root.querySelector('#speedReadout');
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
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.panStart = null;
        this.activePaintType = 'barrier';
        this.pendingSourceCells = null;
        this.pendingRotorCells = null;
        this.awaitingDirectionDrag = false;
        this.directionDragOrigin = null;
        this.directionDragVx = 0;
        this.directionDragVy = 0;
        this.editingSourceGroupIndex = -1;
        this.selectedRotorIndex = -1;
        this.rotorDefaults = {
            massMultiplier: 1,
            damping: 0.05,
            stiffness: 0
        };
        this.activeProjectId = null;
        this.activeProjectName = null;
        this.hasUnsavedChanges = false;
        // Antes do primeiro passo físico (grade "intocada"), o canvas fica neutro/branco — uma
        // vez que a simulação rodou pelo menos uma vez, passa a mostrar a paleta completa
        // sempre (inclusive azul pra zero), mesmo depois de pausar. Reseta em initFluid().
        this.hasEverStepped = false;
        // Formas vetoriais (linha/retângulo/elipse/arredondado) — fonte de verdade pras
        // ferramentas de forma; solver.cellType é derivado delas + rawCellType (ver
        // _rasterizeShapes). rawCellType em si é (re)criado em _resetSimulation, já que
        // depende do tamanho da grade.
        this.shapes = [];
        this._nextShapeId = 1;
        this.selectedShapeIndex = -1;
        this.draggingShapeHandle = null;
        this.draggingRotorPivot = null;
        this.selectedDyeSourceIndex = -1;
        this.draggingDyeSource = null;
    }

    /**
     * @private
     * @description Cria o renderer e inicializa a simulação pela primeira vez.
     */
    _setupCanvas() {
        this.renderer = new Renderer(this.canvas);
        // Cria uma simulação em branco primeiro — _applyConfiguration (usada pelo restore
        // abaixo) espera um this.solver já existente (mesma pré-condição que a Importação
        // normal sempre teve, já que lá o usuário só clica Importar depois do app já estar de
        // pé). Restaurar o autosave por cima é barato e evita duplicar essa pré-condição.
        this._resetSimulation();
        this._tryRestoreAutoSave();
        this._updateProjectIndicator();
    }

    /**
     * @private
     * @description Tenta restaurar a última sessão salva automaticamente (localStorage), pra
     * que dar F5 ou fechar a aba sem exportar não jogue o desenho fora. Retorna false (e não
     * mexe em nada) se não houver autosave, se estiver corrompido, ou se for de um formato
     * antigo demais pra ser aplicado com segurança.
     */
    _tryRestoreAutoSave() {
        let raw;
        try {
            raw = localStorage.getItem(FluidSimulationApp.AUTOSAVE_KEY);
        } catch (err) {
            return false;
        }
        if (!raw) return false;
        try {
            const config = JSON.parse(raw);
            if (!config || config.version < 15) return false;
            this._applyConfiguration(config, { silent: true });
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'info',
                title: 'Sessão anterior restaurada automaticamente',
                showConfirmButton: false,
                timer: 2500,
                timerProgressBar: true
            });
            return true;
        } catch (err) {
            console.warn('Autosave corrompido, ignorando:', err);
            return false;
        }
    }

    /**
     * @private
     * @description Salva o estado atual (geometria + parâmetros) no localStorage, com debounce
     * pra não escrever a cada célula pintada — só depois de uma pausa nas edições. Ver também
     * `_flushAutoSaveSync`, a rede de segurança pra quando a página fecha/recarrega ANTES desse
     * debounce disparar (senão um F5 imediato depois de desenhar perderia o desenho).
     */
    _scheduleAutoSave() {
        clearTimeout(this._autoSaveTimeout);
        this._autoSaveTimeout = setTimeout(() => this._writeAutoSave(), FluidSimulationApp.AUTOSAVE_DEBOUNCE_MS);
    }

    _writeAutoSave() {
        try {
            localStorage.setItem(FluidSimulationApp.AUTOSAVE_KEY, JSON.stringify(this._buildConfigObject()));
        } catch (err) {
            console.warn('Autosave falhou:', err);
        }
    }

    /**
     * @private
     * @description Grava o autosave imediatamente (sem esperar o debounce) — chamado quando a
     * aba está prestes a ficar oculta ou fechar (`visibilitychange`/`pagehide`). Sem isso, um
     * F5 logo após desenhar (antes do debounce de 1s completar) perderia a edição.
     */
    _flushAutoSaveSync() {
        clearTimeout(this._autoSaveTimeout);
        this._writeAutoSave();
    }

    /**
     * @private
     * @description Associa todos os listeners de eventos aos elementos do DOM.
     */
    _bindEventListeners() {
        this.startButton.addEventListener('click', () => this.startStop());
        this.resetFluidButton.addEventListener('click', () => {
            // Bug 23: confirmação para ação potencialmente destrutiva
            Swal.fire({
                title: 'Reiniciar o fluido?',
                text: 'O campo de escoamento será zerado. As barreiras, entradas e saídas desenhadas serão mantidas.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: '<i class="fa-solid fa-arrow-rotate-left"></i> Reiniciar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#ffb454',
                reverseButtons: true
            }).then(result => {
                if (result.isConfirmed) this.initFluid();
            });
        });
        this.stepButton.addEventListener('click', () => this.simulateSingleStep());
        this.clearButton.addEventListener('click', () => {
            // Bug 23: confirmação para ação destrutiva (limpa tudo, incluindo barreiras)
            Swal.fire({
                title: 'Limpar tudo?',
                text: 'Todas as barreiras, entradas, saídas e rotores serão apagados. Esta ação não pode ser desfeita.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: '<i class="fa-solid fa-trash-can"></i> Limpar tudo',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#ff5d5d',
                reverseButtons: true
            }).then(result => {
                if (result.isConfirmed) {
                    this._saveState();
                    this.clearBarriers();
                }
            });
        });
        this.zoomUndoButton.addEventListener('click', () => this.undo());
        this.zoomRedoButton.addEventListener('click', () => this.redo());
        this.importButton.addEventListener('click', () => this._importConfiguration());
        this.exportButton.addEventListener('click', () => this._exportConfiguration());
        this.screenshotButton.addEventListener('click', () => this._takeScreenshot());
        this.newProjectButton.addEventListener('click', () => this._newProject());
        this.saveProjectButton.addEventListener('click', () => this._saveProject());
        this.saveAsProjectButton.addEventListener('click', () => this._saveProjectAs());
        this.openProjectButton.addEventListener('click', () => this._openProjectPicker());
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
        this.zoomOutButton.addEventListener('click', () => this._zoomBy(1 / FluidSimulationApp.ZOOM_STEP));
        this.zoomInButton.addEventListener('click', () => this._zoomBy(FluidSimulationApp.ZOOM_STEP));
        this.resetZoomButton.addEventListener('click', () => this._resetView());
        this.boundaryModeSelect.addEventListener('change', () => {
            // Só troca o modo de contorno e reinicia o campo de escoamento — preserva a
            // geometria já desenhada (Barreira/Entrada/Saída/Rotor). Antes chamava
            // _resetSimulation(), que recria a grade do zero e apaga tudo.
            this.solver.boundaryMode = this.boundaryModeSelect.value;
            this.initFluid();
            this._markDirty();
        });
        this.paintTypeButtons.forEach(button => {
            button.addEventListener('click', () => this._setActivePaintType(button.dataset.paintType));
        });
        this.viscSlider.addEventListener('input', () => this.adjustViscosity());
        this.viscosityPresetSelect.addEventListener('change', () => this._applyViscosityPreset());
        this.rotorMassSlider.addEventListener('input', () => {
            this.rotorMassValue.innerHTML = Number(this.rotorMassSlider.value).toFixed(1);
            this._writeRotorProperty('massMultiplier', Number(this.rotorMassSlider.value));
            this._markDirty();
        });
        this.rotorDampingSlider.addEventListener('input', () => {
            this.rotorDampingValue.innerHTML = Number(this.rotorDampingSlider.value).toFixed(3);
            this._writeRotorProperty('damping', Number(this.rotorDampingSlider.value));
            this._markDirty();
        });
        this.rotorStiffnessSlider.addEventListener('input', () => {
            this.rotorStiffnessValue.innerHTML = Number(this.rotorStiffnessSlider.value).toFixed(3);
            this._writeRotorProperty('stiffness', Number(this.rotorStiffnessSlider.value));
            this._markDirty();
        });
        this.rotorStiffnessHelp.addEventListener('click', () => this._showRotorStiffnessHelp());
        this.floatingPanelCloseButton.addEventListener('click', () => {
            this.selectedShapeIndex = -1;
            this.selectedRotorIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        });
        this.deleteShapeButton.addEventListener('click', () => this._deleteSelectedShape());
        [this.floatingPanelLengthInput, this.floatingPanelAngleInput, this.floatingPanelWidthInput, this.floatingPanelHeightInput].forEach(input => {
            input.addEventListener('change', () => this._applyTypedGeometry());
            // Enter confirma sem precisar sair do campo (blur já cobre o change padrão).
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') input.blur();
            });
        });
        this.floatingPanelLineWidthInput.addEventListener('change', () => this._applyLineWidth());
        this.floatingPanelLineWidthInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.floatingPanelLineWidthInput.blur();
        });
        [this.floatingPanelSpeedInput, this.floatingPanelFlowAngleInput].forEach(input => {
            input.addEventListener('change', () => this._applySourceVelocity());
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') input.blur();
            });
        });
        [this.floatingPanelXInput, this.floatingPanelYInput].forEach(input => {
            input.addEventListener('change', () => this._applyPosition());
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') input.blur();
            });
        });
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
        this.arrowsCheck.addEventListener('change', () => this._requestPaint());
        this.sensorCheck.addEventListener('change', () => this._requestPaint());
        this.speedSlider.addEventListener('input', () => this.adjustSpeed());

        this._setupResizeObserver();
        this._bindMenuBar();
        this.toolButtons.forEach(button => {
            button.addEventListener('click', () => this._setActiveTool(button.dataset.tool));
        });
        this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseleave', this._handleMouseLeave.bind(this));
        document.body.addEventListener('mouseup', this._handleMouseUp.bind(this));
        this.canvasContainer.addEventListener('wheel', this._handleWheelZoom.bind(this), { passive: false });
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
                if (this.awaitingDirectionDrag) this._cancelDirectionDrag();
                if (this.draggingShapeHandle) this._cancelShapeDrag();
                if (this.draggingRotorPivot) {
                    this.draggingRotorPivot = null;
                    this.mouseIsDown = false;
                    this._requestPaint();
                }
                if (this.draggingDyeSource) {
                    this.draggingDyeSource = null;
                    this.mouseIsDown = false;
                    this._requestPaint();
                }
                if (this.selectedDyeSourceIndex >= 0) {
                    this.selectedDyeSourceIndex = -1;
                    this._updateFloatingPanel();
                    this._requestPaint();
                }
                if (this.selectedRotorIndex >= 0) {
                    this.selectedRotorIndex = -1;
                    this._updateFloatingPanel();
                    this._requestPaint();
                }
                if (this.selectedShapeIndex >= 0) {
                    this.selectedShapeIndex = -1;
                    this._updateFloatingPanel();
                    this._requestPaint();
                }
                if (this.clipboard) this._clearClipboard();
                if (this.selectionArea) this._clearSelection();
                this._closeAllMenus();
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && (this.selectedShapeIndex >= 0 || this.selectedRotorIndex >= 0 || this.selectedDyeSourceIndex >= 0)) {
                const activeTag = document.activeElement && document.activeElement.tagName;
                if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
                    e.preventDefault();
                    this._deleteSelectedShape();
                }
            }
        });
        // Rede de segurança contra perder trabalho num F5/fechar aba antes do debounce do
        // autosave disparar — `visibilitychange` cobre trocar de aba/minimizar/fechar, e
        // `pagehide` cobre navegação/recarregamento (mais confiável que `beforeunload`, que
        // alguns navegadores restringem).
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this._flushAutoSaveSync();
        });
        window.addEventListener('pagehide', () => this._flushAutoSaveSync());

        this._makeDraggable(this.simulationControlsWidget, this.simulationControlsWidget);
        this._makeDraggable(this.floatingPropertyPanel, this.floatingPanelHeader);
    }

    /**
     * @private
     * @description Deixa `panel` arrastável pegando em `handle` (clique+arraste). Clicar num
     * `<button>` dentro do handle (ex.: o "×" de fechar do painel) continua funcionando como
     * clique normal, não inicia arraste. Troca `right`/`bottom`/`transform` do CSS padrão por
     * `left`/`top` explícitos assim que o primeiro arraste acontece.
     */
    _makeDraggable(panel, handle) {
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            const rect = panel.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;
            panel.style.right = '';
            panel.style.bottom = '';
            panel.style.transform = 'none';
            panel.dataset.manuallyPositioned = 'true';

            const onMove = (moveEvent) => {
                panel.style.left = `${moveEvent.clientX - offsetX}px`;
                panel.style.top = `${moveEvent.clientY - offsetY}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /**
     * @private
     * @description Bug 22 — Tooltip customizado: intercepta qualquer elemento com [data-tooltip]
     * ou [title] (exceto inputs/selects) e exibe um balão estilizado com delay de 400ms.
     * O tooltip fica acima do elemento sempre que couber na viewport, caso contrário aparece
     * abaixo. Ao mover o mouse ou pressionar um botão o tooltip some imediatamente.
     */
    _initTooltip() {
        this._tooltipEl = document.getElementById('app-tooltip');
        if (!this._tooltipEl) return;
        let _tooltipTimer = null;

        const show = (text, targetEl) => {
            clearTimeout(_tooltipTimer);
            _tooltipTimer = setTimeout(() => {
                const rect = targetEl.getBoundingClientRect();
                this._tooltipEl.textContent = text;
                // Posiciona temporariamente fora da tela pra medir largura real antes de mostrar
                this._tooltipEl.style.left = '-9999px';
                this._tooltipEl.style.top = '-9999px';
                this._tooltipEl.classList.remove('visible');

                const tw = this._tooltipEl.offsetWidth;
                const th = this._tooltipEl.offsetHeight;
                const margin = 6;
                let left = rect.left + (rect.width - tw) / 2;
                left = Math.max(margin, Math.min(window.innerWidth - tw - margin, left));

                // Acima do elemento se couber na viewport, senão abaixo
                const topAbove = rect.top - th - margin;
                const top = topAbove >= margin ? topAbove : rect.bottom + margin;

                this._tooltipEl.style.left = `${left}px`;
                this._tooltipEl.style.top = `${top}px`;
                requestAnimationFrame(() => this._tooltipEl.classList.add('visible'));
            }, 400);
        };

        const hide = () => {
            clearTimeout(_tooltipTimer);
            this._tooltipEl.classList.remove('visible');
        };

        // Delegação de eventos — captura qualquer elemento com tooltip na página inteira
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tooltip], [title]:not(input):not(select):not(textarea)');
            if (!target) { hide(); return; }
            const text = target.dataset.tooltip || target.getAttribute('title') || '';
            if (!text) { hide(); return; }
            show(text, target);
        });
        document.addEventListener('mouseout', (e) => {
            const toEl = e.relatedTarget;
            const isStillInTarget = toEl && toEl.closest('[data-tooltip], [title]:not(input):not(select):not(textarea)');
            if (!isStillInTarget) hide();
        });
        document.addEventListener('mousedown', hide);
        document.addEventListener('scroll', hide, true);
    }

    /**
     * @private
     * @description Configura um ResizeObserver para redesenhar o canvas quando o contêiner mudar de tamanho.
     */
    _setupResizeObserver() {
        // O ResizeObserver dispara uma vez sozinho assim que observe() começa, só reportando o
        // tamanho atual — esse primeiro disparo é redundante (o tamanho inicial do canvas já foi
        // tratado por _resetSimulation/_tryRestoreAutoSave no construtor) e, sem esse guard,
        // chamava _handleContainerResize→_resetView() ~100ms depois, apagando silenciosamente o
        // zoom/pan que acabou de ser restaurado do autosave (bugs.md #28).
        let firstFire = true;
        this.resizeObserver = new ResizeObserver(() => {
            if (firstFire) {
                firstFire = false;
                return;
            }
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this._handleContainerResize(), 100);
        });
        this.resizeObserver.observe(this.canvasContainer);
    }

    /**
     * @private
     * @description Liga a interação da barra de menu (Arquivo/Editar/Exibir): clicar num
     * "trigger" abre/fecha seu dropdown e fecha qualquer outro aberto; clicar num item dentro
     * do dropdown fecha o menu depois (a ação em si já está ligada nos botões individualmente);
     * clique fora de qualquer menu, ou Escape (tratado no listener de keydown), fecha tudo.
     */
    _bindMenuBar() {
        this.menuItems.forEach(item => {
            const trigger = item.querySelector('.menu-trigger');
            const dropdown = item.querySelector('.menu-dropdown');
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = dropdown.classList.contains('open');
                this._closeAllMenus();
                if (!wasOpen) dropdown.classList.add('open');
            });
            dropdown.addEventListener('click', (e) => {
                if (e.target.closest('button')) this._closeAllMenus();
            });
        });
        document.addEventListener('click', () => this._closeAllMenus());
    }

    _closeAllMenus() {
        document.querySelectorAll('.menu-dropdown.open').forEach(dropdown => dropdown.classList.remove('open'));
    }

    /**
     * @private
     * @description Lida com o redimensionamento do contêiner do canvas.
     */
    _handleContainerResize() {
        this.canvas.width = this.canvasContainer.clientWidth;
        this.canvas.height = this.canvasContainer.clientHeight;
        this._resetView();
        this._requestPaint();
    }

    /**
     * @private
     * @description Restaura zoom=1 e centraliza a grade na viewport. Com a grade maior que a
     * janela (padrão desde o multiplicador de tamanho), ancorar em panX=panY=0 mostrava só o
     * canto superior esquerdo — centralizar dá uma visão inicial mais útil.
     */
    _resetView() {
        this.zoom = 1;
        const viewportWidth = this.canvas.width - Renderer.RULER_SIZE;
        const viewportHeight = this.canvas.height - Renderer.RULER_SIZE;
        const gridContentWidth = this.solver.xdim * this.pxPerSquare;
        const gridContentHeight = this.solver.ydim * this.pxPerSquare;
        this.panX = (viewportWidth - gridContentWidth * this.zoom) / 2;
        this.panY = (viewportHeight - gridContentHeight * this.zoom) / 2;
        this._requestPaint();
    }

    /**
     * @private
     * @description Aplica zoom com a roda do mouse, mantendo o ponto sob o cursor fixo na tela.
     */
    _handleWheelZoom(e) {
        e.preventDefault();
        const rect = this.canvasContainer.getBoundingClientRect();
        const factor = e.deltaY < 0 ? FluidSimulationApp.ZOOM_STEP : 1 / FluidSimulationApp.ZOOM_STEP;
        this._zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }

    /**
     * @private
     * @description Aplica zoom pelos botões +/-, centrado no meio da área visível do canvas.
     */
    _zoomBy(factor) {
        this._zoomAt(factor, this.canvasContainer.clientWidth / 2, this.canvasContainer.clientHeight / 2);
    }

    /**
     * @private
     * @description Muda o zoom por `factor`, mantendo o ponto (pivotX, pivotY) — relativo ao
     * contêiner do canvas — fixo na tela.
     */
    _zoomAt(factor, pivotX, pivotY) {
        const contentX = (pivotX - this.panX) / this.zoom;
        const contentY = (pivotY - this.panY) / this.zoom;

        const newZoom = Math.min(FluidSimulationApp.MAX_ZOOM, Math.max(FluidSimulationApp.MIN_ZOOM, this.zoom * factor));

        this.panX = pivotX - contentX * newZoom;
        this.panY = pivotY - contentY * newZoom;
        this.zoom = newZoom;
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
        // Enquanto a simulação está rodando, isto dispara a cada quadro — mas como é um
        // debounce, só grava de fato quando as chamadas pararem (pausar/parar), nunca durante
        // a animação contínua. Cobre todo ponto de edição sem precisar listar cada um.
        if (this.solver) this._scheduleAutoSave();
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
     * @description Reseta toda a simulação para um estado inicial. Sem argumentos, a grade é
     * dimensionada para preencher a janela atual (novo cenário em branco). Passando xdim/ydim
     * (vindo de uma configuração importada), a grade usa exatamente essas dimensões — a grade
     * de uma cena salva é uma propriedade dela mesma, não deve depender do tamanho da janela de
     * quem está importando; zoom/pan cuidam de exibir uma grade maior ou menor que a viewport.
     */
    _resetSimulation(xdim, ydim) {
        this.pxPerSquare = FluidSimulationApp.PX_PER_SQUARE;
        this.canvas.width = this.canvasContainer.clientWidth;
        this.canvas.height = this.canvasContainer.clientHeight;
        if (xdim === undefined || ydim === undefined) {
            const viewportXdim = Math.floor((this.canvasContainer.clientWidth - Renderer.RULER_SIZE) / this.pxPerSquare);
            const viewportYdim = Math.floor((this.canvasContainer.clientHeight - Renderer.RULER_SIZE) / this.pxPerSquare);
            xdim = viewportXdim * FluidSimulationApp.GRID_SIZE_MULTIPLIER;
            ydim = viewportYdim * FluidSimulationApp.GRID_SIZE_MULTIPLIER;
        }

        this.solver = new FluidSolver(xdim, ydim);
        this.solver.boundaryMode = this.boundaryModeSelect.value;
        this.solver.initFluid(this.solver.boundaryMode === 'open' ? 0 : Number(this.speedSlider.value));
        this.solver.initTracers(this.tracerCheck.checked);
        this.solver.initDyeTracers();

        this.rawCellType = new Uint8Array(xdim * ydim);
        // Marca quais células são cobertas por uma forma vetorial tipo 'line' — o Renderer usa
        // isso pra NÃO desenhar o preenchimento bruto (quadriculado) ali, deixando só o traço
        // vetorial suave representar essas células. Sem "verdade quadriculada" nenhuma por baixo
        // pra vazar nos cantos, a espessura escolhida (mesmo bem fina) nunca mostra espinho —
        // não é mais uma questão de largura mínima cobrir o pior caso.
        this.lineCellMask = new Uint8Array(xdim * ydim);
        this.shapes = [];
        this.selectedShapeIndex = -1;
        this.draggingShapeHandle = null;

        this.undoStack = [];
        this.redoStack = [];

        this._clearSelection();
        this._clearClipboard();
        this._setActiveTool('brush'); // Garante estado de UI consistente
        this._setActivePaintType('barrier');
        this._updateUndoRedoButtons();
        this._resetView();
        this.selectedRotorIndex = -1;
        if (this.rotorMassSlider) this._updateFloatingPanel();

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
        // Seleção de forma/Rotor/Entrada só faz sentido com o Ponteiro ativo — trocar pra
        // qualquer outra ferramenta (desenho, borracha, fumaça) desmarca, senão o painel
        // flutuante fica preso na tela enquanto o usuário desenha em outro lugar.
        if (toolName !== 'pointer' && (this.selectedShapeIndex >= 0 || this.selectedRotorIndex >= 0 || this.selectedDyeSourceIndex >= 0)) {
            this.selectedShapeIndex = -1;
            this.selectedRotorIndex = -1;
            this.selectedDyeSourceIndex = -1;
            this._updateFloatingPanel();
        }
        this.activeTool = toolName;
        this.toolButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tool === toolName);
        });

        this.canvasContainer.classList.toggle('tool-pan', toolName === 'pan');
        this.canvasContainer.classList.toggle('tool-pointer', toolName === 'pointer');
    }

    /**
     * @private
     * @param {string} paintType - 'barrier' | 'source' | 'sink'
     * @description Define o que as ferramentas de forma (linha/retângulo/elipse/etc.) desenham.
     */
    _setActivePaintType(paintType) {
        this.activePaintType = paintType;
        this.paintTypeButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.paintType === paintType);
        });
    }

    /**
     * @private
     * @description Retorna o CELL_TYPE correspondente ao tipo de pintura ativo no momento.
     */
    _activeCellType() {
        switch (this.activePaintType) {
            case 'source':
                return FluidSolver.CELL_TYPE.SOURCE;
            case 'sink':
                return FluidSolver.CELL_TYPE.SINK;
            case 'rotor':
                return FluidSolver.CELL_TYPE.ROTOR;
            case 'valve':
                return FluidSolver.CELL_TYPE.VALVE;
            default:
                return FluidSolver.CELL_TYPE.BARRIER;
        }
    }

    _handleMouseDown(e) {
        e.preventDefault();
        if (this.activeTool === 'pan') {
            this.mouseIsDown = true;
            this.panStart = {
                x: e.pageX,
                y: e.pageY,
                panX: this.panX,
                panY: this.panY
            };
            this.canvasContainer.classList.add('panning');
            return;
        }
        const canvasLoc = this.pageToCanvas(e.pageX, e.pageY);
        const gridLoc = this.canvasToGrid(canvasLoc.x, canvasLoc.y);

        if (this.awaitingDirectionDrag) {
            this.mouseIsDown = true;
            return;
        }

        // Seleção implícita (Entrada/Rotor/forma vetorial por clique perto de um ponto de
        // interesse) só é tentada com a ferramenta Ponteiro ativa — senão um clique com
        // Linha/Fumaça/Borracha em cima de algo já existente "sequestra" o gesto pra seleção
        // em vez de desenhar/apagar/pintar ali, que era exatamente o bug reportado (não dava
        // pra encostar uma linha nova na ponta de outra, nem soltar fumaça sobre uma barreira).
        const clickedSourceGroupIndex = this.activeTool === 'pointer' ? this._findSourceGroupNear(gridLoc) : -1;
        if (clickedSourceGroupIndex >= 0) {
            this._beginSourceGroupEdit(clickedSourceGroupIndex);
            this.mouseIsDown = true;
            return;
        }

        const clickedRotorIndex = this.activeTool === 'pointer' ? this._findRotorNearPivot(gridLoc) : -1;
        if (clickedRotorIndex >= 0) {
            this.selectedRotorIndex = clickedRotorIndex;
            this.selectedShapeIndex = -1;
            const body = this.solver.rotatingBodies[clickedRotorIndex];
            this.draggingRotorPivot = {
                bodyIndex: clickedRotorIndex,
                originalPivot: { x: body.pivotX, y: body.pivotY }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedRotorIndex >= 0) {
            this.selectedRotorIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        }

        const clickedDyeSourceIndex = this.activeTool === 'pointer' ? this._findDyeSourceNear(gridLoc) : -1;
        if (clickedDyeSourceIndex >= 0) {
            this.selectedDyeSourceIndex = clickedDyeSourceIndex;
            this.draggingDyeSource = {
                index: clickedDyeSourceIndex,
                originalPos: { ...this.solver.dyeSources[clickedDyeSourceIndex] }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedDyeSourceIndex >= 0) {
            this.selectedDyeSourceIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        }

        // Seleção/stretch de formas vetoriais (Barreira/Entrada/Saída/Rotor desenhadas com
        // linha/retângulo/elipse/arredondado) — mesma regra acima: só com o Ponteiro ativo.
        const handle = this.activeTool === 'pointer' ? this._findShapeHandleNear(gridLoc) : null;
        if (handle) {
            this._saveState();
            this.selectedRotorIndex = -1;
            this.selectedShapeIndex = handle.shapeIndex;
            this.draggingShapeHandle = {
                shapeIndex: handle.shapeIndex,
                handle: handle.handle,
                startGridLoc: gridLoc,
                originalShape: { ...this.shapes[handle.shapeIndex] }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            // O painel abre perto da seleção — se ficar clicável durante o arraste, ele mesmo
            // intercepta os mousemove/mouseup destinados ao canvas (é um elemento sobreposto).
            // Sem pointer-events:none aqui, esticar/mover pra baixo ou pra direita da forma trava
            // assim que o cursor entra na área do painel.
            this.floatingPropertyPanel.style.pointerEvents = 'none';
            this._requestPaint();
            return;
        }
        const bodyShapeIndex = this.activeTool === 'pointer' ? this._findShapeBodyNear(gridLoc) : -1;
        if (bodyShapeIndex >= 0) {
            this._saveState();
            this.selectedRotorIndex = -1;
            this.selectedShapeIndex = bodyShapeIndex;
            this.draggingShapeHandle = {
                shapeIndex: bodyShapeIndex,
                handle: 'body',
                startGridLoc: gridLoc,
                originalShape: { ...this.shapes[bodyShapeIndex] }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            this.floatingPropertyPanel.style.pointerEvents = 'none';
            this._requestPaint();
            return;
        }
        if (this.selectedShapeIndex >= 0) {
            this.selectedShapeIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        }

        if (this.clipboard) {
            this._pasteSelection(gridLoc);
            return;
        }

        this.mouseIsDown = true;
        this.toolStartPoint = gridLoc;
        if (this.activePaintType === 'source') this.pendingSourceCells = [];
        if (this.activePaintType === 'rotor') this.pendingRotorCells = [];

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

        if (['brush', 'fill', 'smoke', 'eraser_line'].includes(this.activeTool)) {
            this._saveState();
        }

        switch (this.activeTool) {
            case 'brush':
                this._paintRawCell(gridLoc.x, gridLoc.y, this._activeCellType());
                this._rasterizeShapes();
                this.lastDrawPoint = gridLoc;
                break;
            case 'eraser_line':
                // Nova ferramenta: borracha em traço livre, apaga célula a célula na diagonal
                // (bugs.md #46). A borracha original (retângulo) continua inalterada.
                this._eraseAt(gridLoc);
                this.lastDrawPoint = gridLoc;
                break;
            case 'fill':
                this._floodFill(gridLoc.x, gridLoc.y);
                break;
            case 'smoke':
                if (gridLoc.x >= 0 && gridLoc.y >= 0) {
                    // Fonte de fumaça tem tipo próprio — não pode ser barreira, entrada, saída,
                    // válvula, rotor ou qualquer outro tipo físico (bugs.md #47). Força a célula
                    // subjacente para NORMAL antes de registrar o ponto: qualquer barreira ou forma
                    // vetorial que existia ali é apagada/recortada por _eraseAt, garantindo que os
                    // traçadores possam ser emitidos e fluir normalmente a partir do ponto colocado.
                    this._eraseAt(gridLoc);
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
        if (this.activeTool === 'pan') {
            if (this.mouseIsDown && this.panStart) {
                this.panX = this.panStart.panX + (e.pageX - this.panStart.x);
                this.panY = this.panStart.panY + (e.pageY - this.panStart.y);
                this._requestPaint();
            }
            return;
        }
        const canvasLoc = this.pageToCanvas(e.pageX, e.pageY);
        this.mouseGridPos = this.canvasToGrid(canvasLoc.x, canvasLoc.y);

        // Cursor de "pode clicar" sobre o pivô de um Rotor, a origem de uma seta de Entrada, ou
        // a ponta/corpo de uma forma vetorial — indica que é selecionável/reajustável antes
        // mesmo do clique.
        if (!this.mouseIsDown) {
            const hoveringHandle = this.activeTool === 'pointer' && (
                this._findRotorNearPivot(this.mouseGridPos) >= 0 ||
                this._findSourceGroupNear(this.mouseGridPos) >= 0 ||
                this._findDyeSourceNear(this.mouseGridPos) >= 0 ||
                !!this._findShapeHandleNear(this.mouseGridPos) ||
                this._findShapeBodyNear(this.mouseGridPos) >= 0
            );
            this.canvas.style.cursor = hoveringHandle ? 'pointer' : '';
        }

        if (this.awaitingDirectionDrag) {
            if (this.mouseIsDown) this._updateDirectionDrag();
            this._requestPaint();
            return;
        }

        if (this.draggingShapeHandle) {
            this._updateShapeDrag();
            this._requestPaint();
            return;
        }

        if (this.draggingRotorPivot) {
            // Preview leve: só repinta (drawRotorPivots lê o novo ponto direto de mouseGridPos
            // via viewState.draggingRotorPivot) — nada de física é tocado até soltar o mouse.
            this._requestPaint();
            return;
        }

        if (this.draggingDyeSource) {
            // Mesma ideia do pivô do Rotor: só preview (drawDyeSources lê a posição nova via
            // viewState.draggingDyeSource) — só grava de verdade no solver ao soltar, senão um
            // clique sem arrastar (só selecionar) já teria "sujado" o undo.
            this._requestPaint();
            return;
        }

        if (this.clipboard) {
            this.pastePreviewOrigin = this.mouseGridPos;
        } else if (this.mouseIsDown) {
            if (this.draggingSensor) {
                this.solver.sensorX = this.mouseGridPos.x;
                this.solver.sensorY = this.mouseGridPos.y;
            } else if (this.activeTool === 'brush' && this.lastDrawPoint) {
                if (this.mouseGridPos.x !== this.lastDrawPoint.x || this.mouseGridPos.y !== this.lastDrawPoint.y) {
                    this._drawLineOnGrid(this.lastDrawPoint, this.mouseGridPos, (x, y) => this._paintRawCell(x, y, this._activeCellType()));
                    this._rasterizeShapes();
                    this.lastDrawPoint = this.mouseGridPos;
                }
            } else if (this.activeTool === 'eraser_line' && this.lastDrawPoint) {
                // Traço contínuo da borracha linha — Bresenham do ponto anterior até o atual,
                // apagando cada célula no caminho (bugs.md #46).
                if (this.mouseGridPos.x !== this.lastDrawPoint.x || this.mouseGridPos.y !== this.lastDrawPoint.y) {
                    this._drawLineOnGrid(this.lastDrawPoint, this.mouseGridPos, (x, y) => this._eraseAt({ x, y }));
                    this.lastDrawPoint = this.mouseGridPos;
                }
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

        if (this.activeTool === 'pan') {
            this.mouseIsDown = false;
            this.panStart = null;
            this.canvasContainer.classList.remove('panning');
            return;
        }

        if (this.awaitingDirectionDrag) {
            this._confirmDirectionDrag();
            this.mouseIsDown = false;
            this._requestPaint();
            return;
        }

        if (this.draggingShapeHandle) {
            this._commitShapeReform();
            this.mouseIsDown = false;
            return;
        }

        if (this.draggingRotorPivot) {
            const bodyIndex = this.draggingRotorPivot.bodyIndex;
            const original = this.draggingRotorPivot.originalPivot;
            const dist = Math.hypot(this.mouseGridPos.x - original.x, this.mouseGridPos.y - original.y);
            // Um clique sem arrastar (só selecionar pra ver os sliders) não deve reiniciar
            // angle/omega — só confirma se o arraste passou de um limiar mínimo, mesma regra já
            // usada em _confirmDirectionDrag pro arraste da seta de Entrada.
            if (dist >= 1) {
                this._saveState();
                const body = this.solver.rotatingBodies[bodyIndex];
                // Reaproveita o mesmo caminho de "reforma" que já existe pra Rotor (substitui a
                // entrada no lugar via replaceIndex): recalcula localCells/momentOfInertia/
                // maxRadius relativos ao pivô novo, mantendo as mesmas células (a forma na tela
                // não muda, só o eixo de rotação). angle/omega reiniciam em 0, igual a qualquer
                // outra reforma — preserva massa/amortecimento/rigidez.
                this.solver.addRotatingBody(body.currentCells, { x: this.mouseGridPos.x, y: this.mouseGridPos.y }, {
                    massMultiplier: body.massMultiplier,
                    damping: body.damping,
                    stiffness: body.stiffness
                }, bodyIndex);
                this._markDirty();
            }
            this.draggingRotorPivot = null;
            this.mouseIsDown = false;
            this._requestPaint();
            return;
        }

        if (this.draggingDyeSource) {
            const original = this.draggingDyeSource.originalPos;
            const dist = Math.hypot(this.mouseGridPos.x - original.x, this.mouseGridPos.y - original.y);
            if (dist >= 1) {
                this._saveState();
                const source = this.solver.dyeSources[this.draggingDyeSource.index];
                source.x = this.mouseGridPos.x;
                source.y = this.mouseGridPos.y;
                this._markDirty();
            }
            this.draggingDyeSource = null;
            this.mouseIsDown = false;
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }

        if (this.toolStartPoint && !this.draggingSensor) {
            const endPoint = this.mouseGridPos;
            if (this.activeTool === 'select') {
                this.selectionArea = {
                    start: this.toolStartPoint,
                    end: endPoint
                };
                this.selectionOptionsPanel.hidden = false;
            } else if (this.activeTool === 'eraser') {
                this._saveState();
                this._eraseRectangleOnGrid(this.toolStartPoint, endPoint);
            } else if (!['brush', 'fill', 'smoke', 'pointer', 'eraser_line'].includes(this.activeTool)) {
                // Linha/retângulo/elipse/arredondado: vira um registro vetorial em shapes[] em
                // vez de pintura imediata — é isso que habilita selecionar/esticar/mover/apagar
                // essa forma depois (edição vetorial), no lugar de pixels sem memória de origem.
                this._saveState();
                this._commitShape(this.activeTool, this.toolStartPoint, endPoint);
            }
        }

        // Pincel/Preenchimento continuam pintura direta de pixel a pixel — a Entrada/Rotor
        // pintados assim (em vez de com uma ferramenta de forma) mantêm o caminho antigo de
        // registrar o grupo/corpo a partir das células acumuladas célula a célula.
        if (this.pendingSourceCells && this.pendingSourceCells.length > 0) {
            this.solver.addSourceGroup(this.pendingSourceCells, FluidSimulationApp.MAX_SOURCE_SPEED * 0.5, 0);
        }
        this.pendingSourceCells = null;

        if (this.pendingRotorCells && this.pendingRotorCells.length > 0) {
            this.solver.addRotatingBody(this.pendingRotorCells, null, { ...this.rotorDefaults });
        }
        this.pendingRotorCells = null;

        this._requestPaint();
        this.mouseIsDown = false;
        this.draggingSensor = false;
        this.lastDrawPoint = null;
        this.toolStartPoint = null;
    }

    /**
     * @private
     * @description Confirma uma forma desenhada com uma ferramenta vetorial (linha/retângulo/
     * elipse/arredondado): grava a geometria em `shapes[]` — fonte de verdade que habilita
     * selecionar/esticar/mover/apagar essa forma depois — e cria o registro físico associado
     * (`solver.addSourceGroup`/`addRotatingBody`) quando o tipo ativo é Entrada/Rotor, mesmo
     * caminho que já existia pra essas duas, só que a partir da geometria da forma em vez de
     * uma lista de células acumulada célula a célula durante o próprio desenho.
     */
    _commitShape(tool, start, end) {
        const cellType = this._activeCellType();
        const shape = {
            id: this._nextShapeId++,
            cellType,
            tool,
            x0: start.x,
            y0: start.y,
            x1: end.x,
            y1: end.y
        };
        const cells = [];
        this._replayShapeGeometry(shape, (x, y) => {
            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
        });
        if (cells.length === 0) return;

        if (cellType === FluidSolver.CELL_TYPE.SOURCE) {
            if (tool === 'line') {
                // Direção padrão perpendicular à própria linha (90° CCW) — senão a seta nasce
                // deitada em cima da barreira/entrada que acabou de ser desenhada e fica oculta
                // (bugs.md #6).
                const dx = end.x - start.x,
                    dy = end.y - start.y;
                const len = Math.hypot(dx, dy) || 1;
                shape.vx = (-dy / len) * FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
                shape.vy = (dx / len) * FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
            } else {
                shape.vx = FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
                shape.vy = 0;
            }
            this.solver.addSourceGroup(cells, shape.vx, shape.vy);
        } else if (cellType === FluidSolver.CELL_TYPE.ROTOR) {
            shape.massMultiplier = this.rotorDefaults.massMultiplier;
            shape.damping = this.rotorDefaults.damping;
            shape.stiffness = this.rotorDefaults.stiffness;
            this.solver.addRotatingBody(cells, null, { ...this.rotorDefaults });
        } else if (cellType === FluidSolver.CELL_TYPE.VALVE) {
            // Nasce fechada (bloqueando, como parede sólida) — precisa ser aberta explicitamente
            // pelo widget, ver bugs.md #40.
            shape.enabled = false;
        }

        this.shapes.push(shape);
        // _rasterizeShapes() pula formas ROTOR de propósito na sua rasterização normal, mas
        // reestampa todo `rotatingBodies` por cima no final (bugs.md #41) — cobre tanto este
        // Rotor recém-criado (já em `solver.rotatingBodies` pelo addRotatingBody acima) quanto
        // qualquer outro já existente na cena.
        this._rasterizeShapes();
    }

    /**
     * @private
     * @description Atualiza a geometria da forma selecionada em tempo real, durante o arraste
     * de um handle/corpo — só mexe em `this.shapes[i]` (o modelo de dados), nunca rerrasteriza
     * a grade durante o arraste em si (só no `mouseup`, via `_commitShapeReform`).
     */
    _updateShapeDrag() {
        const drag = this.draggingShapeHandle;
        const shape = this.shapes[drag.shapeIndex];
        if (drag.handle === 'x0y0') {
            shape.x0 = this.mouseGridPos.x;
            shape.y0 = this.mouseGridPos.y;
        } else if (drag.handle === 'x1y1') {
            shape.x1 = this.mouseGridPos.x;
            shape.y1 = this.mouseGridPos.y;
        } else if (drag.handle === 'body') {
            const dx = this.mouseGridPos.x - drag.startGridLoc.x;
            const dy = this.mouseGridPos.y - drag.startGridLoc.y;
            shape.x0 = drag.originalShape.x0 + dx;
            shape.y0 = drag.originalShape.y0 + dy;
            shape.x1 = drag.originalShape.x1 + dx;
            shape.y1 = drag.originalShape.y1 + dy;
        }
    }

    /**
     * @private
     * @description Desfaz um arraste de handle/corpo em andamento (Esc) — a forma volta
     * exatamente pra como estava (a rerrasterização só acontece em `mouseup`/confirmação, então
     * cancelar não precisa desfazer nada na grade, só no objeto em `shapes[]`).
     */
    _cancelShapeDrag() {
        if (!this.draggingShapeHandle) return;
        Object.assign(this.shapes[this.draggingShapeHandle.shapeIndex], this.draggingShapeHandle.originalShape);
        this.draggingShapeHandle = null;
        this.mouseIsDown = false;
        this.floatingPropertyPanel.style.pointerEvents = '';
        this._requestPaint();
    }

    /**
     * @private
     * @description Confirma (mouseup) o arraste de um handle/corpo — delega o trabalho de
     * verdade pra `_reformShapeGeometry`, que também é reaproveitada pelos campos de geometria
     * digitados no painel flutuante (mesmo caminho, duas formas de disparar).
     */
    _commitShapeReform() {
        const drag = this.draggingShapeHandle;
        const shape = this.shapes[drag.shapeIndex];
        const ok = this._reformShapeGeometry(drag.shapeIndex, drag.originalShape);
        if (!ok) Object.assign(shape, drag.originalShape);
        this.draggingShapeHandle = null;
        this.floatingPropertyPanel.style.pointerEvents = '';
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Núcleo da reforma de uma forma — usado tanto ao soltar um handle arrastado
     * quanto ao digitar um valor exato de geometria no painel. Recalcula as células a partir da
     * geometria ATUAL de `shapes[shapeIndex]`, sincroniza o registro físico de Entrada/Rotor (a
     * partir de `oldShape`, a geometria de ANTES da mudança) e rerrasteriza. Reinicia a dinâmica
     * do Rotor (ângulo/velocidade sempre voltam a 0 — não há uma forma limpa de manter
     * continuidade através de uma mudança de geometria), mas preserva o ajuste
     * (massa/amortecimento/rigidez, ou a velocidade da seta de Entrada). Retorna `false` sem
     * aplicar nada se a nova geometria for degenerada (ex.: as duas pontas no mesmo lugar).
     */
    _reformShapeGeometry(shapeIndex, oldShape) {
        const shape = this.shapes[shapeIndex];
        const cells = [];
        this._replayShapeGeometry(shape, (x, y) => {
            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
        });

        if (cells.length === 0) return false;

        if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
            const oldCells = [];
            this._replayShapeGeometry(oldShape, (x, y) => {
                if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) oldCells.push({ x, y });
            });
            // Zera sourceVx/vy nas células que a forma abandonou — senão um valor não-zero
            // grudado poderia vazar se essa célula virar parte de uma Entrada futura sem querer.
            for (const { x, y } of oldCells) {
                const i = x + y * this.solver.xdim;
                this.solver.sourceVx[i] = 0;
                this.solver.sourceVy[i] = 0;
            }
            const oldCentroid = { x: (oldShape.x0 + oldShape.x1) / 2, y: (oldShape.y0 + oldShape.y1) / 2 };
            const groupIdx = this._findSourceGroupNear(oldCentroid);
            if (groupIdx >= 0) {
                const { vx, vy } = this.solver.sourceGroups[groupIdx];
                this.solver.sourceGroups.splice(groupIdx, 1);
                this.solver.addSourceGroup(cells, vx, vy);
                shape.vx = vx;
                shape.vy = vy;
            } else {
                this.solver.addSourceGroup(cells, shape.vx, shape.vy);
            }
        } else if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            const oldCentroid = { x: (oldShape.x0 + oldShape.x1) / 2, y: (oldShape.y0 + oldShape.y1) / 2 };
            const bodyIdx = this._findRotorNearPivot(oldCentroid);
            if (bodyIdx >= 0) {
                const body = this.solver.rotatingBodies[bodyIdx];
                shape.massMultiplier = body.massMultiplier;
                shape.damping = body.damping;
                shape.stiffness = body.stiffness;
                this.solver.addRotatingBody(cells, null, {
                    massMultiplier: body.massMultiplier,
                    damping: body.damping,
                    stiffness: body.stiffness
                }, bodyIdx);
            } else {
                this.solver.addRotatingBody(cells, null, {
                    massMultiplier: shape.massMultiplier,
                    damping: shape.damping,
                    stiffness: shape.stiffness
                });
            }
        }

        this._rasterizeShapes();
        if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            for (const { x, y } of cells) {
                this.solver.cellType[x + y * this.solver.xdim] = FluidSolver.CELL_TYPE.ROTOR;
            }
            this.solver.invalidateSinkDamping();
        }
        return true;
    }

    /**
     * @private
     * @description Aplica uma geometria digitada nos campos do painel flutuante (comprimento/
     * ângulo pra linha, largura/altura pras demais) — mesmo caminho de reforma que arrastar um
     * handle, só que a partir de um valor exato em vez da posição do mouse.
     */
    _applyTypedGeometry() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        const oldShape = { ...shape };
        this._saveState();

        if (shape.tool === 'line') {
            const length = Math.max(0, Number(this.floatingPanelLengthInput.value) || 0);
            const angleRad = (Number(this.floatingPanelAngleInput.value) || 0) * Math.PI / 180;
            shape.x1 = Math.round(shape.x0 + length * Math.cos(angleRad));
            shape.y1 = Math.round(shape.y0 + length * Math.sin(angleRad));
        } else {
            const width = Math.max(1, Math.round(Number(this.floatingPanelWidthInput.value) || 1));
            const height = Math.max(1, Math.round(Number(this.floatingPanelHeightInput.value) || 1));
            const signX = shape.x1 >= shape.x0 ? 1 : -1;
            const signY = shape.y1 >= shape.y0 ? 1 : -1;
            shape.x1 = shape.x0 + signX * (width - 1);
            shape.y1 = shape.y0 + signY * (height - 1);
        }

        const ok = this._reformShapeGeometry(this.selectedShapeIndex, oldShape);
        if (!ok) Object.assign(shape, oldShape);
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Aplica a posição X/Y digitada no painel flutuante — move a forma/ponto de
     * fumaça INTEIRO pro lugar exato (mesmo efeito de arrastar o corpo/ponto, só que digitando
     * em vez de mirar com o mouse). Pra uma forma, translada os dois pontos juntos (mantém
     * comprimento/ângulo/largura/altura); reaproveita o mesmo caminho de reforma que o arraste
     * de corpo já usa.
     */
    _applyPosition() {
        const newX = Math.round(Number(this.floatingPanelXInput.value) || 0);
        const newY = Math.round(Number(this.floatingPanelYInput.value) || 0);
        if (this.selectedDyeSourceIndex >= 0) {
            this._saveState();
            const source = this.solver.dyeSources[this.selectedDyeSourceIndex];
            source.x = newX;
            source.y = newY;
            this._markDirty();
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedShapeIndex < 0 && this.selectedRotorIndex >= 0) {
            // Rotor selecionado só pelo pivô (sem forma vetorial correspondente) — move o pivô
            // pro ponto exato, mesmo caminho do arraste (_handleMouseUp/draggingRotorPivot).
            this._saveState();
            const bodyIndex = this.selectedRotorIndex;
            const body = this.solver.rotatingBodies[bodyIndex];
            this.solver.addRotatingBody(body.currentCells, { x: newX, y: newY }, {
                massMultiplier: body.massMultiplier,
                damping: body.damping,
                stiffness: body.stiffness
            }, bodyIndex);
            this._markDirty();
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        const oldShape = { ...shape };
        this._saveState();
        const dx = newX - shape.x0,
            dy = newY - shape.y0;
        shape.x0 = newX;
        shape.y0 = newY;
        shape.x1 += dx;
        shape.y1 += dy;
        const ok = this._reformShapeGeometry(this.selectedShapeIndex, oldShape);
        if (!ok) Object.assign(shape, oldShape);
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Aplica velocidade/ângulo do fluxo digitados no painel flutuante pra uma
     * Entrada selecionada — mesmo efeito de arrastar a seta, só que com um valor exato. Mantém
     * `shape.vx/vy` em sincronia com `solver.sourceGroups`/`sourceVx/vy` (mesma sincronização
     * que `_confirmDirectionDrag` já faz pro arraste).
     */
    _applySourceVelocity() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.cellType !== FluidSolver.CELL_TYPE.SOURCE) return;
        this._saveState();

        const speed = Math.max(0, Math.min(FluidSimulationApp.MAX_SOURCE_SPEED, Number(this.floatingPanelSpeedInput.value) || 0));
        const angleRad = (Number(this.floatingPanelFlowAngleInput.value) || 0) * Math.PI / 180;
        shape.vx = speed * Math.cos(angleRad);
        shape.vy = speed * Math.sin(angleRad);

        const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
        const groupIdx = this._findSourceGroupNear(centroid);
        if (groupIdx >= 0) {
            this.solver.updateSourceGroupVelocity(groupIdx, shape.vx, shape.vy);
        } else {
            this._rasterizeShapes();
        }
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Ajusta a espessura do contorno suave de uma linha (puramente cosmético, ver
     * Renderer.drawSmoothLineShapes) — não mexe em geometria/física, só reflete na tela.
     */
    _applyLineWidth() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.tool !== 'line') return;
        this._saveState();
        const width = Number(this.floatingPanelLineWidthInput.value);
        shape.lineWidth = Number.isFinite(width) ? Math.max(1, Math.min(4, width)) : FluidSimulationApp.DEFAULT_LINE_WIDTH;
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Remove a forma selecionada (Delete): some de `shapes[]` e, se for Rotor ou
     * Entrada, também do registro físico associado (rotatingBodies/sourceGroups) — senão o
     * corpo/grupo continuaria "vivo" mesmo com a forma apagada da tela.
     */
    _deleteSelectedShape() {
        if (this.selectedShapeIndex < 0) {
            // Rotor selecionado só pelo pivô (sem forma vetorial correspondente, ex.: pintado
            // com Pincel, ou o pivô é o único jeito prático de "pegar" um Rotor que já girou
            // longe da geometria de repouso) — apaga o corpo direto, sem passar por shapes[].
            if (this.selectedRotorIndex >= 0) {
                this._deleteRotorBody(this.selectedRotorIndex);
                return;
            }
            if (this.selectedDyeSourceIndex >= 0) {
                this._saveState();
                this.solver.dyeSources.splice(this.selectedDyeSourceIndex, 1);
                this.selectedDyeSourceIndex = -1;
                this._markDirty();
                this._updateFloatingPanel();
                this._requestPaint();
            }
            return;
        }
        this._saveState();
        const shape = this.shapes[this.selectedShapeIndex];
        const cells = [];
        this._replayShapeGeometry(shape, (x, y) => {
            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
        });

        if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
            for (const { x, y } of cells) {
                const i = x + y * this.solver.xdim;
                this.solver.sourceVx[i] = 0;
                this.solver.sourceVy[i] = 0;
            }
            const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
            const groupIdx = this._findSourceGroupNear(centroid);
            if (groupIdx >= 0) this.solver.sourceGroups.splice(groupIdx, 1);
        } else if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
            const bodyIdx = this._findRotorNearPivot(centroid);
            if (bodyIdx >= 0) {
                this.solver.rotatingBodies.splice(bodyIdx, 1);
                for (const { x, y } of cells) {
                    const i = x + y * this.solver.xdim;
                    if (this.solver.cellType[i] === FluidSolver.CELL_TYPE.ROTOR) {
                        this.solver.cellType[i] = FluidSolver.CELL_TYPE.NORMAL;
                        this.solver._refillCell(x, y);
                    }
                }
            }
        }

        this.shapes.splice(this.selectedShapeIndex, 1);
        this.selectedShapeIndex = -1;
        this._rasterizeShapes();
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Apaga um corpo giratório pelo índice em `rotatingBodies` — usado quando ele
     * foi selecionado só pelo pivô (sem `selectedShapeIndex`, ex.: Rotor pintado com Pincel, ou
     * já girado longe da geometria de repouso). Também remove a entrada correspondente em
     * `shapes[]`, se houver uma, pra não deixar uma forma "fantasma" sem corpo por trás.
     */
    _deleteRotorBody(bodyIndex) {
        this._saveState();
        const body = this.solver.rotatingBodies[bodyIndex];
        for (const { x, y } of body.currentCells) {
            const i = x + y * this.solver.xdim;
            if (this.solver.cellType[i] === FluidSolver.CELL_TYPE.ROTOR) {
                this.solver.cellType[i] = FluidSolver.CELL_TYPE.NORMAL;
                this.solver._refillCell(x, y);
            }
        }
        this.solver.rotatingBodies.splice(bodyIndex, 1);

        const shapeIdx = this.shapes.findIndex(s => {
            if (s.cellType !== FluidSolver.CELL_TYPE.ROTOR) return false;
            const cx = (s.x0 + s.x1) / 2,
                cy = (s.y0 + s.y1) / 2;
            return Math.hypot(cx - body.pivotX, cy - body.pivotY) <= 2;
        });
        if (shapeIdx >= 0) this.shapes.splice(shapeIdx, 1);

        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this._rasterizeShapes();
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Retorna o índice do grupo de Entrada cuja seta está perto de `gridLoc`
     * (clicável), ou -1 se nenhum estiver perto o bastante.
     */
    _findSourceGroupNear(gridLoc) {
        this.solver.pruneStaleSourceGroups();
        const groups = this.solver.sourceGroups;
        const threshold = 2;
        const scale = FluidSimulationApp.DIRECTION_HANDLE_TIP_SCALE;
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const dOrigin = Math.hypot(gridLoc.x - g.originX, gridLoc.y - g.originY);
            if (dOrigin <= threshold) return i;
            // Também pega perto da PONTA da seta, não só da origem — pegar e arrastar a ponta
            // pra apontar pra onde quiser é mais natural que precisar acertar o pontinho na base.
            const tipX = g.originX + g.vx * scale,
                tipY = g.originY + g.vy * scale;
            if (Math.hypot(gridLoc.x - tipX, gridLoc.y - tipY) <= threshold) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Entra no sub-estado de "reajustar direção" de um grupo de Entrada JÁ
     * existente — arrasta a partir da origem da seta pra redefinir direção/velocidade.
     */
    _beginSourceGroupEdit(index) {
        const group = this.solver.sourceGroups[index];
        this.editingSourceGroupIndex = index;
        this.directionDragOrigin = {
            x: group.originX,
            y: group.originY
        };
        this.directionDragVx = group.vx;
        this.directionDragVy = group.vy;
        this.awaitingDirectionDrag = true;
    }

    _updateDirectionDrag() {
        const dx = this.mouseGridPos.x - this.directionDragOrigin.x;
        const dy = this.mouseGridPos.y - this.directionDragOrigin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.min(FluidSimulationApp.MAX_SOURCE_SPEED, (dist / FluidSimulationApp.DRAG_CELLS_FOR_MAX_SPEED) * FluidSimulationApp.MAX_SOURCE_SPEED);
        if (dist > 0) {
            this.directionDragVx = (dx / dist) * speed;
            this.directionDragVy = (dy / dist) * speed;
        } else {
            this.directionDragVx = 0;
            this.directionDragVy = 0;
        }
    }

    /**
     * @private
     * @description Confirma a direção/velocidade reajustada de um grupo de Entrada existente.
     * Um clique sem arrastar (só selecionar pra olhar) não deve zerar a direção — só grava se
     * o arraste passou de um limiar mínimo; abaixo disso, mantém o que já estava lá.
     */
    _confirmDirectionDrag() {
        if (this.editingSourceGroupIndex >= 0) {
            const dragDistance = Math.sqrt(
                (this.mouseGridPos.x - this.directionDragOrigin.x) ** 2 +
                (this.mouseGridPos.y - this.directionDragOrigin.y) ** 2
            );
            if (dragDistance >= 1) {
                this.solver.updateSourceGroupVelocity(this.editingSourceGroupIndex, this.directionDragVx, this.directionDragVy);
                // shapes[] guarda sua própria cópia de vx/vy (é o que _rasterizeShapes() usa pra
                // reestampar as células de Entrada toda vez que QUALQUER outra coisa muda na
                // grade). Sem sincronizar aqui, a próxima forma desenhada em qualquer lugar (ou
                // undo/redo) rerrasteriza e devolve essa Entrada pra velocidade de quando foi
                // criada, revertendo a direção silenciosamente mesmo com a seta já mostrando a
                // direção nova (a seta lê de sourceGroups, não de shapes[]).
                const shapeIdx = this.shapes.findIndex(s =>
                    s.cellType === FluidSolver.CELL_TYPE.SOURCE &&
                    Math.hypot((s.x0 + s.x1) / 2 - this.directionDragOrigin.x, (s.y0 + s.y1) / 2 - this.directionDragOrigin.y) <= 2
                );
                if (shapeIdx >= 0) {
                    this.shapes[shapeIdx].vx = this.directionDragVx;
                    this.shapes[shapeIdx].vy = this.directionDragVy;
                }
                this._markDirty();
            }
        }
        this.editingSourceGroupIndex = -1;
        this.awaitingDirectionDrag = false;
        this.directionDragOrigin = null;
    }

    /**
     * @private
     * @description Cancela o reajuste em andamento (Esc): a seta volta a como estava, já que só
     * é gravada de volta no grupo em `_confirmDirectionDrag`.
     */
    _cancelDirectionDrag() {
        this.editingSourceGroupIndex = -1;
        this.awaitingDirectionDrag = false;
        this.directionDragOrigin = null;
        this._requestPaint();
    }

    /**
     * @private
     * @description Retorna o índice do corpo giratório cujo pivô está perto de `gridLoc`
     * (clicável), ou -1 se nenhum estiver perto o bastante.
     */
    _findRotorNearPivot(gridLoc) {
        const bodies = this.solver.rotatingBodies;
        const threshold = 2;
        for (let i = 0; i < bodies.length; i++) {
            const dx = gridLoc.x - bodies[i].pivotX;
            const dy = gridLoc.y - bodies[i].pivotY;
            if (Math.sqrt(dx * dx + dy * dy) <= threshold) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Retorna o índice do ponto de fumaça/corante perto de `gridLoc` (clicável),
     * ou -1 se nenhum estiver perto o bastante.
     */
    _findDyeSourceNear(gridLoc) {
        const sources = this.solver.dyeSources;
        const threshold = 2;
        for (let i = 0; i < sources.length; i++) {
            const dx = gridLoc.x - sources[i].x;
            const dy = gridLoc.y - sources[i].y;
            if (Math.sqrt(dx * dx + dy * dy) <= threshold) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Procura, na ordem inversa de empilhamento (forma mais no topo primeiro), uma
     * ponta (x0,y0 ou x1,y1) de alguma forma em `shapes[]` perto de `gridLoc` — clicável pra
     * selecionar e esticar (stretch). Retorna `{shapeIndex, handle}` ou `null`.
     */
    _findShapeHandleNear(gridLoc) {
        const threshold = 2;
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            // Região (preenchimento fundido, geometria livre) não tem "esticar" — só mover o
            // corpo inteiro (ver _findShapeBodyNear) ou apagar.
            if (shape.tool === 'region') continue;
            if (Math.hypot(gridLoc.x - shape.x0, gridLoc.y - shape.y0) <= threshold) {
                return { shapeIndex: i, handle: 'x0y0' };
            }
            if (Math.hypot(gridLoc.x - shape.x1, gridLoc.y - shape.y1) <= threshold) {
                return { shapeIndex: i, handle: 'x1y1' };
            }
        }
        return null;
    }

    /**
     * @private
     * @description Retorna o índice da forma (na ordem inversa de empilhamento) cujo retângulo
     * envolvente contém `gridLoc` — clicar no corpo (longe das pontas) seleciona e permite
     * mover a forma inteira, ou -1 se nenhuma.
     */
    _findShapeBodyNear(gridLoc) {
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            const minX = Math.min(shape.x0, shape.x1),
                maxX = Math.max(shape.x0, shape.x1);
            const minY = Math.min(shape.y0, shape.y1),
                maxY = Math.max(shape.y0, shape.y1);
            if (gridLoc.x >= minX && gridLoc.x <= maxX && gridLoc.y >= minY && gridLoc.y <= maxY) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Escreve um valor de propriedade do Rotor: no corpo mostrado no painel
     * flutuante, se houver um selecionado; senão nos valores padrão usados ao criar o PRÓXIMO
     * Rotor. Mantém o metadado da forma vetorial correspondente em sincronia, se houver uma
     * (pra sobreviver a export/import e a uma eventual reforma).
     */
    _writeRotorProperty(key, value) {
        const idx = this._activeRotorBodyIndexForPanel ?? -1;
        if (idx >= 0 && this.solver.rotatingBodies[idx]) {
            this.solver.rotatingBodies[idx][key] = value;
            if (this.selectedShapeIndex >= 0) {
                const shape = this.shapes[this.selectedShapeIndex];
                if (shape && shape.cellType === FluidSolver.CELL_TYPE.ROTOR) shape[key] = value;
            }
        } else {
            this.rotorDefaults[key] = value;
        }
    }

    /**
     * @private
     * @description Painel de propriedades flutuante — substitui o antigo painel fixo na
     * sidebar. Mostra geometria (forma vetorial selecionada) e/ou os sliders de Rotor (corpo
     * selecionado pelo pivô OU forma vetorial de tipo Rotor selecionada), posicionado perto da
     * seleção em tela. Escondido quando nada está selecionado.
     */
    _updateFloatingPanel() {
        if (!this.floatingPropertyPanel) return;
        const shape = this.selectedShapeIndex >= 0 ? this.shapes[this.selectedShapeIndex] : null;
        let rotorBodyIndex = -1;
        if (shape && shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
            rotorBodyIndex = this._findRotorNearPivot(centroid);
        } else if (!shape && this.selectedRotorIndex >= 0) {
            rotorBodyIndex = this.selectedRotorIndex;
        }
        this._activeRotorBodyIndexForPanel = rotorBodyIndex;
        const dyeIndex = (!shape && rotorBodyIndex < 0) ? this.selectedDyeSourceIndex : -1;

        // Uma seleção NOVA (não só uma edição na mesma forma já selecionada) esquece qualquer
        // arraste manual de antes — senão o painel arrastado pra longe de uma forma ficaria
        // "preso" longe da próxima seleção também. Editar um campo da MESMA forma (o que também
        // chama _updateFloatingPanel) não deve fazer o painel pular de volta.
        const selectionKey = shape ? `shape:${shape.id}` : (rotorBodyIndex >= 0 ? `rotor:${rotorBodyIndex}` : (dyeIndex >= 0 ? `dye:${dyeIndex}` : null));
        if (selectionKey !== this._panelSelectionKey) {
            this._panelSelectionKey = selectionKey;
            delete this.floatingPropertyPanel.dataset.manuallyPositioned;
        }

        const hasSelection = !!shape || rotorBodyIndex >= 0 || dyeIndex >= 0;
        this.floatingPropertyPanel.hidden = !hasSelection;
        if (!hasSelection) return;

        if (dyeIndex >= 0) {
            this.floatingPanelTitle.textContent = 'Fumaça';
            this.floatingPanelGeometryLine.hidden = true;
            this.floatingPanelGeometryRect.hidden = true;
            this.floatingPanelSourceControls.hidden = true;
            this.floatingPanelRotorControls.hidden = true;
            this.floatingPanelPositionEdit.hidden = false;
            const source = this.solver.dyeSources[dyeIndex];
            const active = document.activeElement;
            if (active !== this.floatingPanelXInput) this.floatingPanelXInput.value = source.x;
            if (active !== this.floatingPanelYInput) this.floatingPanelYInput.value = source.y;
            this.deleteShapeButton.hidden = false;
            if (!this.floatingPropertyPanel.dataset.manuallyPositioned) {
                this._positionFloatingPanel(null, -1, { x: source.x, y: source.y });
            }
            return;
        }

        const typeLabels = {
            [FluidSolver.CELL_TYPE.BARRIER]: 'Barreira',
            [FluidSolver.CELL_TYPE.SOURCE]: 'Entrada',
            [FluidSolver.CELL_TYPE.SINK]: 'Saída',
            [FluidSolver.CELL_TYPE.ROTOR]: 'Rotor'
        };
        if (shape) {
            this.floatingPanelTitle.textContent = typeLabels[shape.cellType] || 'Forma';
            const dx = shape.x1 - shape.x0,
                dy = shape.y1 - shape.y0;
            const isLine = shape.tool === 'line';
            const isRegion = shape.tool === 'region';
            this.floatingPanelPositionEdit.hidden = false;
            this.floatingPanelGeometryLine.hidden = !isLine;
            this.floatingPanelGeometryRect.hidden = isLine || isRegion;
            const active = document.activeElement;
            if (active !== this.floatingPanelXInput) this.floatingPanelXInput.value = shape.x0;
            if (active !== this.floatingPanelYInput) this.floatingPanelYInput.value = shape.y0;
            if (isLine) {
                if (active !== this.floatingPanelLengthInput) {
                    this.floatingPanelLengthInput.value = Math.sqrt(dx * dx + dy * dy).toFixed(1);
                }
                if (active !== this.floatingPanelAngleInput) {
                    this.floatingPanelAngleInput.value = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(0);
                }
                if (active !== this.floatingPanelLineWidthInput) {
                    this.floatingPanelLineWidthInput.value = (shape.lineWidth ?? FluidSimulationApp.DEFAULT_LINE_WIDTH).toFixed(1);
                }
            } else if (!isRegion) {
                if (active !== this.floatingPanelWidthInput) {
                    this.floatingPanelWidthInput.value = Math.abs(dx) + 1;
                }
                if (active !== this.floatingPanelHeightInput) {
                    this.floatingPanelHeightInput.value = Math.abs(dy) + 1;
                }
            }
            // Região (preenchimento fundido) não tem geometria editável — só mover/apagar, ver
            // _findShapeHandleNear. As duas seções acima já ficam escondidas nesse caso.
            this.deleteShapeButton.hidden = false;
        } else {
            // Rotor selecionado só pelo pivô (sem forma vetorial correspondente) — sem leitura
            // de geometria (não há x0/y0/x1/y1 pra mostrar), mas AINDA precisa dar pra apagar,
            // senão o pivô fica "preso" na tela sem jeito de removê-lo.
            this.floatingPanelTitle.textContent = 'Rotor';
            this.floatingPanelGeometryLine.hidden = true;
            this.floatingPanelGeometryRect.hidden = true;
            this.floatingPanelPositionEdit.hidden = false;
            const body = this.solver.rotatingBodies[rotorBodyIndex];
            const active = document.activeElement;
            if (active !== this.floatingPanelXInput) this.floatingPanelXInput.value = Math.round(body.pivotX);
            if (active !== this.floatingPanelYInput) this.floatingPanelYInput.value = Math.round(body.pivotY);
            this.deleteShapeButton.hidden = false;
        }

        const showSourceControls = !!shape && shape.cellType === FluidSolver.CELL_TYPE.SOURCE;
        this.floatingPanelSourceControls.hidden = !showSourceControls;
        if (showSourceControls) {
            const active = document.activeElement;
            const speed = Math.hypot(shape.vx, shape.vy);
            if (active !== this.floatingPanelSpeedInput) {
                this.floatingPanelSpeedInput.value = speed.toFixed(3);
            }
            if (active !== this.floatingPanelFlowAngleInput) {
                this.floatingPanelFlowAngleInput.value = (Math.atan2(shape.vy, shape.vx) * 180 / Math.PI).toFixed(0);
            }
        }

        const showRotorControls = rotorBodyIndex >= 0;
        this.floatingPanelRotorControls.hidden = !showRotorControls;
        if (showRotorControls) {
            const body = this.solver.rotatingBodies[rotorBodyIndex];
            this.rotorMassSlider.value = body.massMultiplier;
            this.rotorMassValue.innerHTML = Number(body.massMultiplier).toFixed(1);
            this.rotorDampingSlider.value = body.damping;
            this.rotorDampingValue.innerHTML = Number(body.damping).toFixed(3);
            this.rotorStiffnessSlider.value = body.stiffness;
            this.rotorStiffnessValue.innerHTML = Number(body.stiffness).toFixed(3);
            this._updateSliderFill(this.rotorMassSlider);
            this._updateSliderFill(this.rotorDampingSlider);
            this._updateSliderFill(this.rotorStiffnessSlider);
        }

        if (!this.floatingPropertyPanel.dataset.manuallyPositioned) {
            this._positionFloatingPanel(shape, rotorBodyIndex);
        }
    }

    /**
     * @private
     * @description Posiciona o painel flutuante perto do canto/pivô da seleção em tela —
     * recalculado aqui (chamado sempre que a seleção ou zoom/pan mudam via _updateFloatingPanel
     * e _requestPaint, respectivamente, ver paintCanvas).
     */
    _positionFloatingPanel(shape, rotorBodyIndex, dyePos = null) {
        let gx, gy;
        if (shape) {
            gx = Math.max(shape.x0, shape.x1);
            gy = Math.max(shape.y0, shape.y1);
        } else if (dyePos) {
            gx = dyePos.x;
            gy = dyePos.y;
        } else {
            const body = this.solver.rotatingBodies[rotorBodyIndex];
            gx = body.pivotX;
            gy = body.pivotY;
        }
        const pos = this._gridToPanelPosition(gx, gy);
        this.floatingPropertyPanel.style.left = `${pos.x + 12}px`;
        this.floatingPropertyPanel.style.top = `${pos.y}px`;
    }
    /**
     * @private
     * @description Extrai o(s) anel(is) (polígono fechado, coordenada ABSOLUTA de grade) que
     * representam a geometria VERDADEIRA de uma forma — usado como entrada de operação booleana
     * via Clipper (`_clipperBoolean`) tanto por `_floodFill` (união) quanto por
     * `_eraseRectangleOnGrid` (diferença/corte), ver bugs.md #45. Devolve uma LISTA de anéis (a
     * maioria das formas tem só 1; `'region'` pode ter mais de um se já tiver furos).
     */
    _shapeToPolygonRings(shape) {
        if (shape.tool === 'line') {
            // Retângulo fino ao redor do segmento (largura = lineWidth, perpendicular à linha).
            // Pontas quadradas (sem arredondar) — simplificação aceita: uma linha isolada
            // raramente aparece sozinha, normalmente forma um contorno fechado com outras linhas
            // no mesmo vértice, que cobrem a ponta.
            const dx = shape.x1 - shape.x0, dy = shape.y1 - shape.y0;
            const len = Math.hypot(dx, dy) || 1;
            const halfW = (shape.lineWidth ?? FluidSimulationApp.DEFAULT_LINE_WIDTH) / 2;
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
    static CLIPPER_SCALE = 1000;

    /**
     * @private
     * @description Roda uma operação booleana de polígono (união/diferença/etc.) via Clipper.js
     * entre dois conjuntos de anéis (coordenada absoluta de grade) — usado por `_floodFill`
     * (ctUnion) e `_eraseRectangleOnGrid` (ctDifference), ver bugs.md #45. Devolve um array — UM
     * ITEM POR PEDAÇO DESCONEXO resultante (usa `PolyTree`, não uma lista solta de `Paths`,
     * exatamente pra resolver esse agrupamento sem precisar escrever um teste de contenção na
     * mão) — cada item já é a lista de anéis daquele pedaço (o próprio anel + qualquer furo/ilha
     * descendente, achatados juntos: a regra par-ímpar do Canvas/rasterizador não precisa saber
     * qual anel é furo, só processa todos igual).
     */
    _clipperBoolean(clipType, subjectRings, clipRings) {
        const SCALE = FluidSimulationApp.CLIPPER_SCALE;
        // Normaliza toda aresta pra sentido anti-horário (área com sinal positiva, fórmula do
        // shoelace) ANTES de escalar pro Clipper. Sem isso, anéis vindos de geradores diferentes
        // (`_traceCellsToRings`, sentido horário por herdar a convenção do traçador de
        // marching-squares do Renderer, vs. `_shapeToPolygonRings`, sentido anti-horário por
        // amostrar ângulo crescente) entravam com sentidos opostos numa mesma união — o número de
        // voltas (winding number, regra `pftNonZero`) se CANCELAVA parcialmente onde os dois se
        // sobrepunham, encolhendo o resultado pra uma fração minúscula da área esperada.
        const signedArea = (ring) => {
            let area = 0;
            for (let i = 0; i < ring.length; i++) {
                const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
                area += p1.x * p2.y - p2.x * p1.y;
            }
            return area / 2;
        };
        const toPath = (ring) => {
            const normalized = signedArea(ring) < 0 ? [...ring].reverse() : ring;
            return normalized.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
        };
        const subj = subjectRings.map(toPath).filter(p => p.length >= 3);
        const clip = clipRings.map(toPath).filter(p => p.length >= 3);
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
     * @description Rasteriza um conjunto de anéis (polígono, coordenada absoluta de grade) pra
     * uma lista de células `{x,y}` — scanline clássico: pra cada linha de célula, calcula as
     * interseções em X de TODOS os segmentos de TODOS os anéis com essa linha, ordena, preenche
     * os intervalos alternados (regra par-ímpar — trata furos automaticamente, sem precisar saber
     * qual anel é furo). Usado sempre que os `rings` de uma `region` são definidos/atualizados,
     * pra popular `cells` (mantido em cache pra não quebrar hit-test/arrastar/etc., que já esperam
     * uma lista de células — ver bugs.md #45).
     */
    _rasterizePolygonToCells(rings) {
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
    _traceCellsToRings(cells) {
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

    /**
     * @private
     * @description Monta uma forma `region` a partir de um conjunto de anéis já resultante de uma
     * operação booleana (coordenada absoluta) — deriva `cells` via `_rasterizePolygonToCells`,
     * calcula o retângulo envolvente e converte tudo pra offset relativo (dx/dy). Não define
     * `vx/vy`/`enabled` nem mexe em `sourceGroups` — isso varia entre quem chama (região nasce
     * vs. sobrevive a um corte) e fica por conta de quem chama.
     */
    _buildRegionFromRings(cellType, rings) {
        const cells = this._rasterizePolygonToCells(rings);
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
        // `mergedCells` ainda serve de entrada pro traçado do anel-base (o BFS é a ferramenta
        // certa pra achar "qual é a área fechada", o Clipper entra só na hora de definir o
        // CONTORNO exato dessa área + das formas que ela engoliu).
        const mergedCells = new Map();
        for (const { x, y } of interiorCells) mergedCells.set(`${x},${y}`, { x, y });
        const absorbedRings = [];
        for (const shape of absorbed) {
            this._replayShapeGeometry(shape, (x, y) => mergedCells.set(`${x},${y}`, { x, y }));
            absorbedRings.push(...this._shapeToPolygonRings(shape));
            if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
                const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
                const groupIdx = this._findSourceGroupNear(centroid);
                if (groupIdx >= 0) this.solver.sourceGroups.splice(groupIdx, 1);
            }
        }
        const baseRings = this._traceCellsToRings(Array.from(mergedCells.values()));
        // Normalmente sai 1 pedaço só (a área do BFS é conectada por definição, e as formas
        // absorvidas tocam essa borda) — mas itera por segurança/corretude caso o Clipper ache
        // mais de um (não deveria silenciar dado se acontecer).
        const pieces = this._clipperBoolean(ClipperLib.ClipType.ctUnion, [...baseRings, ...absorbedRings], []);

        for (const rings of pieces) {
            const shape = this._buildRegionFromRings(activeCellType, rings);
            if (shape.cells.length === 0) continue; // pedaço degenerado (área ~0), ignora
            if (activeCellType === FluidSolver.CELL_TYPE.SOURCE) {
                shape.vx = FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
                shape.vy = 0;
                const absCells = shape.cells.map(c => ({ x: shape.x0 + c.dx, y: shape.y0 + c.dy }));
                this.solver.addSourceGroup(absCells, shape.vx, shape.vy);
            } else if (activeCellType === FluidSolver.CELL_TYPE.ROTOR) {
                shape.massMultiplier = this.rotorDefaults.massMultiplier;
                shape.damping = this.rotorDefaults.damping;
                shape.stiffness = this.rotorDefaults.stiffness;
                const absCells = shape.cells.map(c => ({ x: shape.x0 + c.dx, y: shape.y0 + c.dy }));
                this.solver.addRotatingBody(absCells, null, { ...this.rotorDefaults });
            } else if (activeCellType === FluidSolver.CELL_TYPE.VALVE) {
                shape.enabled = false;
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
                this.lineCellMask[i] = isLine ? 1 : 0;
                if (effectiveType === FluidSolver.CELL_TYPE.SOURCE) {
                    this.solver.sourceVx[i] = shape.vx;
                    this.solver.sourceVy[i] = shape.vy;
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
        this.solver.invalidateSinkDamping();
        this._refreshValveWidget();
    }

    /**
     * @private
     * @description Reconstrói a barra de válvulas (canto inferior esquerdo) a partir de
     * `shapes[]` — um interruptor por Entrada/Saída/Válvula na cena, pra abrir/fechar o fluxo
     * sem precisar selecionar a forma. Fica escondida se não houver nenhuma dessas três ainda.
     * Chamada sempre que `_rasterizeShapes()` roda (o chokepoint de "shapes[] mudou").
     */
    _refreshValveWidget() {
        if (!this.valveControlsWidget) return;
        const valves = this.shapes.filter(shape => shape.cellType === FluidSolver.CELL_TYPE.SOURCE || shape.cellType === FluidSolver.CELL_TYPE.SINK || shape.cellType === FluidSolver.CELL_TYPE.VALVE);

        this.valveControlsWidget.hidden = valves.length === 0;
        if (valves.length === 0) return;

        this.valveControlsWidget.innerHTML = '';
        let sourceCount = 0,
            sinkCount = 0,
            valveCount = 0;
        for (const shape of valves) {
            const isSource = shape.cellType === FluidSolver.CELL_TYPE.SOURCE;
            const isSink = shape.cellType === FluidSolver.CELL_TYPE.SINK;
            const isValveShape = shape.cellType === FluidSolver.CELL_TYPE.VALVE;
            const label = isSource ? `E${++sourceCount}` : isSink ? `S${++sinkCount}` : `V${++valveCount}`;
            // Entrada/Saída nascem abertas (undefined conta como aberta); Válvula nasce fechada
            // (só abre com enabled === true estrito) — ver bugs.md #38/#39/#40.
            const isOpen = isValveShape ? shape.enabled === true : shape.enabled !== false;
            const typeName = isSource ? 'Entrada' : isSink ? 'Saída' : 'Válvula';

            const chip = document.createElement('label');
            chip.className = 'valve-chip' + (isOpen ? '' : ' closed');
            chip.title = `${typeName} ${label} — ${isOpen ? 'aberta' : 'fechada'}`;

            const icon = document.createElement('i');
            icon.className = isSource ? 'fa-solid fa-arrow-right-to-bracket' : isSink ? 'fa-solid fa-arrow-right-from-bracket' : (isOpen ? 'fa-solid fa-door-open' : 'fa-solid fa-door-closed');

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('role', 'switch');
            input.checked = isOpen;
            input.addEventListener('change', () => {
                this._saveState();
                shape.enabled = input.checked;
                this._rasterizeShapes();
                this._markDirty();
                this._requestPaint();
            });

            chip.appendChild(icon);
            chip.appendChild(document.createTextNode(' ' + label + ' '));
            chip.appendChild(input);
            this.valveControlsWidget.appendChild(chip);
        }
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
                const subjectRings = this._shapeToPolygonRings(shape);
                // Retângulo do apagador em coordenada CONTÍNUA — célula x ocupa [x, x+1), então o
                // retângulo vai de x_start a x_end+1 (não +0.5, que era só pro recorte de reta
                // contra centro de célula; aqui é polígono contra polígono, direto nos limites).
                const eraserRing = [
                    { x: x_start, y: y_start }, { x: x_end + 1, y: y_start },
                    { x: x_end + 1, y: y_end + 1 }, { x: x_start, y: y_end + 1 }
                ];
                const pieces = this._clipperBoolean(ClipperLib.ClipType.ctDifference, subjectRings, [eraserRing]);
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
        this.hasEverStepped = true;

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
        this.hasEverStepped = true;
        this._requestPaint();
    }

    paintCanvas() {
        this.renderer.render(this.solver, this.pxPerSquare, this._buildViewState());
        // Reposiciona o painel flutuante a cada quadro (barato — só quando algo está
        // selecionado) pra acompanhar zoom/pan sem precisar de um listener em cada lugar que
        // muda zoom/panX/panY.
        if (!this.floatingPropertyPanel.hidden && !this.floatingPropertyPanel.dataset.manuallyPositioned) {
            const shape = this.selectedShapeIndex >= 0 ? this.shapes[this.selectedShapeIndex] : null;
            if (shape || this.selectedRotorIndex >= 0) {
                this._positionFloatingPanel(shape, this._activeRotorBodyIndexForPanel ?? -1);
            } else if (this.selectedDyeSourceIndex >= 0) {
                const source = this.solver.dyeSources[this.selectedDyeSourceIndex];
                if (source) this._positionFloatingPanel(null, -1, { x: source.x, y: source.y });
            }
        }
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
            hasEverStepped: this.hasEverStepped,
            lineCellMask: this.lineCellMask,
            showTracers: this.tracerCheck.checked,
            showForce: this.forceCheck.checked,
            showArrows: this.arrowsCheck.checked,
            showSensor: this.sensorCheck.checked,
            activeTool: this.activeTool,
            toolStartPoint: this.toolStartPoint,
            mouseIsDown: this.mouseIsDown,
            mouseGridPos: this.mouseGridPos,
            selectionArea: this.selectionArea,
            clipboard: this.clipboard,
            pastePreviewOrigin: this.pastePreviewOrigin,
            zoom: this.zoom,
            panX: this.panX,
            panY: this.panY,
            selectedRotorIndex: this.selectedRotorIndex,
            editingSourceGroupIndex: this.editingSourceGroupIndex,
            draggingRotorPivot: this.draggingRotorPivot ? {
                bodyIndex: this.draggingRotorPivot.bodyIndex,
                x: this.mouseGridPos.x,
                y: this.mouseGridPos.y
            } : null,
            selectedDyeSourceIndex: this.selectedDyeSourceIndex,
            draggingDyeSource: this.draggingDyeSource ? {
                index: this.draggingDyeSource.index,
                x: this.mouseGridPos.x,
                y: this.mouseGridPos.y
            } : null,
            shapes: this.shapes,
            selectedShapeIndex: this.selectedShapeIndex,
            directionHandle: this.awaitingDirectionDrag ? {
                x: this.directionDragOrigin.x,
                y: this.directionDragOrigin.y,
                vx: this.directionDragVx,
                vy: this.directionDragVy
            } : null
        };
    }

    startStop() {
        this.running = !this.running;
        if (this.running) {
            this.startButton.innerHTML = `<i class="fa-solid fa-pause"></i>`;
            this.startButton.title = 'Pausar';
            this.resetTimer();
            this.runSimulation();
            this._requestPaint(); // Inicia o loop de pintura
        } else {
            this.startButton.innerHTML = `<i class="fa-solid fa-play"></i>`;
            this.startButton.title = 'Iniciar';
            clearTimeout(this.simulationTimeout);
        }
    }
    initFluid() {
        this.solver.initFluid(this.solver.boundaryMode === 'open' ? 0 : Number(this.speedSlider.value));
        this.solver.initDyeTracers();
        // Campo de escoamento voltou ao repouso "de fábrica" — o canvas volta a ficar neutro até
        // rodar de novo (initFluid é o ponto único chamado por reset/limpar/importar/desfazer/
        // trocar modo/etc., então não precisa repetir isso em cada chamador).
        this.hasEverStepped = false;
        this._rasterizeShapes();
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
        // rawCellType/shapes[] são a fonte de verdade — só zerar solver.cellType não bastava
        // (era sobrescrito de volta pelas formas antigas assim que _rasterizeShapes rodasse de
        // novo, ex.: ao desenhar a próxima forma — é exatamente esse bug que fazia formas
        // "reaparecerem" depois de Limpar).
        this.rawCellType.fill(FluidSolver.CELL_TYPE.NORMAL);
        this.shapes = [];
        this.solver.cellType.fill(FluidSolver.CELL_TYPE.NORMAL);
        this.solver.invalidateSinkDamping();
        this.solver.dyeSources = [];
        this.solver.rotatingBodies = [];
        this.solver.sourceGroups = [];
        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this.draggingShapeHandle = null;
        this.editingSourceGroupIndex = -1;
        this._updateFloatingPanel();
        this._refreshValveWidget();
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
                if (type !== FluidSolver.CELL_TYPE.NORMAL && type !== FluidSolver.CELL_TYPE.ROTOR) {
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
            this._paintRawCell(origin.x + p.x, origin.y + p.y, p.type);
        }
        this._rasterizeShapes();
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
                if (type !== FluidSolver.CELL_TYPE.NORMAL && type !== FluidSolver.CELL_TYPE.ROTOR) {
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
            this._paintRawCell(p.x, p.y, p.type);
        }
        this._rasterizeShapes();
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
                if (type !== FluidSolver.CELL_TYPE.NORMAL && type !== FluidSolver.CELL_TYPE.ROTOR) {
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
            this._paintRawCell(p.x, p.y, p.type);
        }
        this._rasterizeShapes();
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
        // Limpa o cursor inline (não força 'crosshair') — assim a regra CSS de
        // #canvas-container.tool-pan continua controlando o cursor de "mover" (grab/grabbing).
        this.canvas.style.cursor = '';
    }
    _showViscosityHelp() {
        Swal.fire({
            title: 'Valores de Referência de Viscosidade',
            html: `<p>A viscosidade nesta simulação é um parâmetro adimensional. Use os valores abaixo como ponto de partida.</p><table><thead><tr><th>Fluido (a 20°C)</th><th>Viscosidade (Aprox.)</th></tr></thead><tbody><tr><td>Ar</td><td>0.010 - 0.020</td></tr><tr><td>Água</td><td>0.020 - 0.040</td></tr><tr><td>Mercúrio</td><td>0.050 - 0.080</td></tr><tr><td>Mel</td><td>0.100 - 0.150</td></tr><tr><td>Óleo de Motor</td><td>0.150 - 0.200</td></tr></tbody></table><small>Fonte: Valores adaptados para esta simulação. Para dados reais, consulte <a href="https://www.engineersedge.com/fluid_flow/kinematic-viscosity-table.htm" target="_blank">recursos de engenharia</a>.</small>`,
            icon: 'info'
        });
    }
    _showRotorStiffnessHelp() {
        Swal.fire({
            title: 'Rigidez da Mola',
            html: `<p>Controla se um Rotor gira livremente ou balança e volta a uma posição de repouso.</p><ul><li><strong>0</strong>: turbina livre — gira sem parar enquanto o fluido empurrar.</li><li><strong>Maior que 0</strong>: palheta elástica — o fluido a deflete, e ao parar (ou mudar de direção) ela balança de volta ao ângulo em que foi desenhada.</li></ul><small>Quanto maior o valor, mais rígida a "mola" — a palheta deflete menos e volta mais rápido.</small>`,
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
            html: ` <p>As cores no canvas representam as propriedades físicas do fluido em cada ponto. Com exceção da Densidade, todas as outras mostram a INTENSIDADE (magnitude) — não o sinal/direção. <em>Azul = zero/fraco</em>, <em>Vermelho = forte</em>.</p> <ul> <li><strong>Densidade:</strong> Pressão real do fluido. <em>Azul = baixa pressão</em>, <em>Verde/Amarelo = repouso</em>, <em>Vermelho = alta pressão</em>.</li> <li><strong>Velocidade X:</strong> O quanto o fluido se move na horizontal, rápido ou devagar, pra qualquer lado.</li> <li><strong>Velocidade Y:</strong> O quanto o fluido se move na vertical, rápido ou devagar, pra qualquer lado.</li> <li><strong>Velocidade (módulo):</strong> Rapidez total do fluido, sem separar direção.</li> <li><strong>Rotação (Curl):</strong> O quanto o fluido está girando ali — ideal pra ver vórtices e turbulência, mas não distingue giro horário de anti-horário (só a força do giro).</li> </ul>`
        });
    }

    pageToCanvas(pageX, pageY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (pageX - rect.left) * scaleX,
            y: (pageY - rect.top) * scaleY
        };
    }
    canvasToGrid(canvasX, canvasY) {
        const contentX = (canvasX - Renderer.RULER_SIZE - this.panX) / this.zoom;
        const contentY = (canvasY - Renderer.RULER_SIZE - this.panY) / this.zoom;
        const gridX = Math.floor(contentX / this.pxPerSquare);
        const gridY = this.solver.ydim - 1 - Math.floor(contentY / this.pxPerSquare);
        return {
            x: gridX,
            y: gridY
        };
    }
    /**
     * @private
     * @description Inverso de `canvasToGrid` — de uma coordenada de grade pra um ponto em
     * pixels do canvas (espaço interno, considerando zoom/pan/régua).
     */
    gridToCanvas(gridX, gridY) {
        const contentX = gridX * this.pxPerSquare;
        const contentY = (this.solver.ydim - 1 - gridY) * this.pxPerSquare;
        return {
            x: contentX * this.zoom + this.panX + Renderer.RULER_SIZE,
            y: contentY * this.zoom + this.panY + Renderer.RULER_SIZE
        };
    }
    /**
     * @private
     * @description Como `gridToCanvas`, mas em pixels CSS (não pixels internos do canvas) —
     * usado pra posicionar elementos HTML absolutos dentro de `#canvas-container` (que tem o
     * mesmo tamanho em tela que o canvas).
     */
    _gridToPanelPosition(gridX, gridY) {
        const canvasPt = this.gridToCanvas(gridX, gridY);
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: canvasPt.x / scaleX,
            y: canvasPt.y / scaleY
        };
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

    /**
     * @private
     * @description Só uma fonte de verdade por vez: guarda `rawCellType` (pintura livre) +
     * `shapes[]` (formas vetoriais), NÃO o `cellType` composto — as duas representações da
     * mesma informação podem divergir silenciosamente se guardadas juntas.
     */
    _snapshotState() {
        return {
            rawCellType: this.rawCellType.slice(),
            shapes: JSON.parse(JSON.stringify(this.shapes)),
            sourceVx: this.solver.sourceVx.slice(),
            sourceVy: this.solver.sourceVy.slice(),
            dyeSources: JSON.parse(JSON.stringify(this.solver.dyeSources)),
            rotatingBodies: JSON.parse(JSON.stringify(this.solver.rotatingBodies)),
            sourceGroups: JSON.parse(JSON.stringify(this.solver.sourceGroups))
        };
    }
    _restoreState(state) {
        this.rawCellType = state.rawCellType.slice();
        this.shapes = JSON.parse(JSON.stringify(state.shapes || []));
        this.solver.sourceVx = state.sourceVx.slice();
        this.solver.sourceVy = state.sourceVy.slice();
        this.solver.dyeSources = JSON.parse(JSON.stringify(state.dyeSources));
        this.solver.rotatingBodies = JSON.parse(JSON.stringify(state.rotatingBodies || []));
        this.solver.sourceGroups = JSON.parse(JSON.stringify(state.sourceGroups || []));
        // Nunca deixar _rasterizeShapes() rodar entre restaurar shapes[] e restaurar
        // rotatingBodies[] — a ordem aqui (rasteriza livre+não-Rotor, DEPOIS reestampa Rotor) é
        // a mesma usada na criação/reforma de um Rotor, ver _commitShape/_commitShapeReform.
        this._rasterizeShapes();
        this.solver.stampRotatingBodiesOntoGrid();
        this.solver.invalidateSinkDamping();
        // O índice de seleção não sobrevive a undo/redo — a lista de corpos/formas pode ter mudado.
        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this.draggingShapeHandle = null;
        this._updateFloatingPanel();
        this.initFluid();
    }
    _saveState() {
        this.undoStack.push(this._snapshotState());
        this.redoStack = [];
        this._updateUndoRedoButtons();
        this._markDirty();
    }
    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(this._snapshotState());
        this._restoreState(this.undoStack.pop());
        this._updateUndoRedoButtons();
        this._markDirty();
    }
    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(this._snapshotState());
        this._restoreState(this.redoStack.pop());
        this._updateUndoRedoButtons();
        this._markDirty();
    }
    _updateUndoRedoButtons() {
        this.zoomUndoButton.disabled = this.undoStack.length === 0;
        this.zoomRedoButton.disabled = this.redoStack.length === 0;
    }

    /**
     * @private
     * @description Monta o objeto de configuração completo (geometria + parâmetros de UI) —
     * usado tanto pra exportar um arquivo .json quanto pro autosave em localStorage.
     */
    _buildConfigObject() {
        return {
            version: 17,
            xdim: this.solver.xdim,
            ydim: this.solver.ydim,
            boundaryMode: this.solver.boundaryMode,
            rawCellType: Array.from(this.rawCellType),
            shapes: this.shapes,
            sourceVx: Array.from(this.solver.sourceVx),
            sourceVy: Array.from(this.solver.sourceVy),
            dyeSources: this.solver.dyeSources,
            rotatingBodies: this.solver.rotatingBodies,
            sourceGroups: this.solver.sourceGroups,
            flowSpeed: this.speedSlider.value,
            viscosity: this.viscSlider.value,
            animationSpeed: this.stepsSlider.value,
            plotMode: this.plotSelect.selectedIndex,
            contrast: this.contrastSlider.value,
            showTracers: this.tracerCheck.checked,
            showForce: this.forceCheck.checked,
            showArrows: this.arrowsCheck.checked,
            showSensor: this.sensorCheck.checked,
            zoom: this.zoom,
            panX: this.panX,
            panY: this.panY
        };
    }
    _exportConfiguration() {
        const config = this._buildConfigObject();
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
                    if (config.version < 15) throw new Error('Formato de arquivo antigo ou incompatível (não guarda o tamanho da grade/objetos giratórios). Exporte novamente.');
                    this._applyConfiguration(config);
                    // Arquivo importado não é um projeto local salvo — "Salvar" deve pedir um
                    // nome (Salvar Como), não sobrescrever um projeto qualquer sem querer.
                    this.activeProjectId = null;
                    this.activeProjectName = null;
                    this.hasUnsavedChanges = false;
                    this._updateProjectIndicator();
                } catch (err) {
                    Swal.fire('Erro', `Não foi possível importar a configuração: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    _applyConfiguration(config, { silent = false } = {}) {
        this.speedSlider.value = config.flowSpeed;
        this.adjustSpeed();
        this.viscSlider.value = config.viscosity;
        this.adjustViscosity();
        this.stepsSlider.value = config.animationSpeed;
        this.plotSelect.selectedIndex = config.plotMode;
        this.contrastSlider.value = config.contrast;
        this.tracerCheck.checked = config.showTracers;
        this.forceCheck.checked = config.showForce;
        this.arrowsCheck.checked = !!config.showArrows;
        this.sensorCheck.checked = config.showSensor;
        this.boundaryModeSelect.value = config.boundaryMode || 'channel';
        this._resetSimulation(config.xdim, config.ydim);
        // v17+ guarda rawCellType+shapes (buffer duplo). Arquivos v15/v16 só têm o `cellTypes`
        // composto (de antes da edição vetorial existir) — migra tratando esse composto inteiro
        // como camada livre, sem formas vetoriais (a geometria continua funcionando igual,
        // só não vem individualmente selecionável/editável).
        if (config.rawCellType) {
            this.rawCellType = Uint8Array.from(config.rawCellType);
            this.shapes = JSON.parse(JSON.stringify(config.shapes || []));
        } else {
            this.rawCellType = Uint8Array.from(config.cellTypes || []);
            this.shapes = [];
        }
        if (config.sourceVx) this.solver.sourceVx = Float32Array.from(config.sourceVx);
        if (config.sourceVy) this.solver.sourceVy = Float32Array.from(config.sourceVy);
        this.solver.dyeSources = config.dyeSources || [];
        // Backfill com os padrões: um arquivo exportado antes de propriedades por Rotor
        // existirem não vai ter massMultiplier/damping/stiffness em cada corpo.
        this.solver.rotatingBodies = (config.rotatingBodies || []).map(body => ({
            ...body,
            massMultiplier: body.massMultiplier ?? 1,
            damping: body.damping ?? 0.05,
            stiffness: body.stiffness ?? 0
        }));
        // Arquivos de antes dos grupos de Entrada existirem não vão ter isso — fica vazio, a
        // Entrada em si (sourceVx/sourceVy) continua funcionando normalmente, só não vem
        // agrupada/selecionável.
        this.solver.sourceGroups = config.sourceGroups || [];
        this._rasterizeShapes();
        this.solver.stampRotatingBodiesOntoGrid();
        this.solver.invalidateSinkDamping();
        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this.editingSourceGroupIndex = -1;
        this.initFluid();
        this.solver.initTracers(this.tracerCheck.checked);
        this.solver.initDyeTracers();
        this._refreshAllSliderFills();
        this._updateFloatingPanel();
        // Restaura zoom/pan por cima do auto-fit que _resetSimulation já fez — arquivos de
        // antes dessa propriedade existir não têm `zoom` salvo, então mantém o auto-fit padrão.
        if (config.zoom !== undefined) {
            this.zoom = config.zoom;
            this.panX = config.panX;
            this.panY = config.panY;
            this._requestPaint();
        }
        if (!silent) Swal.fire('Sucesso!', 'Configuração importada com sucesso.', 'success');
    }

    // ---------- Projetos locais nomeados (localStorage, além do autosave) ----------

    /**
     * @private
     * @description Marca que há alterações desde o último salvar/abrir/novo — chamado nos
     * mesmos pontos que já representam uma edição de verdade (mesmo critério do undo/redo),
     * não em todo `_requestPaint` (senão rodar a simulação já marcaria "não salvo" sem o
     * usuário ter mudado nada de configuração).
     */
    _markDirty() {
        this.hasUnsavedChanges = true;
        this._updateProjectIndicator();
    }

    _updateProjectIndicator() {
        if (!this.projectIndicator) return;
        this.projectIndicator.textContent = this.activeProjectName || 'Sem título';
        this.projectIndicator.classList.toggle('unsaved', this.hasUnsavedChanges);
    }

    /**
     * @private
     * @description Lê a lista de projetos salvos localmente, mais recente primeiro. Nunca
     * lança — um valor corrompido em localStorage vira lista vazia (o autosave, separado desta
     * lista, continua intacto).
     */
    _listProjects() {
        try {
            const raw = localStorage.getItem(FluidSimulationApp.PROJECTS_KEY);
            const map = raw ? JSON.parse(raw) : {};
            return Object.values(map).sort((a, b) => b.savedAt - a.savedAt);
        } catch (err) {
            console.warn('Não foi possível ler os projetos salvos:', err);
            return [];
        }
    }

    _persistProjects(projects) {
        const map = {};
        for (const p of projects) map[p.id] = p;
        try {
            localStorage.setItem(FluidSimulationApp.PROJECTS_KEY, JSON.stringify(map));
            return true;
        } catch (err) {
            Swal.fire('Erro', `Não foi possível salvar: ${err.message}`, 'error');
            return false;
        }
    }

    _newProject() {
        const proceed = () => {
            this.clearBarriers();
            this.activeProjectId = null;
            this.activeProjectName = null;
            this.hasUnsavedChanges = false;
            this._updateProjectIndicator();
        };
        if (!this.hasUnsavedChanges) {
            proceed();
            return;
        }
        Swal.fire({
            title: 'Descartar alterações não salvas?',
            text: 'O projeto atual ainda não foi salvo. Começar um novo vai descartar essas alterações (o autosave continua guardando a última sessão, mas o projeto nomeado não).',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, começar novo',
            cancelButtonText: 'Cancelar'
        }).then(result => {
            if (result.isConfirmed) proceed();
        });
    }

    async _saveProject() {
        if (this.activeProjectId) {
            const projects = this._listProjects();
            const existing = projects.find(p => p.id === this.activeProjectId);
            if (existing) {
                existing.savedAt = Date.now();
                existing.config = this._buildConfigObject();
                if (this._persistProjects(projects)) {
                    this.hasUnsavedChanges = false;
                    this._updateProjectIndicator();
                }
                return;
            }
        }
        this._saveProjectAs();
    }

    async _saveProjectAs() {
        const result = await Swal.fire({
            title: 'Salvar Como',
            input: 'text',
            inputLabel: 'Nome do projeto',
            inputValue: this.activeProjectName || '',
            showCancelButton: true,
            confirmButtonText: 'Salvar',
            cancelButtonText: 'Cancelar',
            inputValidator: value => !value?.trim() && 'Digite um nome para o projeto'
        });
        if (!result.isConfirmed) return;
        const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const projects = this._listProjects();
        projects.push({
            id,
            name: result.value.trim(),
            savedAt: Date.now(),
            config: this._buildConfigObject()
        });
        if (this._persistProjects(projects)) {
            this.activeProjectId = id;
            this.activeProjectName = result.value.trim();
            this.hasUnsavedChanges = false;
            this._updateProjectIndicator();
        }
    }

    _loadProject(id) {
        const project = this._listProjects().find(p => p.id === id);
        if (!project) {
            Swal.fire('Erro', 'Este projeto não existe mais.', 'error');
            return;
        }
        this._applyConfiguration(project.config, { silent: true });
        this.activeProjectId = project.id;
        this.activeProjectName = project.name;
        this.hasUnsavedChanges = false;
        this._updateProjectIndicator();
    }

    _deleteProject(id) {
        const projects = this._listProjects().filter(p => p.id !== id);
        this._persistProjects(projects);
        if (this.activeProjectId === id) {
            this.activeProjectId = null;
            this.activeProjectName = null;
            this._updateProjectIndicator();
        }
    }

    /**
     * @private
     * @description Diálogo (SweetAlert2, mesma dependência já usada em todo o app) listando os
     * projetos salvos localmente, com ação de abrir e de excluir por linha.
     */
    _openProjectPicker() {
        const projects = this._listProjects();
        if (projects.length === 0) {
            Swal.fire('Nenhum projeto salvo', 'Use "Salvar Como" pra guardar o projeto atual com um nome.', 'info');
            return;
        }
        const rowsHtml = projects.map(p => `
            <div class="project-row" data-id="${p.id}">
                <div class="project-row-info">
                    <strong>${this._escapeHtml(p.name)}</strong>
                    <small>${new Date(p.savedAt).toLocaleString('pt-BR')}</small>
                </div>
                <div class="project-row-actions">
                    <button type="button" class="secondary project-open-btn" data-id="${p.id}">Abrir</button>
                    <button type="button" class="icon-button project-delete-btn" data-id="${p.id}" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `).join('');
        Swal.fire({
            title: 'Abrir Projeto',
            html: `<div class="project-list">${rowsHtml}</div>`,
            showConfirmButton: false,
            showCloseButton: true,
            width: 480,
            didOpen: popup => {
                popup.querySelectorAll('.project-open-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        Swal.close();
                        this._loadProject(btn.dataset.id);
                    });
                });
                popup.querySelectorAll('.project-delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const project = projects.find(p => p.id === btn.dataset.id);
                        const confirm = await Swal.fire({
                            title: 'Excluir projeto?',
                            text: project ? project.name : '',
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonText: 'Excluir',
                            cancelButtonText: 'Cancelar'
                        });
                        if (confirm.isConfirmed) this._deleteProject(btn.dataset.id);
                        this._openProjectPicker();
                    });
                });
            }
        });
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
