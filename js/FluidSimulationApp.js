import { FluidSolver } from './FluidSolver.js?v=20260908d';
import { Renderer } from './Renderer.js?v=20260908d';
import { DEFAULT_LINE_WIDTH, shapeToPolygonRings, clipperBoolean, clipperInflate, rasterizePolygonToCells, traceCellsToRings } from './PolygonGeometry.js?v=20260908d';
import { Persistence } from './app/persistence.js?v=20260908d';
import { applyMixin } from './app/applyMixin.js?v=20260908d';
import { HelpDialogs } from './app/helpDialogs.js?v=20260908d';

/**
 * @class FluidSimulationApp
 * @description Controlador da aplicação: DOM, ferramentas de edição, undo/redo e
 * import/export de configuração. Orquestra um FluidSolver (física) e um Renderer (canvas).
 */
export class FluidSimulationApp {
    static PX_PER_SQUARE = 5;

    // Propriedades de ajuste de um Rotor. Existe como lista porque elas viajam JUNTAS por vários
    // caminhos (criar, reformar ao arrastar um handle, mover o pivô, preencher, exportar,
    // importar) e cada um copiava as três à mão — acrescentar uma quarta significava lembrar de
    // seis lugares. Ver `_rotorPropsFrom`.
    static ROTOR_PROP_KEYS = ['massMultiplier', 'damping', 'stiffness', 'motorDirection', 'motorSpeed'];

    // Limites do tamanho de grade configurável (bugs.md #49). O mínimo por eixo evita uma grade
    // pequena demais para o solver ter o que resolver (as bordas ocupariam a cena inteira). O
    // teto de ÁREA é o que realmente importa para o desempenho: o custo de um passo é
    // proporcional ao número de células, não ao formato. Medido neste solver: ~13 milhões de
    // células·passo por segundo, então 250 mil células dão da ordem de 50 passos/s — perto do
    // limite do que ainda roda liso no alvo de 200 passos/s do slider de animação. Acima disso a
    // dica avisa que vai ficar lento, mas deixa aplicar: é escolha do usuário, e uma cena grande
    // rodando devagar continua sendo útil.
    static GRID_MIN_DIM = 40;
    static GRID_MAX_DIM = 2000;
    static GRID_HEAVY_AREA = 250000;
    static GRID_MAX_AREA = 1500000;

    // Peso inicial de cada tipo de partícula física (bugs.md #32) ao escolher no seletor — só um
    // ponto de partida, o slider de Peso continua livre pra ajustar depois. Sem isso, trocar de
    // tipo não mudava a física nenhuma (só o desenho), e uma "Folha" escolhida depois de mexer no
    // peso pra outra coisa saía do mesmo tamanho/arrasto/gravidade de uma Bolinha.
    static PARTICLE_TYPE_DEFAULT_WEIGHT = { leaf: 0.15, ball: 0.5, box: 0.85 };

    // Distância (em células) dentro da qual a ponta de uma forma gruda na borda do domínio —
    // ver `_snapToDomainEdge`. 3 é largo o bastante pra pegar um arraste "até o fim" sem
    // precisar de precisão de pixel, e estreito o bastante pra não atrapalhar quem quer mesmo
    // uma forma começando perto (mas não colada) na parede.
    static EDGE_SNAP_CELLS = 3;
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
    static DEFAULT_LINE_WIDTH = DEFAULT_LINE_WIDTH;
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
        this.rotorMotorSwitch = this.root.querySelector('.rotor-motor-switch');
        this.rotorMotorButtons = Array.from(this.root.querySelectorAll('.rotor-motor-switch button'));
        this.rotorMotorSpeedRow = this.root.querySelector('#rotorMotorSpeedRow');
        this.rotorMotorSpeedSlider = this.root.querySelector('#rotorMotorSpeedSlider');
        this.rotorMotorSpeedValue = this.root.querySelector('#rotorMotorSpeedValue');
        this.rotorMotorHelp = this.root.querySelector('#rotorMotorHelp');
        this.meshHoleSizeSlider = this.root.querySelector('#meshHoleSizeSlider');
        this.meshHoleSizeValue = this.root.querySelector('#meshHoleSizeValue');
        this.meshHoleSizeHelp = this.root.querySelector('#meshHoleSizeHelp');
        this.floatingPanelMeshControls = this.root.querySelector('#floatingPanelMeshControls');
        // Estes 4 vivem na .ribbon, IRMÃ de <main> (this.root), não descendente — precisa de
        // document.querySelector, não this.root, mesmo motivo já documentado em `menuItems`.
        this.particleToolOptions = document.querySelector('#particleToolOptions');
        this.particleTypeSelect = document.querySelector('#particleTypeSelect');
        this.particleWeightSlider = document.querySelector('#particleWeightSlider');
        this.particleWeightValue = document.querySelector('#particleWeightValue');
        this.floatingPropertyPanel = this.root.querySelector('#floatingPropertyPanel');
        this.floatingPanelHeader = this.root.querySelector('.floating-panel-header');
        this.simulationControlsWidget = this.root.querySelector('#simulationControlsWidget');
        this.valveControlsWidget = this.root.querySelector('#controlPanelBar');
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
        this.boundaryModeHelp = this.root.querySelector('#boundaryModeHelp');
        this.gridWidthInput = this.root.querySelector('#gridWidthInput');
        this.gridHeightInput = this.root.querySelector('#gridHeightInput');
        this.applyGridSizeButton = this.root.querySelector('#applyGridSizeButton');
        this.gridSizeHint = this.root.querySelector('#gridSizeHint');
        this.gridSizeHelp = this.root.querySelector('#gridSizeHelp');
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
            stiffness: 0,
            motorDirection: 0,
            motorSpeed: 0.5
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
        this.boundaryModeHelp.addEventListener('click', () => this._showBoundaryModeHelp());
        this.gridSizeHelp.addEventListener('click', () => this._showGridSizeHelp());
        this.applyGridSizeButton.addEventListener('click', () => this._applyGridSize());
        // Digitar já atualiza a dica de custo (contagem de células / aviso de grade pesada),
        // antes de aplicar — é a informação que decide o valor a escolher.
        for (const input of [this.gridWidthInput, this.gridHeightInput]) {
            input.addEventListener('input', () => this._updateGridSizeHint());
        }
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
        this.rotorMotorHelp.addEventListener('click', () => this._showRotorMotorHelp());
        for (const button of this.rotorMotorButtons) {
            button.addEventListener('click', () => {
                this._writeRotorProperty('motorDirection', Number(button.dataset.motor));
                this._syncRotorMotorControls(Number(button.dataset.motor));
                this._markDirty();
            });
        }
        this.rotorMotorSpeedSlider.addEventListener('input', () => {
            const pct = Number(this.rotorMotorSpeedSlider.value);
            this.rotorMotorSpeedValue.innerHTML = `${pct}%`;
            this._writeRotorProperty('motorSpeed', pct / 100);
            this._markDirty();
        });
        this.meshHoleSizeSlider.addEventListener('input', () => this._applyMeshHoleSize());
        this.meshHoleSizeHelp.addEventListener('click', () => this._showMeshHoleSizeHelp());
        this.particleWeightSlider.addEventListener('input', () => {
            this.particleWeightValue.textContent = Number(this.particleWeightSlider.value).toFixed(2);
        });
        // Trocar o tipo pula o peso pro padrão daquele tipo — sem isso, escolher "Folha" depois
        // de ter mexido no peso pra outra coisa carimbava uma folha do mesmo tamanho/arrasto de
        // uma bolinha, só com o desenho diferente (o peso é o que decide a física de verdade,
        // ver `particlePhysicsFromWeight`). O peso continua livre pra ajustar depois do tipo
        // escolhido, isto só define um ponto de partida sensato.
        this.particleTypeSelect.addEventListener('change', () => {
            const weight = FluidSimulationApp.PARTICLE_TYPE_DEFAULT_WEIGHT[this.particleTypeSelect.value] ?? 0.5;
            this.particleWeightSlider.value = weight;
            this.particleWeightValue.textContent = weight.toFixed(2);
        });
        this.floatingPanelCloseButton.addEventListener('click', () => {
            this.selectedShapeIndex = -1;
            this.selectedRotorIndex = -1;
            // Sem esta, "fechar" o painel de uma Fumaça selecionada não fechava de verdade —
            // _updateFloatingPanel recalcula a seleção a partir deste índice e o painel reabria
            // sozinho na chamada seguinte (achado consertando o painel da Grade).
            this.selectedDyeSourceIndex = -1;
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
            // Folga de algumas células entre a borda da grade e a borda da área visível. Sem ela
            // a grade terminava EXATAMENTE no último pixel da janela: a última linha (y=0) e a
            // última coluna existiam, mas eram impossíveis de alcançar com o mouse na prática —
            // então fechar uma parede/Grade "de ponta a ponta" sempre deixava um vão embaixo, e
            // é justamente pelo chão que as partículas pesadas escapam (a gravidade leva todas
            // pra lá). Com a folga + o snap de `_snapToDomainEdge`, arrastar até perto do fim
            // fecha de verdade.
            const margin = FluidSimulationApp.EDGE_SNAP_CELLS * this.pxPerSquare;
            const viewportXdim = Math.floor((this.canvasContainer.clientWidth - Renderer.RULER_SIZE - margin) / this.pxPerSquare);
            const viewportYdim = Math.floor((this.canvasContainer.clientHeight - Renderer.RULER_SIZE - margin) / this.pxPerSquare);
            xdim = viewportXdim * FluidSimulationApp.GRID_SIZE_MULTIPLIER;
            ydim = viewportYdim * FluidSimulationApp.GRID_SIZE_MULTIPLIER;
        }

        this.solver = new FluidSolver(xdim, ydim);
        this.solver.boundaryMode = this.boundaryModeSelect.value;
        this.solver.initFluid(this.solver.boundaryMode === 'open' ? 0 : Number(this.speedSlider.value));
        this.solver.initTracers(this.tracerCheck.checked);
        this.solver.initDyeTracers();
        this.solver.initParticles();

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
        this._syncGridSizeInputs();

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
        // Opções da ferramenta Partículas (tipo/peso pro PRÓXIMO emissor) só fazem sentido com
        // ela ativa — bugs.md #32.
        if (this.particleToolOptions) this.particleToolOptions.hidden = toolName !== 'particles';
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
     * @description Gruda uma ponta de forma na borda do domínio quando ela cai a poucas células
     * dela. Sem isto é praticamente impossível fechar uma parede/Grade de ponta a ponta: a última
     * linha da grade cai no último pixel da janela (e some de vez quando o painel de controle
     * aparece embaixo), então mesmo arrastando "até o fim" sobrava um vão de várias células —
     * e é justamente pelo chão que as partículas pesadas escapam, já que a gravidade leva todas
     * exatamente pra lá. Só age perto da borda, então desenhar no meio da cena continua igual.
     */
    _snapToDomainEdge(point) {
        const margin = FluidSimulationApp.EDGE_SNAP_CELLS;
        const { xdim, ydim } = this.solver;
        let { x, y } = point;
        if (x <= margin) x = 0;
        else if (x >= xdim - 1 - margin) x = xdim - 1;
        if (y <= margin) y = 0;
        else if (y >= ydim - 1 - margin) y = ydim - 1;
        return { x, y };
    }

    /**
     * @private
     * @description Estende a ponta de uma linha até encostar numa parede já existente, quando
     * ela para a poucas células de uma. Motivo (bugs.md #32): uma Grade atravessando um duto
     * "parece" encostar nas paredes — o traço vetorial é largo (`lineWidth` 1,75) — mas a
     * rasterização física é de UMA célula, então parar 1 célula antes da parede deixa um vão
     * invisível. Medido: um vão de 1 célula só numa ponta já deixou 3 de 6 bolinhas escaparem
     * pela lateral (com a Grade encostada nas duas paredes, nenhuma escapa). Anda no máximo
     * `EDGE_SNAP_CELLS` células e só na direção da própria linha, então não "gruda" em nada
     * longe nem muda uma forma desenhada longe de paredes.
     */
    _snapEndToNearbySolid(point, dirX, dirY) {
        const len = Math.hypot(dirX, dirY);
        if (len === 0) return point;
        const ux = dirX / len,
            uy = dirY / len;
        const { xdim, ydim } = this.solver;
        for (let step = 1; step <= FluidSimulationApp.EDGE_SNAP_CELLS; step++) {
            const x = Math.round(point.x + ux * step),
                y = Math.round(point.y + uy * step);
            if (x < 0 || x >= xdim || y < 0 || y >= ydim) break;
            const t = this.solver.cellType[x + y * xdim];
            if (t === FluidSolver.CELL_TYPE.BARRIER || t === FluidSolver.CELL_TYPE.MESH) {
                return { x, y };
            }
        }
        return point;
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
            case 'mesh':
                return FluidSolver.CELL_TYPE.MESH;
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

        // 'particles' fica de fora de propósito: objetos avulsos não entram no undo (mesmo
        // tratamento que traçadores/fumaça já recebem — são estado "vivo" da simulação, não
        // geometria de design; ver `addParticle`).
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
            case 'particles':
                if (gridLoc.x >= 0 && gridLoc.y >= 0) {
                    // Um objeto avulso por clique (bugs.md #32) — sem fonte contínua, pedido
                    // explícito do usuário (o modelo anterior, copiado da Fumaça, tratava cada
                    // clique como um ponto emitindo pra sempre). Mesmo raciocínio da Fumaça pra
                    // limpar embaixo: um objeto carimbado em cima de uma Barreira nasceria preso
                    // dentro do sólido.
                    this._eraseAt(gridLoc);
                    this.solver.addParticle(
                        gridLoc.x, gridLoc.y,
                        Number(this.particleWeightSlider.value),
                        this.particleTypeSelect.value
                    );
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
                this.solver.addRotatingBody(body.currentCells, { x: this.mouseGridPos.x, y: this.mouseGridPos.y }, this._rotorPropsFrom(body), bodyIndex);
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
            } else if (!['brush', 'fill', 'smoke', 'particles', 'pointer', 'eraser_line'].includes(this.activeTool)) {
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
        start = this._snapToDomainEdge(start);
        end = this._snapToDomainEdge(end);
        // Só para linha: encostar as duas pontas numa parede próxima fecha o vão lateral que
        // deixava partículas escaparem pela ponta de uma Grade dentro de um duto (ver
        // `_snapEndToNearbySolid`). Formas de área (retângulo/elipse) não têm "ponta" nesse
        // sentido, então ficam de fora.
        if (tool === 'line') {
            const dx = end.x - start.x,
                dy = end.y - start.y;
            start = this._snapEndToNearbySolid(start, -dx, -dy);
            end = this._snapEndToNearbySolid(end, dx, dy);
        }
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
            Object.assign(shape, this._rotorPropsFrom(this.rotorDefaults));
            this.solver.addRotatingBody(cells, null, this._rotorPropsFrom(this.rotorDefaults));
        } else if (cellType === FluidSolver.CELL_TYPE.VALVE) {
            // Nasce fechada (bloqueando, como parede sólida) — precisa ser aberta explicitamente
            // pelo widget, ver bugs.md #40.
            shape.enabled = false;
        } else if (cellType === FluidSolver.CELL_TYPE.MESH) {
            shape.holeSize = FluidSolver.MESH_DEFAULT_HOLE_SIZE;
        } else if (cellType === FluidSolver.CELL_TYPE.SINK) {
            // Força de sucção da Saída (bugs.md #52) — mesmo padrão do `holeSize` da Grade: a
            // "verdade" mora aqui em `shape.suction`, espelhada pro array por célula do solver
            // toda vez que a grade é rasterizada, ajustável depois pelo slider no painel de
            // controle (ver `_refreshValveWidget`).
            shape.suction = FluidSolver.SINK_DEFAULT_SUCTION;
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
                Object.assign(shape, this._rotorPropsFrom(body));
                this.solver.addRotatingBody(cells, null, this._rotorPropsFrom(body), bodyIdx);
            } else {
                this.solver.addRotatingBody(cells, null, this._rotorPropsFrom(shape));
            }
        }

        this._rasterizeShapes();
        if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            for (const { x, y } of cells) {
                this.solver.cellType[x + y * this.solver.xdim] = FluidSolver.CELL_TYPE.ROTOR;
            }
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
            this.solver.addRotatingBody(body.currentCells, { x: newX, y: newY }, this._rotorPropsFrom(body), bodyIndex);
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
     * @description Aplica um vx/vy novo a uma Entrada já existente, mantendo `shape.vx/vy` em
     * sincronia com `solver.sourceGroups`/`sourceVx/vy` (mesma sincronização que
     * `_confirmDirectionDrag` já faz pro arraste). Extraído de `_applySourceVelocity` pra ser
     * reaproveitado pelo slider de velocidade inline do painel de controle (bugs.md #50), que
     * precisa da mesma sincronização mas não passa pelos campos do painel flutuante.
     */
    _setSourceVelocity(shape, vx, vy) {
        shape.vx = vx;
        shape.vy = vy;
        const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
        const groupIdx = this._findSourceGroupNear(centroid);
        if (groupIdx >= 0) {
            this.solver.updateSourceGroupVelocity(groupIdx, vx, vy);
        } else {
            this._rasterizeShapes();
        }
    }

    /**
     * @private
     * @description Ajusta a força de sucção de uma Saída (bugs.md #52), chamado a cada tick do
     * arrasto do slider no painel de controle. Escreve `solver.sinkStrength` diretamente nas
     * células da forma, SEM passar por `_rasterizeShapes()` — que reconstrói `innerHTML` do
     * próprio painel (`_refreshValveWidget`) e destruiria o slider (e o arrasto em andamento)
     * no meio do gesto. Mesmo motivo pelo qual o slider de velocidade da Entrada usa
     * `updateSourceGroupVelocity` em vez de re-rasterizar; aqui não existe um "grupo" próprio no
     * solver pra Saída, então a atualização direta por célula faz esse mesmo papel.
     */
    _setSinkSuction(shape, suction) {
        shape.suction = Math.max(0, Math.min(FluidSolver.SINK_MAX_SUCTION, suction));
        this._replayShapeGeometry(shape, (x, y) => {
            if (x < 0 || x >= this.solver.xdim || y < 0 || y >= this.solver.ydim) return;
            this.solver.sinkStrength[x + y * this.solver.xdim] = shape.suction;
        });
    }

    /**
     * @private
     * @description Aplica velocidade/ângulo do fluxo digitados no painel flutuante pra uma
     * Entrada selecionada — mesmo efeito de arrastar a seta, só que com um valor exato.
     */
    _applySourceVelocity() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.cellType !== FluidSolver.CELL_TYPE.SOURCE) return;
        this._saveState();

        const speed = Math.max(0, Math.min(FluidSimulationApp.MAX_SOURCE_SPEED, Number(this.floatingPanelSpeedInput.value) || 0));
        const angleRad = (Number(this.floatingPanelFlowAngleInput.value) || 0) * Math.PI / 180;
        this._setSourceVelocity(shape, speed * Math.cos(angleRad), speed * Math.sin(angleRad));
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
     * @description Ajusta o furo de uma Grade selecionada (bugs.md #32) — muda física de
     * verdade (o que uma partícula consegue ou não atravessar), então precisa re-rasterizar o
     * array por célula do solver, diferente do puramente-cosmético `_applyLineWidth`.
     */
    _applyMeshHoleSize() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.cellType !== FluidSolver.CELL_TYPE.MESH) return;
        this._saveState();
        shape.holeSize = Number(this.meshHoleSizeSlider.value);
        this.meshHoleSizeValue.textContent = shape.holeSize.toFixed(2);
        this._rasterizeShapes();
        this._markDirty();
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
    /**
     * @private
     * @description Coleta as propriedades de ajuste de Rotor de uma origem qualquer (um corpo do
     * solver, uma forma vetorial, uma configuração importada), caindo no padrão para as que
     * faltarem — é o que permite um arquivo salvo antes de uma propriedade existir continuar
     * abrindo com o valor padrão dela.
     */
    _rotorPropsFrom(source) {
        const out = {};
        for (const key of FluidSimulationApp.ROTOR_PROP_KEYS) {
            out[key] = source?.[key] ?? this.rotorDefaults[key];
        }
        return out;
    }

    /**
     * @private
     * @description Deixa a chave de 3 posições e o slider de velocidade coerentes com a direção
     * dada: marca o botão certo como ativo e mostra a velocidade só quando o motor está ligado
     * (com o motor desligado ela não teria efeito nenhum, e um slider inerte na tela só confunde).
     */
    _syncRotorMotorControls(direction, speed) {
        if (!this.rotorMotorButtons) return;
        const dir = Number(direction) || 0;
        for (const button of this.rotorMotorButtons) {
            button.classList.toggle('active', Number(button.dataset.motor) === dir);
        }
        if (speed !== undefined) {
            const pct = Math.round(speed * 100);
            this.rotorMotorSpeedSlider.value = pct;
            this.rotorMotorSpeedValue.innerHTML = `${pct}%`;
            this._updateSliderFill(this.rotorMotorSpeedSlider);
        }
        this.rotorMotorSpeedRow.hidden = dir === 0;
    }

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
            this.floatingPanelMeshControls.hidden = true;
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
            [FluidSolver.CELL_TYPE.ROTOR]: 'Rotor',
            [FluidSolver.CELL_TYPE.VALVE]: 'Válvula',
            [FluidSolver.CELL_TYPE.MESH]: 'Grade'
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

        const showMeshControls = !!shape && shape.cellType === FluidSolver.CELL_TYPE.MESH;
        this.floatingPanelMeshControls.hidden = !showMeshControls;
        if (showMeshControls) {
            const active = document.activeElement;
            if (active !== this.meshHoleSizeSlider) {
                const holeSize = shape.holeSize ?? FluidSolver.MESH_DEFAULT_HOLE_SIZE;
                this.meshHoleSizeSlider.value = holeSize;
                this.meshHoleSizeValue.textContent = holeSize.toFixed(2);
                this._updateSliderFill(this.meshHoleSizeSlider);
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
            this._syncRotorMotorControls(body.motorDirection ?? 0, body.motorSpeed ?? this.rotorDefaults.motorSpeed);
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
     * @description Reconstrói o painel de controle (faixa própria abaixo do canvas, bugs.md
     * #50 — substituiu a barra flutuante do #31, que sobrepunha o canvas) a partir de
     * `shapes[]`: um "módulo" por Entrada/Saída/Válvula na cena, com indicador luminoso e
     * interruptor tipo bascule pra abrir/fechar o fluxo sem precisar selecionar a forma; a
     * Entrada ganha também um controle de velocidade inline, item explícito do pedido original
     * ("para entrada poderiamos ter como ajustar a velocidade tb"). Fica escondido se não
     * houver nenhuma das três ainda. Chamada sempre que `_rasterizeShapes()` roda (o chokepoint
     * de "shapes[] mudou").
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

            const unit = document.createElement('div');
            unit.className = 'control-unit' + (isOpen ? ' open' : '');
            unit.title = `${typeName} ${label} — ${isOpen ? 'aberta' : 'fechada'}`;

            const labelRow = document.createElement('div');
            labelRow.className = 'control-unit-label';
            const led = document.createElement('span');
            led.className = 'control-unit-led';
            labelRow.appendChild(led);
            labelRow.appendChild(document.createTextNode(label));
            unit.appendChild(labelRow);

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'control-unit-switch';
            input.setAttribute('aria-label', `${typeName} ${label}`);
            input.checked = isOpen;
            input.addEventListener('change', () => {
                this._saveState();
                shape.enabled = input.checked;
                unit.classList.toggle('open', input.checked);
                unit.title = `${typeName} ${label} — ${input.checked ? 'aberta' : 'fechada'}`;
                this._rasterizeShapes();
                this._markDirty();
                this._requestPaint();
            });
            unit.appendChild(input);

            // Ajuste de velocidade inline, só na Entrada (bugs.md #50) — mesmo range/lógica do
            // slider "Velocidade do Fluxo" global, mas por Entrada individual, preservando o
            // ângulo já escolhido (arrastando a seta ou pelo painel flutuante).
            if (isSource) {
                const row = document.createElement('div');
                row.className = 'control-unit-speed';
                const speedInput = document.createElement('input');
                speedInput.type = 'range';
                speedInput.min = '0';
                speedInput.max = String(FluidSimulationApp.MAX_SOURCE_SPEED);
                speedInput.step = '0.005';
                const currentSpeed = Math.hypot(shape.vx, shape.vy);
                speedInput.value = String(currentSpeed);
                const valueLabel = document.createElement('span');
                valueLabel.textContent = currentSpeed.toFixed(2);
                speedInput.addEventListener('input', () => {
                    const speed = Number(speedInput.value);
                    valueLabel.textContent = speed.toFixed(2);
                    const angle = Math.atan2(shape.vy, shape.vx) || 0;
                    this._setSourceVelocity(shape, speed * Math.cos(angle), speed * Math.sin(angle));
                    if (this.selectedShapeIndex >= 0 && this.shapes[this.selectedShapeIndex] === shape) {
                        this._updateFloatingPanel();
                    }
                    this._markDirty();
                    this._requestPaint();
                });
                row.appendChild(speedInput);
                row.appendChild(valueLabel);
                unit.appendChild(row);
            }

            // Ajuste de força de sucção inline, só na Saída (bugs.md #52) — mesmo padrão do
            // slider de velocidade da Entrada logo acima: fica dentro do próprio módulo, sem
            // precisar selecionar a forma. Escala as 9 distribuições da célula por passo (ver
            // FluidSolver._applySourcesAndSinks); 0 volta ao comportamento antigo (dreno
            // puramente visual, sem sucção nenhuma).
            if (isSink) {
                const row = document.createElement('div');
                row.className = 'control-unit-speed';
                const suctionInput = document.createElement('input');
                suctionInput.type = 'range';
                suctionInput.min = '0';
                suctionInput.max = String(FluidSolver.SINK_MAX_SUCTION);
                suctionInput.step = '0.002';
                const currentSuction = shape.suction ?? FluidSolver.SINK_DEFAULT_SUCTION;
                suctionInput.value = String(currentSuction);
                const valueLabel = document.createElement('span');
                valueLabel.textContent = currentSuction.toFixed(3);
                suctionInput.addEventListener('input', () => {
                    const suction = Number(suctionInput.value);
                    valueLabel.textContent = suction.toFixed(3);
                    this._setSinkSuction(shape, suction);
                    this._markDirty();
                    this._requestPaint();
                });
                row.appendChild(suctionInput);
                row.appendChild(valueLabel);
                unit.appendChild(row);
            }

            this.valveControlsWidget.appendChild(unit);
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
        this.solver.initParticles();
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
        this.solver.dyeSources = [];
        this.solver.initParticles(); // objetos avulsos somem junto (bugs.md #32, sem fonte)
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
        // `_copySelection` termina limpando `selectionArea`, e `_deleteSelection` precisa dela:
        // sem restaurá-la o recorte só copiava e nunca apagava a origem. Salva o ponto de
        // desfazer (true) porque a cópia não salva nenhum, e recortar tem que ser desfazível.
        const area = this.selectionArea;
        this._copySelection();
        this.selectionArea = area;
        this._deleteSelection(true);
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
    /**
     * @private
     * @description Sincroniza os campos de tamanho da grade com as dimensões que a simulação
     * REALMENTE tem agora — chamado depois de qualquer coisa que recrie a grade (novo cenário,
     * importar configuração, restaurar auto-save), para os campos nunca mostrarem um tamanho que
     * não é o da cena na tela.
     */
    _syncGridSizeInputs() {
        if (!this.gridWidthInput || !this.solver) return;
        this.gridWidthInput.value = this.solver.xdim;
        this.gridHeightInput.value = this.solver.ydim;
        this._updateGridSizeHint();
    }

    /**
     * @private
     * @description Atualiza a linha de dica embaixo dos campos: quanto a grade digitada tem de
     * células e, quando for grande o bastante para pesar, um aviso. Mostra também o tamanho
     * atual quando o valor digitado ainda não foi aplicado, para ficar claro que o campo é uma
     * intenção, não o estado da simulação.
     */
    _updateGridSizeHint() {
        if (!this.gridSizeHint || !this.solver) return;
        const w = Number(this.gridWidthInput.value);
        const h = Number(this.gridHeightInput.value);
        const atual = `Atual: ${this.solver.xdim} × ${this.solver.ydim}`;
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            this.gridSizeHint.textContent = atual;
            this.gridSizeHint.classList.remove('is-heavy');
            return;
        }
        // Valor fora dos limites não vira contagem de células: dizer "38 milhões de células — vai
        // rodar lento" para um tamanho que o Aplicar vai recusar de qualquer jeito é pior que não
        // dizer nada, porque descreve como lento algo que é impossível.
        const MIN = FluidSimulationApp.GRID_MIN_DIM,
            MAX = FluidSimulationApp.GRID_MAX_DIM;
        if (w < MIN || h < MIN || w > MAX || h > MAX) {
            this.gridSizeHint.textContent = `Cada lado precisa estar entre ${MIN} e ${MAX} · ${atual.toLowerCase()}`;
            this.gridSizeHint.classList.add('is-heavy');
            return;
        }
        const area = Math.round(w) * Math.round(h);
        const pendente = Math.round(w) !== this.solver.xdim || Math.round(h) !== this.solver.ydim;
        const celulas = area >= 1000 ? `${(area / 1000).toFixed(0)} mil células` : `${area} células`;
        const pesada = area > FluidSimulationApp.GRID_HEAVY_AREA;
        this.gridSizeHint.textContent = pendente
            ? `${celulas}${pesada ? ' — vai rodar lento' : ''} · ${atual.toLowerCase()}`
            : `${atual} (${celulas})`;
        this.gridSizeHint.classList.toggle('is-heavy', pendente && pesada);
    }

    /**
     * @private
     * @description Aplica um novo tamanho de grade (bugs.md #49). Recriar a grade recria todos
     * os arrays do solver, então a cena inteira (formas, rotores, fumaça, desfazer/refazer) vai
     * junto — daí a confirmação, no mesmo padrão do "Limpar tudo".
     */
    async _applyGridSize() {
        const MIN = FluidSimulationApp.GRID_MIN_DIM,
            MAX = FluidSimulationApp.GRID_MAX_DIM;
        const w = Math.round(Number(this.gridWidthInput.value));
        const h = Math.round(Number(this.gridHeightInput.value));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < MIN || h < MIN || w > MAX || h > MAX) {
            Swal.fire({
                title: 'Tamanho inválido',
                text: `Cada lado da grade precisa estar entre ${MIN} e ${MAX} células.`,
                icon: 'error'
            });
            this._syncGridSizeInputs();
            return;
        }
        const area = w * h;
        if (area > FluidSimulationApp.GRID_MAX_AREA) {
            Swal.fire({
                title: 'Grade grande demais',
                html: `Uma grade de <strong>${w} × ${h}</strong> tem ${(area / 1000000).toFixed(1)} milhões de células. O limite é ${(FluidSimulationApp.GRID_MAX_AREA / 1000000).toFixed(1)} milhão — acima disso a simulação consome memória demais e trava o navegador em vez de ficar só lenta.`,
                icon: 'error'
            });
            return;
        }
        if (w === this.solver.xdim && h === this.solver.ydim) {
            this._updateGridSizeHint();
            return;
        }
        const pesada = area > FluidSimulationApp.GRID_HEAVY_AREA;
        const result = await Swal.fire({
            title: `Mudar a grade para ${w} × ${h}?`,
            html: `A grade é recriada do zero: <strong>tudo o que está desenhado será apagado</strong> (barreiras, entradas, saídas, rotores e fumaça), e o histórico de desfazer também. Esta ação não pode ser desfeita.${pesada ? `<br><br><strong>Atenção:</strong> ${(area / 1000).toFixed(0)} mil células é uma grade pesada — a simulação vai rodar bem mais devagar que o normal.` : ''}`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-table-cells"></i> Aplicar tamanho',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ff5d5d',
            reverseButtons: true
        });
        if (!result.isConfirmed) {
            this._syncGridSizeInputs();
            return;
        }
        // Recriar a grade troca o objeto `solver` inteiro; parar o laço antes evita que um passo
        // já agendado rode em cima do solver antigo logo depois da troca.
        if (this.running) this.startStop();
        this._resetSimulation(w, h);
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
     * mesma informação podem divergir silenciosamente se guardadas juntas. `solver.particles`
     * (objetos avulsos de bugs.md #32) fica de fora de propósito: sem uma "fonte" que os defina,
     * eles são estado vivo da simulação, não geometria de design — mesmo tratamento que
     * `dyeTracers`/`tracerX/Y` já recebem (nunca entraram no undo, só as SUAS fontes entravam).
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

applyMixin(FluidSimulationApp.prototype, HelpDialogs);

applyMixin(FluidSimulationApp.prototype, Persistence);
