import { FluidSolver } from './FluidSolver.js?v=20260908d';
import { Renderer } from './Renderer.js?v=20260908d';
import { DEFAULT_LINE_WIDTH } from './PolygonGeometry.js?v=20260908d';
import { Rasterization } from './app/rasterization.js?v=20260908d';
import { ShapeProperties } from './app/shapeProperties.js?v=20260908d';
import { ShapeDrag } from './app/shapeDrag.js?v=20260908d';
import { HitTesting } from './app/hitTesting.js?v=20260908d';
import { ControlPanel } from './app/controlPanel.js?v=20260908d';
import { UiChrome } from './app/uiChrome.js?v=20260908d';
import { GridSize } from './app/gridSize.js?v=20260908d';
import { Viewport } from './app/viewport.js?v=20260908d';
import { History } from './app/history.js?v=20260908d';
import { Selection } from './app/selection.js?v=20260908d';
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

applyMixin(FluidSimulationApp.prototype, Selection);

applyMixin(FluidSimulationApp.prototype, History);

applyMixin(FluidSimulationApp.prototype, Viewport);

applyMixin(FluidSimulationApp.prototype, GridSize);

applyMixin(FluidSimulationApp.prototype, UiChrome);

applyMixin(FluidSimulationApp.prototype, ControlPanel);

applyMixin(FluidSimulationApp.prototype, HitTesting);

applyMixin(FluidSimulationApp.prototype, ShapeDrag);

applyMixin(FluidSimulationApp.prototype, ShapeProperties);

applyMixin(FluidSimulationApp.prototype, Rasterization);
