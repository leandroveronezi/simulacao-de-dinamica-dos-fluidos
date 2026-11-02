/**
 * @class FluidSolver
 * @description Motor de física da simulação de dinâmica dos fluidos (Lattice-Boltzmann, D2Q9).
 * Não possui nenhuma referência a DOM/canvas — apenas estado numérico e as regras do LBM.
 */
export class FluidSolver {
    static CELL_TYPE = Object.freeze({
        NORMAL: 0,
        BARRIER: 1,
        SOURCE: 2,
        SINK: 3,
        ROTOR: 4,
        // VALVE nunca aparece de fato em solver.cellType — é resolvida pra NORMAL (aberta) ou
        // BARRIER (fechada) antes de tocar o solver, ver FluidSimulationApp._rasterizeShapes.
        // Existe só como identidade de shapes[]/UI (bugs.md #40).
        VALVE: 5,
        // MESH ("Grade", bugs.md #32): ao contrário de BARRIER, NÃO bloqueia o fluido — fica de
        // fora do branch de bounce-back em stream(), então vento/fumaça/traçadores atravessam
        // normalmente. O que ela faz é frear o vento (ver MESH_RESISTANCE em collide()) e
        // bloquear só PARTÍCULAS grandes demais pro furo (ver `meshHoleSize` por célula).
        MESH: 6
    });

    static N_TRACERS = 144;

    // Passos seguidos parado antes de um traçador ser reciclado (bugs.md #25). Serve para os
    // casos que o deslize ao longo da parede não resolve: um canto interno fechado dos dois
    // lados, ou um ponto de estagnação de verdade (velocidade ~0 encostando no obstáculo). Sem
    // isso a partícula fica ali para sempre e, com o tempo, o pool inteiro vai parar grudado nas
    // barreiras. O valor é alto de propósito — vários segundos de simulação — para não reciclar
    // fumaça que só está passeando devagar numa região de recirculação (isso é comportamento
    // físico legítimo e deve continuar visível).
    static TRACER_MAX_STUCK_STEPS = 600;
    static MAX_DYE_TRACERS = 4000;
    static PARTICLES_PER_FRAME_EMISSION = 10;

    // Limitador de segurança (bugs.md #51): grampeia por célula, DENTRO de collide(), bem antes de
    // `checkStability()` ver o resultado. Uso normal do solver fica bem abaixo disso (u0 do
    // slider vai até 0.1, ROTOR_MAX_TIP_SPEED é 0.10) — o teto só entra em ação em células que já
    // estariam saindo da faixa físicamente sensata, então não afeta a simulação em operação
    // normal. Não é uma prova formal de estabilidade (CFL) — é um "realizability limiter" comum em
    // LBM: barra o pico numérico ANTES dele virar NaN/densidade negativa e se espalhar pra grade
    // inteira, em vez de só detectar o estrago depois de feito (que é tudo que `checkStability()`
    // fazia até aqui). MAX_SAFE_SPEED fica bem abaixo do limiar de ruptura de `checkStability()`
    // (0.5) pra sobrar margem real de amortecimento antes de bater no teto duro.
    static MAX_SAFE_SPEED = 0.3;
    static MIN_SAFE_RHO = 0.2;
    static MAX_SAFE_RHO = 3.0;

    // Fração da grade que pode estar sendo grampeada antes de a simulação ser considerada
    // instável. Isto é o que devolve sentido a `checkStability()` depois do limitador acima:
    // como o limitador grampeia justamente os valores que o detector lê (`rho`, `ux`, `uy`), os
    // critérios de densidade negativa e velocidade absurda ficaram impossíveis de disparar —
    // sobrou só NaN. Verificado: viscosidade 0,0005 com u0 0,1 deixa ~24% da grade presa no teto
    // e o detector antigo relatava "estável", com o usuário olhando para um resultado sem
    // sentido físico e sem nenhum aviso. O valor foi calibrado medindo cenários reais, não
    // chutado: com os ajustes padrão do app (viscosidade 0,020 e velocidade 0,10, com barreiras
    // e Rotor na cena) o limitador já age em picos de 1,2% a 1,9% da grade — grampear célula
    // isolada perto de uma quina é o limitador fazendo o trabalho dele, não é defeito. O caso
    // realmente arruinado (viscosidade 0,0005) fica em ~25%, uma ordem de grandeza acima. 5%
    // separa os dois com folga dos dois lados: não acusa uso normal e não deixa passar
    // divergência de verdade.
    static MAX_CLAMPED_FRACTION = 0.05;

    // Igual ao máximo de "Velocidade do Fluxo" (u0) permitido pelo slider — mantém a
    // velocidade de ponta do Rotor na mesma faixa que o resto do solver já é ajustado/validado
    // para suportar. 0.15 (usado antes) parecia estável em testes curtos, mas rodando por mais
    // tempo (~1000+ passos) desestabilizava eventualmente, mesmo com um único Rotor — a fronteira
    // de estabilidade aqui não é monotônica com esse valor (testei 0.10/0.12/0.13/0.14/0.15: só
    // 0.13 falhou cedo, os outros ficaram estáveis por 3000-6000 passos, incluindo dois Rotores
    // simultâneos) — não dá para escolher com confiança um valor "só um pouco mais alto" sem
    // rodar de novo por milhares de passos; ficar dentro da faixa já validada pro resto do
    // solver é a escolha mais segura.
    static ROTOR_MAX_TIP_SPEED = 0.10;

    // Suavização temporal do torque medido no fluido (bugs.md #52/#53). O corpo e o fluido são
    // acoplados de forma explícita (o torque de um passo é aplicado no passo seguinte), e uma pá
    // de 1 célula de espessura tem "massa adicionada" — a massa de fluido que ela precisa
    // empurrar junto — muito maior que a sua própria. Nessa faixa, o acoplamento explícito tem um
    // modo instável na frequência de Nyquist: o torque medido troca de sinal a cada passo e
    // cresce, mesmo com o balanço de momento já fechado pelo termo de arrasto. Uma média móvel
    // exponencial mata justamente esse modo (é a frequência mais alta representável, a que mais
    // sofre com o filtro) sem mexer no valor médio, que é o que responde ao fluxo de verdade —
    // técnica padrão ("under-relaxation da força hidrodinâmica") em acoplamento fluido-estrutura.
    // O preço é um atraso de ~1/α passos na resposta a mudanças bruscas de fluxo, imperceptível
    // na escala de tempo em que o usuário mexe nos controles.
    static ROTOR_TORQUE_SMOOTHING = 0.2;

    // Ganho do motor do Rotor (bugs.md #54), por passo e já normalizado pela inércia do corpo —
    // um corpo grande precisa de mais torque para a mesma aceleração, e dividir pela inércia
    // deixa o controle com a mesma sensação em qualquer Rotor. O motor é modelado como controle
    // de VELOCIDADE (torque proporcional ao erro, T = ganho·I·(alvo - omega)), não de torque
    // constante: é o que corresponde à expectativa de um motor/ventilador de painel — você
    // escolhe o quanto ele gira e ele segura essa rotação contra a carga do fluido. Como o termo
    // é linear em omega, ele entra implicitamente junto com o arrasto, então valores altos de
    // ganho continuam estáveis.
    static ROTOR_MOTOR_GAIN = 0.5;

    // Fração da velocidade macroscópica MANTIDA (não removida) a cada passo, célula a célula,
    // dentro de uma célula MESH — bugs.md #32, "a Grade... diminuiria a velocidade do vento".
    // Aplicado em `collide()`, sobre a velocidade JÁ recalculada a partir do streaming daquele
    // passo (não é um decaimento acumulado à parte) — o resultado realimenta o streaming
    // seguinte, então uma faixa de Grade com várias células de espessura COMPÕE o efeito célula
    // a célula (mais espessa = mais resistência, como várias telas empilhadas): a fração que
    // sobra depois de N células é `keep^N`, não `keep` — MULTIPLICATIVO, não aditivo. Isso
    // importa pra calibrar: testei primeiro com 0,55 achando que daria "~55% de redução numa
    // faixa de 6 células", mas 0,55^6 ≈ 2,8% da velocidade original (97% de redução) — quase um
    // BARRIER pra qualquer Grade com mais de 2-3 células de espessura, quando o pedido original
    // era só "diminuir a velocidade", não bloquear. 0,85 é bem mais gentil por célula
    // (0,85^6 ≈ 38% mantido, ~62% de redução numa faixa de 6 — perceptível sem ficar opaca) e
    // ainda cresce naturalmente com a espessura, como uma tela de verdade.
    static MESH_RESISTANCE_KEEP = 0.85;

    // Furo padrão de uma Grade recém-desenhada, em frações de célula — usado só como valor
    // inicial de `shape.holeSize` (ajustável depois pelo painel flutuante, ver
    // FluidSimulationApp). 0,3 é MENOR que a menor partícula possível (peso 0 tem diâmetro
    // 0,36), então uma Grade recém-desenhada segura TUDO: é o que a pessoa espera ao desenhar
    // uma grade, e deixar passar é o caso especial (basta abrir o furo no painel). O padrão
    // anterior, 0,5, era maior que a Folha nos pesos leves (diâmetro 0,36 a 0,47) — então uma
    // Grade recém-desenhada deixava folhas e bolinhas leves atravessarem, o que parecia um bug
    // mesmo estando "correto" pelo modelo.
    static MESH_DEFAULT_HOLE_SIZE = 0.3;

    // --- Saída (Sink) como dreno de verdade, bugs.md #52 ---
    // Fração da massa que uma célula SINK remove por passo. O dreno é aplicado escalando as 9
    // distribuições da célula pelo MESMO fator: como `u = Σf·c / ρ` tem a densidade no
    // denominador, escalar tudo junto derruba ρ mas deixa `u` intacta — por construção não
    // existe reflexão possível, e portanto não existe "efeito barreira" (a tentativa antiga,
    // registrada no item #44, reduzia a VELOCIDADE, que é justamente o que desviava o fluxo em
    // volta). O que puxa o fluido vizinho é a queda de pressão resultante, que é o mecanismo
    // físico de um ralo de verdade.
    static SINK_DEFAULT_SUCTION = 0.02;
    // Teto do slider. Acima de ~0,15 a célula satura em MIN_SAFE_RHO e a sucção para de crescer
    // (o grampo de estabilidade passa a mandar), então liberar mais só daria um controle que não
    // faz nada na ponta de cima da faixa.
    static SINK_MAX_SUCTION = 0.1;

    // Piso de densidade do dreno: abaixo de SINK_RHO_FLOOR a célula não drena mais nada, e entre
    // o piso e 1.0 a taxa entra por uma rampa linear. Isto é o que impede o "efeito aspirador"
    // do item #44 — sem ele, um ralo dentro de um recinto SELADO por barreiras (sem nenhuma
    // borda aberta repondo massa) esvazia o recinto indefinidamente até bater em MIN_SAFE_RHO e
    // a simulação virar lixo numérico (medido: ρ caindo 0,82 → 0,54 e continuando). Com o piso,
    // esse mesmo caso converge (ρ ≈ 0,71 estável por 20 mil passos) e o caso normal — canal com
    // borda de entrada repondo massa — nem chega perto do piso, então o dreno segue em cheio.
    static SINK_RHO_FLOOR = 0.6;

    // --- Partículas físicas (bolinhas/caixas/folhas), bugs.md #32 ---
    // Objetos avulsos, carimbados um por clique (`addParticle`, ver FluidSimulationApp) — sem
    // "fonte" emitindo sem parar: o usuário pediu explicitamente esse comportamento (o modelo
    // anterior, copiado da Fumaça, tratava cada clique como um ponto que ficava emitindo pra
    // sempre — pedido incomum pra um objeto físico discreto tipo uma bolinha ou caixa). Cada
    // partícula tem um "peso" contínuo (0=leve/folha .. 1=pesado/caixa) em vez de 3 presets
    // desconectados — um só slider no app cobre o pedido de "ajustar as propriedades pra terem
    // mais peso, mais leveza", e o tipo (folha/bolinha/caixa) escolhido na UI vira só o ponto de
    // partida do peso + a forma usada pro desenho (ver Renderer). Os 3 parâmetros físicos por
    // partícula (raio, arrasto, gravidade) são interpolados a partir do peso — ver
    // `particlePhysicsFromWeight`.
    static MAX_PARTICLES = 300;
    // Raio da partícula em células de grade — usado tanto pro desenho quanto pra decidir se ela
    // cabe no furo de uma Grade (bloqueio por `2×radius > holeSize` da célula).
    static PARTICLE_RADIUS_MIN = 0.18;
    static PARTICLE_RADIUS_MAX = 0.55;
    // Coeficiente de arrasto (fração da diferença de velocidade fluido-partícula convertida em
    // aceleração a cada passo) — alto pra leve (acompanha o vento de perto, como uma folha),
    // baixo pra pesado (mais inércia, menos arrastado pelo vento, como uma caixa). O TEMPO que a
    // partícula leva pra "pegar" o vento é ~1/drag passos — interpolado em ESCALA LOG (não
    // linear) em `particlePhysicsFromWeight`, porque o que o olho percebe é esse tempo de
    // resposta, não o coeficiente em si: testado com interpolação linear entre 0,05 e 0,4, só o
    // extremo mais pesado (peso>0,9) tinha resposta visivelmente lenta — o miolo inteiro (peso
    // 0,25 a 0,75) já convergia a mais de 90% do vento em 30 passos, indistinguível a olho nu.
    // Em log, os tempos de resposta (1/drag) ficam espaçados uniformemente ao longo do peso.
    static PARTICLE_DRAG_MIN = 0.006;
    static PARTICLE_DRAG_MAX = 0.4;
    // Aceleração da gravidade (grid-y decrescente é "pra baixo" na tela, ver Renderer — a grade
    // é desenhada com y=0 embaixo). Leve cai bem devagar (flutua/paira), pesado cai rápido.
    static PARTICLE_GRAVITY_MIN = 0.0006;
    static PARTICLE_GRAVITY_MAX = 0.012;
    // Perde energia a cada quique contra um sólido (parede/barreira/chão-teto do domínio) — sem
    // isso uma partícula sob gravidade nunca assentaria, ficaria quicando pra sempre na mesma
    // altura. <1 é obrigatório pra decair; calibrado pra decair visivelmente em poucos quiques
    // sem parecer "morta" instantaneamente (perde a maior parte da energia, não toda).
    static PARTICLE_RESTITUTION = 0.35;
    // Teto de segurança pra velocidade da partícula — mesmo espírito do limitador de segurança
    // do solver (bugs.md #51): nunca deixa uma aceleração isolada (ex.: um quique mal resolvido
    // perto de um canto) mandar a partícula pra longe da cena num passo só.
    static PARTICLE_MAX_SPEED = 0.5;
    // Abaixo desta velocidade NUM EIXO bloqueado, zera a velocidade nesse eixo em vez de
    // refletir —sem isso uma partícula assentada no chão sob gravidade fica quicando pra
    // sempre em amplitude decrescente (geometricamente, nunca chegando a exatamente zero) em
    // vez de assentar de fato.
    static PARTICLE_REST_EPS = 0.004;

    constructor(xdim, ydim) {
        // Pesos do modelo LBM D2Q9
        this.FOUR_NINTHS = 4.0 / 9.0;
        this.ONE_NINTH = 1.0 / 9.0;
        this.ONE_THIRTY_SIXTH = 1.0 / 36.0;

        this.boundaryMode = 'channel'; // 'channel' | 'open'
        this.resize(xdim, ydim);
    }

    /**
     * @description (Re)aloca todos os arrays da simulação para uma nova dimensão de grade.
     */
    resize(xdim, ydim) {
        this.xdim = xdim;
        this.ydim = ydim;
        const size = xdim * ydim;

        // Arrays para as 9 distribuições de partículas (D2Q9)
        this.n0 = new Float32Array(size);
        this.nN = new Float32Array(size);
        this.nS = new Float32Array(size);
        this.nE = new Float32Array(size);
        this.nW = new Float32Array(size);
        this.nNE = new Float32Array(size);
        this.nSE = new Float32Array(size);
        this.nNW = new Float32Array(size);
        this.nSW = new Float32Array(size);

        // Arrays temporários para o passo de propagação
        this.temp_n0 = new Float32Array(size);
        this.temp_nN = new Float32Array(size);
        this.temp_nS = new Float32Array(size);
        this.temp_nE = new Float32Array(size);
        this.temp_nW = new Float32Array(size);
        this.temp_nNE = new Float32Array(size);
        this.temp_nSE = new Float32Array(size);
        this.temp_nNW = new Float32Array(size);
        this.temp_nSW = new Float32Array(size);

        // Arrays para as variáveis macroscópicas
        this.rho = new Float32Array(size).fill(1);
        this.ux = new Float32Array(size);
        this.uy = new Float32Array(size);
        this.curl = new Float32Array(size);

        this.cellType = new Uint8Array(size);
        this.sourceVx = new Float32Array(size);
        this.sourceVy = new Float32Array(size);
        this.sourceGroups = [];
        this.dyeSources = [];
        this.rotatingBodies = [];
        this.rotorWallVx = new Float32Array(size);
        this.rotorWallVy = new Float32Array(size);
        this.rotorBodyIndex = new Int32Array(size).fill(-1);
        this._rotorTorqueAccum = new Float64Array(0);
        this._rotorDragAccum = new Float64Array(0);
        // Tamanho do furo (em células) de cada célula MESH — só tem sentido onde cellType é
        // MESH, ver FluidSolver.CELL_TYPE.MESH e `_updateParticles`.
        this.meshHoleSize = new Float32Array(size).fill(FluidSolver.MESH_DEFAULT_HOLE_SIZE);
        // Sucção por célula de cada Saída — só tem sentido onde cellType é SINK. Mesmo padrão de
        // sourceVx/vy e meshHoleSize: a "verdade" do parâmetro mora em `shape.suction`, espelhada
        // aqui toda vez que a grade é rasterizada (ver FluidSimulationApp._rasterizeShapes).
        this.sinkStrength = new Float32Array(size).fill(FluidSolver.SINK_DEFAULT_SUCTION);

        this.sensorX = Math.round(xdim / 2);
        this.sensorY = Math.round(ydim / 2);

        this.barrierCount = 0;
        this.barrierxSum = 0;
        this.barrierySum = 0;
        this.barrierFx = 0.0;
        this.barrierFy = 0.0;

        this.initTracers(false);
        this.initDyeTracers();
        this.initParticles();
    }

    /**
     * @description Interpola os 3 parâmetros físicos de uma partícula (raio/arrasto/
     * gravidade) a partir de um único "peso" contínuo 0..1 — ver comentário de
     * `MAX_PARTICLES` sobre por que um slider só em vez de presets desconectados.
     */
    static particlePhysicsFromWeight(weight) {
        const w = Math.max(0, Math.min(1, weight));
        const lerp = (a, b) => a + (b - a) * w;
        // Arrasto interpolado em escala LOG (não linear) — ver comentário em
        // `PARTICLE_DRAG_MIN`: o que se percebe visualmente é o TEMPO de resposta (~1/drag), e
        // só uma interpolação geométrica do coeficiente espalha esse tempo de forma uniforme ao
        // longo do peso (uma linear deixava quase todo o meio da faixa "rápido demais").
        // Invertido em relação a raio/massa/gravidade: peso 0 (leve/folha) usa o arrasto MÁXIMO
        // (acompanha o vento de perto), peso 1 (pesado/caixa) usa o MÍNIMO (mais inércia).
        const drag = FluidSolver.PARTICLE_DRAG_MAX * Math.pow(FluidSolver.PARTICLE_DRAG_MIN / FluidSolver.PARTICLE_DRAG_MAX, w);
        return {
            radius: lerp(FluidSolver.PARTICLE_RADIUS_MIN, FluidSolver.PARTICLE_RADIUS_MAX),
            drag,
            gravity: lerp(FluidSolver.PARTICLE_GRAVITY_MIN, FluidSolver.PARTICLE_GRAVITY_MAX)
        };
    }

    /**
     * @description (Re)inicializa o pool de partículas físicas — chamado no resize() e sempre
     * que o fluido é resetado. Sem fonte pra continuar existindo depois de um reset (bugs.md
     * #32, objetos avulsos), o pool simplesmente volta a zero: qualquer bolinha/caixa/folha
     * carimbada antes some junto, igual as setas/fumaça já se comportam num reset.
     */
    initParticles() {
        this.particles = [];
        for (let i = 0; i < FluidSolver.MAX_PARTICLES; i++) {
            this.particles.push({ x: -1, y: -1, vx: 0, vy: 0, weight: 0.5, radius: 0.4 });
        }
    }

    setCell(x, y, type) {
        if (x >= 0 && x < this.xdim && y >= 0 && y < this.ydim) {
            this.cellType[x + y * this.xdim] = type;
            return true;
        }
        return false;
    }

    /**
     * @description Registra um novo grupo de Entrada a partir das células já pintadas como
     * SOURCE — agrupa as células desenhadas juntas sob um vetor de velocidade compartilhado,
     * pra poder selecionar e reajustar a direção/velocidade depois (igual ao pivô do Rotor),
     * em vez de precisar apagar e redesenhar. `sourceVx/sourceVy` (arrays por célula, usados
     * pela física em `_applySourcesAndSinks`) continuam sendo a fonte de verdade pro solver —
     * este grupo é só a camada de identidade/seleção por cima deles.
     */
    addSourceGroup(cells, vx, vy) {
        if (!cells || cells.length === 0) return;
        let sumX = 0,
            sumY = 0;
        for (const {
            x,
            y
        } of cells) {
            sumX += x;
            sumY += y;
        }
        const originX = sumX / cells.length;
        const originY = sumY / cells.length;
        this.sourceGroups.push({
            cells: cells.map(c => ({
                x: c.x,
                y: c.y
            })),
            originX,
            originY,
            vx,
            vy
        });
        for (const {
            x,
            y
        } of cells) {
            const i = x + y * this.xdim;
            this.sourceVx[i] = vx;
            this.sourceVy[i] = vy;
        }
    }

    /**
     * @description Reajusta a velocidade de um grupo de Entrada já existente (selecionado pelo
     * usuário), reescrevendo tanto o grupo quanto as células planas que a física lê.
     */
    updateSourceGroupVelocity(index, vx, vy) {
        const group = this.sourceGroups[index];
        if (!group) return;
        group.vx = vx;
        group.vy = vy;
        for (const {
            x,
            y
        } of group.cells) {
            const i = x + y * this.xdim;
            this.sourceVx[i] = vx;
            this.sourceVy[i] = vy;
        }
    }

    /**
     * @description Remove da lista os grupos de Entrada cujas células foram todas apagadas por
     * fora (borracha, apagar seleção, "Limpar") — evita que o marcador/seta fique "fantasma"
     * apontando pra um lugar que não é mais Entrada.
     */
    pruneStaleSourceGroups() {
        this.sourceGroups = this.sourceGroups.filter(group =>
            group.cells.some(({
                x,
                y
            }) => this.cellType[x + y * this.xdim] === FluidSolver.CELL_TYPE.SOURCE)
        );
    }

    /**
     * @description Registra um novo corpo giratório a partir das células já pintadas como
     * ROTOR (a forma em si é desenhada pelas ferramentas normais, via `setCell`). Se `pivot`
     * não for informado, usa o centróide das células desenhadas; passando `pivot` explícito
     * (ex.: um clique do usuário depois de desenhar a forma), o eixo de rotação fica onde o
     * usuário escolher, não necessariamente no centro da forma. O momento de inércia é
     * derivado da própria forma (soma de dx²+dy² a partir do pivô, "massa" unitária por
     * célula) em vez de ser uma constante global — do contrário uma turbina grande e uma
     * palheta pequena não teriam como conviver com o mesmo ajuste de sensibilidade.
     *
     * `options.massMultiplier/damping/stiffness` ficam guardados NESTE corpo (não mais
     * parâmetros globais de `step()`) — cada Rotor tem seu próprio ajuste, então dois corpos
     * na mesma cena podem se comportar de forma independente (um turbina livre, outro palheta
     * elástica, por exemplo).
     */
    addRotatingBody(cells, pivot, options = {}, replaceIndex = -1) {
        if (!cells || cells.length === 0) return;
        let pivotX, pivotY;
        if (pivot) {
            pivotX = pivot.x;
            pivotY = pivot.y;
        } else {
            let sumX = 0,
                sumY = 0;
            for (const {
                x,
                y
            } of cells) {
                sumX += x;
                sumY += y;
            }
            pivotX = sumX / cells.length;
            pivotY = sumY / cells.length;
        }
        let momentOfInertia = 0;
        let maxRadius = 0;
        const localCells = cells.map(({
            x,
            y
        }) => {
            const dx = x - pivotX,
                dy = y - pivotY;
            momentOfInertia += dx * dx + dy * dy;
            maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dy * dy));
            return {
                dx,
                dy
            };
        });
        const body = {
            pivotX,
            pivotY,
            localCells,
            currentCells: cells.map(c => ({
                x: c.x,
                y: c.y
            })),
            angle: 0,
            omega: 0,
            torqueFiltered: 0,
            restingAngle: 0,
            momentOfInertia: Math.max(1, momentOfInertia),
            maxRadius: Math.max(1, maxRadius),
            massMultiplier: options.massMultiplier ?? 1,
            damping: options.damping ?? 0.05,
            stiffness: options.stiffness ?? 0,
            // Motor (bugs.md #54): direção -1 (anti-horário), 0 (desligado, turbina livre) ou
            // +1 (horário); `motorSpeed` é a fração da velocidade máxima que o motor persegue.
            motorDirection: options.motorDirection ?? 0,
            motorSpeed: options.motorSpeed ?? 0.5
        };
        // Reformar um Rotor já existente (arrastar um handle de stretch/mover) substitui a
        // entrada no lugar — nunca um push duplicado, senão o corpo antigo continuaria vivo e
        // sendo simulado ao lado do novo. angle/omega sempre reiniciam em 0 (não há uma forma
        // limpa de "continuar girando" através de uma mudança de geometria).
        if (replaceIndex >= 0 && replaceIndex < this.rotatingBodies.length) {
            this.rotatingBodies[replaceIndex] = body;
        } else {
            this.rotatingBodies.push(body);
        }
    }

    /**
     * @description Reestampa as células de cada corpo giratório como ROTOR na grade — usado
     * depois de restaurar `rotatingBodies[]` (undo/redo, importar configuração), já que essas
     * células não fazem parte de `rawCellType`/`shapes[]` (a rasterização normal do app pula
     * Rotor de propósito, ver `_rasterizeShapes` em FluidSimulationApp.js) e por isso não
     * seriam repintadas sozinhas.
     */
    stampRotatingBodiesOntoGrid() {
        for (let i = 0; i < this.rotatingBodies.length; i++) {
            const body = this.rotatingBodies[i];
            for (const { x, y } of body.currentCells) {
                if (x < 0 || x >= this.xdim || y < 0 || y >= this.ydim) continue;
                const idx = x + y * this.xdim;
                this.cellType[idx] = FluidSolver.CELL_TYPE.ROTOR;
                this.rotorWallVx[idx] = -body.omega * (y - body.pivotY);
                this.rotorWallVy[idx] = body.omega * (x - body.pivotX);
                this.rotorBodyIndex[idx] = i;
            }
        }
    }

    /**
     * @private
     * @description Reconstrói o estado de fluido de uma célula recém-liberada por um corpo
     * giratório (deixou de ser ROTOR). Uma célula assim não tem histórico de distribuições
     * coerente, então em vez de um equilíbrio ambiente fixo (errado perto de Entradas/modo
     * aberto), usa a média de rho/velocidade dos vizinhos ortogonais não-sólidos, caindo pro
     * ambiente parado só se todos os vizinhos também forem sólidos.
     */
    _refillCell(x, y) {
        const xdim = this.xdim,
            ydim = this.ydim;
        const neighbors = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1]
        ];
        let sumRho = 0,
            sumUx = 0,
            sumUy = 0,
            count = 0;
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= xdim || ny < 0 || ny >= ydim) continue;
            const ni = nx + ny * xdim;
            const t = this.cellType[ni];
            if (t === FluidSolver.CELL_TYPE.BARRIER || t === FluidSolver.CELL_TYPE.ROTOR) continue;
            sumRho += this.rho[ni];
            sumUx += this.ux[ni];
            sumUy += this.uy[ni];
            count++;
        }
        // A densidade da célula devolvida ao fluido é a massa que ELA MESMA guardava enquanto era
        // sólida (o bounce-back mantém essa massa nas populações da célula), e não a média dos
        // vizinhos: a média inventava massa nova a cada célula varrida pela pá, e o descarte das
        // populações antigas a destruía. Medido numa caixa fechada com o motor ligado, a
        // densidade média subia ~0,35% por 1000 passos. Só cai na média dos vizinhos se a massa
        // guardada não for um valor sensato.
        const i = x + y * xdim;
        const stored = this.n0[i] + this.nN[i] + this.nS[i] + this.nE[i] + this.nW[i] +
            this.nNE[i] + this.nSE[i] + this.nNW[i] + this.nSW[i];
        const storedOk = isFinite(stored) && stored >= FluidSolver.MIN_SAFE_RHO && stored <= FluidSolver.MAX_SAFE_RHO;
        if (count > 0) {
            this.setEquilibrium(x, y, sumUx / count, sumUy / count, storedOk ? stored : sumRho / count);
        } else {
            this.setEquilibrium(x, y, 0, 0, storedOk ? stored : 1);
        }
    }

    /**
     * @private
     * @description Atualiza cada corpo giratório: calcula o torque exercido pelo fluido (mesma
     * fórmula de "momentum exchange" já usada para a força global em barreiras, somada só nas
     * células deste corpo), integra ângulo/velocidade angular (torque motor - amortecimento -
     * mola de retorno a `restingAngle`; rigidez 0 = turbina livre, >0 = palheta elástica), e
     * rerrasteriza a forma na nova posição, atualizando `rotorWallVx/Vy` (velocidade local da
     * "parede" de cada célula, usada pelo bounce-back de parede em movimento em `stream()` — é
     * isso que faz o Rotor realmente soprar/arrastar o fluido adjacente, não só receber torque
     * dele). Roda logo após `stream()` (bounce-back já aplicado, distribuições pós-choque
     * disponíveis) e antes de `setBoundaries()`.
     *
     * `massMultiplier`/`damping`/`stiffness` são lidos de CADA corpo (não mais parâmetros
     * globais) — cada Rotor tem seu próprio ajuste.
     */
    _updateRotatingBodies() {
        const xdim = this.xdim,
            ydim = this.ydim;
        const survivingBodies = [];
        for (let oldIndex = 0; oldIndex < this.rotatingBodies.length; oldIndex++) {
            const body = this.rotatingBodies[oldIndex];
            // Um corpo cujas células foram todas apagadas por fora (borracha, apagar seleção,
            // "Limpar") não deve continuar sendo simulado/rerrasterizado — do contrário ele
            // "reaparece" sozinho no próximo passo mesmo tendo sido apagado da tela.
            const stillExists = body.currentCells.some(({
                x,
                y
            }) => this.cellType[x + y * xdim] === FluidSolver.CELL_TYPE.ROTOR);
            if (!stillExists) continue;
            survivingBodies.push(body);

            // Torque já foi medido em `stream()` (usando `oldIndex`, a indexação de
            // `this.rotatingBodies` como estava ANTES deste filtro), a partir das distribuições
            // recém-refletidas — antes de injetar a correção de parede em movimento. Ver o
            // comentário em `stream()` sobre por que essa separação é obrigatória.
            const torque = this._rotorTorqueAccum[oldIndex] || 0;
            const dragCoeff = this._rotorDragAccum ? (this._rotorDragAccum[oldIndex] || 0) : 0;

            const effectiveInertia = Math.max(1e-6, body.massMultiplier * body.momentOfInertia);
            // Integração semi-implícita (bugs.md #52/#53). O torque de reação da parede em
            // movimento (-dragCoeff·omega, medido em `stream()`) é o que faltava para fechar o
            // balanço de momento: sem ele o Rotor injetava momento no fluido de graça, o fluido
            // devolvia esse mesmo momento como torque no passo seguinte, e o laço de
            // realimentação positiva levava a velocidade angular ao teto em poucos passos, com ou
            // sem fluxo (reproduzido: um empurrão de 1e-4 num fluido totalmente parado chegava ao
            // máximo em ~50 passos e travava lá).
            //
            // O termo é aplicado de forma IMPLÍCITA (omega do próximo passo no lado direito,
            // resolvido algebricamente) e não somado ao torque explicitamente. Motivo: para um
            // corpo leve, dragCoeff/effectiveInertia é da ordem de 2·rho/massMultiplier ≈ 2, e um
            // amortecimento explícito com fator maior que 1 por passo inverte o sinal de omega a
            // cada passo em vez de amortecer — exatamente a oscilação travada que tentativas
            // anteriores de mexer no sinal do torque produziram. Na forma implícita o denominador
            // é sempre ≥ 1, então omega só pode encolher: é incondicionalmente estável, para
            // qualquer massa e qualquer raio. `damping` (o slider do usuário) entra no mesmo
            // denominador pelo mesmo motivo.
            const alpha = FluidSolver.ROTOR_TORQUE_SMOOTHING;
            body.torqueFiltered = (body.torqueFiltered || 0) + alpha * (torque - (body.torqueFiltered || 0));
            // Duplo propósito neste limite: (1) geométrico — a forma só é rerrasterizada 1x por
            // passo, sem sub-stepping, então a ponta não pode saltar mais que uma fração de
            // célula; (2) estabilidade numérica — a velocidade de ponta (ω×raio) agora também
            // vira velocidade real injetada no fluido (parede em movimento), então precisa ficar
            // na mesma faixa de velocidade estável do resto da simulação (ordem de 0.1-0.2),
            // não perto de 1 como um limite puramente geométrico permitiria.
            const omegaMax = FluidSolver.ROTOR_MAX_TIP_SPEED / body.maxRadius;
            // Motor (bugs.md #54): controle de velocidade, torque proporcional ao erro. Entra
            // implicitamente pelos dois lados (o alvo no numerador, o ganho no denominador) pelo
            // mesmo motivo do arrasto — somado explicitamente, um ganho acima de 1 por passo
            // inverteria o sinal de omega a cada passo em vez de puxá-lo para o alvo.
            const motorGain = body.motorDirection ? FluidSolver.ROTOR_MOTOR_GAIN : 0;
            const motorOmega = body.motorDirection * (body.motorSpeed ?? 0.5) * omegaMax;
            const omegaTarget = body.omega
                + body.torqueFiltered / effectiveInertia
                - body.stiffness * (body.angle - body.restingAngle)
                + motorGain * motorOmega;
            body.omega = omegaTarget / (1 + body.damping + dragCoeff / effectiveInertia + motorGain);
            body.omega = Math.max(-omegaMax, Math.min(omegaMax, body.omega));
            body.angle += body.omega;

            const cosA = Math.cos(body.angle),
                sinA = Math.sin(body.angle);
            const newCells = [];
            const newKeys = new Set();
            for (const {
                dx,
                dy
            } of body.localCells) {
                const gx = Math.round(body.pivotX + dx * cosA - dy * sinA);
                const gy = Math.round(body.pivotY + dx * sinA + dy * cosA);
                if (gx < 0 || gx >= xdim || gy < 0 || gy >= ydim) continue;
                const key = gx + ',' + gy;
                if (newKeys.has(key)) continue;
                newKeys.add(key);
                newCells.push({
                    x: gx,
                    y: gy
                });
            }

            // Libera só as células que saíram E ainda pertencem a este corpo (ainda são ROTOR) —
            // nunca limpar cegamente: corpos podem se sobrepor, ou o usuário pode ter pintado
            // uma Barreira em cima entre passos.
            for (const {
                x,
                y
            } of body.currentCells) {
                if (newKeys.has(x + ',' + y)) continue;
                const i = x + y * xdim;
                if (this.cellType[i] !== FluidSolver.CELL_TYPE.ROTOR) continue;
                this.cellType[i] = FluidSolver.CELL_TYPE.NORMAL;
                this.rotorWallVx[i] = 0;
                this.rotorWallVy[i] = 0;
                this.rotorBodyIndex[i] = -1;
                this._refillCell(x, y);
            }

            const newBodyIndex = survivingBodies.length - 1;
            for (const {
                x,
                y
            } of newCells) {
                const i = x + y * xdim;
                this.cellType[i] = FluidSolver.CELL_TYPE.ROTOR;
                // Velocidade local da "parede" nesta célula: ω×r, r = célula - pivô.
                this.rotorWallVx[i] = -body.omega * (y - body.pivotY);
                this.rotorWallVy[i] = body.omega * (x - body.pivotX);
                this.rotorBodyIndex[i] = newBodyIndex;
            }

            body.currentCells = newCells;
        }
        this.rotatingBodies = survivingBodies;
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

    initFluid(u0) {
        for (let i = 0; i < this.xdim * this.ydim; i++) {
            this.setEquilibrium(i % this.xdim, Math.floor(i / this.xdim), u0, 0, 1);
        }
        if (this.rotatingBodies) {
            for (const body of this.rotatingBodies) {
                // Volta o rotor à posição de repouso: zera ângulo/velocidade e reconstrói
                // currentCells a partir de localCells no ângulo 0 — sem isso,
                // stampRotatingBodiesOntoGrid() estamparia as células na posição rotacionada
                // enquanto hasEverStepped=false faz o overlay vetorial desenhar a linha na
                // posição original, gerando duas linhas visíveis (bugs.md #42).
                body.angle = 0;
                body.omega = 0;
                body.torqueFiltered = 0;
                body.currentCells = body.localCells.map(({ dx, dy }) => ({
                    x: Math.round(body.pivotX + dx),
                    y: Math.round(body.pivotY + dy)
                }));
            }
        }
    }

    initTracers(enabled) {
        this.tracerX = new Float32Array(FluidSolver.N_TRACERS);
        this.tracerY = new Float32Array(FluidSolver.N_TRACERS);
        this.tracerStuck = new Uint16Array(FluidSolver.N_TRACERS);
        if (enabled) {
            const nRows = Math.ceil(Math.sqrt(FluidSolver.N_TRACERS));
            const dx = this.xdim / nRows,
                dy = this.ydim / nRows;
            let nX = dx / 2,
                nY = dy / 2;
            for (let t = 0; t < FluidSolver.N_TRACERS; t++) {
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
        for (let i = 0; i < FluidSolver.MAX_DYE_TRACERS; i++) {
            this.dyeTracers.push({
                x: -1,
                y: -1,
                stuck: 0
            });
        }
    }

    /**
     * @description Executa um passo de tempo completo: colisão, propagação, contornos e traçadores.
     * @param {{u0: number, viscosity: number, moveTracers: boolean}} params
     */
    step({
        u0,
        viscosity,
        moveTracers
    }) {
        this.collide(viscosity);
        this.stream();
        if (this.rotatingBodies.length > 0) {
            this._updateRotatingBodies();
        }
        this.setBoundaries(u0);
        this._applySourcesAndSinks();
        if (moveTracers) this.moveTracers();
        this.moveDyeTracers();
        this._emitNewDyeTracers();
        this._updateParticles();
    }

    /**
     * @description Define as condições de contorno do domínio de simulação.
     * - Modo 'channel': borda esquerda = entrada com velocidade constante, borda direita =
     *   saída com gradiente zero, bordas superior/inferior = paredes com deslizamento livre.
     * - Modo 'open': as 4 bordas viram saída com gradiente zero — sem entrada/parede fixa.
     *   Quem movimenta o fluido nesse modo são as células SOURCE pintadas pelo usuário.
     */
    setBoundaries(u0) {
        if (this.boundaryMode === 'open') {
            this._applyOpenBoundaries();
            return;
        }

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

        // Bordas superior e inferior (paredes com deslizamento livre): reflete apenas a
        // componente normal (y), preservando a direção tangencial (x) — uma reflexão espelhada,
        // não uma rotação de 180°. Trocar nNE<->nNW aqui reintroduz o bug antigo: rouba
        // quantidade de movimento em x bem na parede sempre que há fluxo net, gerando uma
        // perturbação espúria que nasce no canto onde a entrada encontra a parede.
        for (let x = 0; x < this.xdim; x++) {
            const i_top = x + (this.ydim - 1) * this.xdim;
            const i_bot = x;
            this.nS[i_top] = this.nN[i_top] || 0;
            this.nSE[i_top] = this.nNE[i_top] || 0;
            this.nSW[i_top] = this.nNW[i_top] || 0;

            this.nN[i_bot] = this.nS[i_bot] || 0;
            this.nNE[i_bot] = this.nSE[i_bot] || 0;
            this.nNW[i_bot] = this.nSW[i_bot] || 0;
        }
    }

    /**
     * @private
     * @description Modo 'open': copia as distribuições do vizinho interno em todas as 4
     * bordas (gradiente zero / saída livre), sem impor nenhuma velocidade de entrada.
     */
    _applyOpenBoundaries() {
        const copyCell = (i, iFrom) => {
            this.n0[i] = this.n0[iFrom] || 0;
            this.nN[i] = this.nN[iFrom] || 0;
            this.nS[i] = this.nS[iFrom] || 0;
            this.nE[i] = this.nE[iFrom] || 0;
            this.nW[i] = this.nW[iFrom] || 0;
            this.nNE[i] = this.nNE[iFrom] || 0;
            this.nSE[i] = this.nSE[iFrom] || 0;
            this.nNW[i] = this.nNW[iFrom] || 0;
            this.nSW[i] = this.nSW[iFrom] || 0;
        };

        for (let y = 0; y < this.ydim; y++) {
            copyCell(y * this.xdim, 1 + y * this.xdim);
            copyCell(this.xdim - 1 + y * this.xdim, this.xdim - 2 + y * this.xdim);
        }
        for (let x = 0; x < this.xdim; x++) {
            copyCell(x, x + this.xdim);
            copyCell(x + (this.ydim - 1) * this.xdim, x + (this.ydim - 2) * this.xdim);
        }
    }

    /**
     * @private
     * @description Impõe a velocidade das células SOURCE (entradas pintadas) e drena massa nas
     * células SINK (saídas), fazendo delas um ralo de verdade.
     *
     * O dreno escala as 9 distribuições da célula pelo MESMO fator `1 - α`. Como a velocidade
     * macroscópica é `u = Σf·c / ρ`, com a densidade no denominador, escalar tudo junto derruba
     * ρ e deixa `u` exatamente onde estava: por construção nenhuma direção é privilegiada, então
     * não há reflexão e não há "efeito barreira". Quem puxa o fluido vizinho é o gradiente de
     * pressão que a queda de ρ cria — o mecanismo físico de um ralo.
     *
     * Isto substitui a Saída puramente visual do item #44 do bugs.md, que era transparente à
     * física (idêntica a uma célula NORMAL, medido). A conclusão de lá — de que qualquer remoção
     * de massa causa "efeito barreira" ou "efeito aspirador" — valia para as tentativas daquela
     * época, que mexiam na VELOCIDADE ou fixavam uma densidade-alvo; não vale para o escalamento
     * uniforme usado aqui. Ver SINK_RHO_FLOOR para a defesa contra o caso do recinto selado, que
     * era a metade legítima daquela objeção.
     */
    _applySourcesAndSinks() {
        const floor = FluidSolver.SINK_RHO_FLOOR;
        for (let i = 0; i < this.xdim * this.ydim; i++) {
            const type = this.cellType[i];
            if (type === FluidSolver.CELL_TYPE.SOURCE) {
                const x = i % this.xdim,
                    y = Math.floor(i / this.xdim);
                this.setEquilibrium(x, y, this.sourceVx[i], this.sourceVy[i], 1);
            } else if (type === FluidSolver.CELL_TYPE.SINK) {
                const alpha = this.sinkStrength[i];
                if (alpha <= 0) continue;
                // Densidade recalculada aqui, não lida de `this.rho`: aquele array é preenchido
                // em collide(), antes do stream() do mesmo passo, então já está defasado quando
                // chegamos aqui — e é justamente na célula do ralo que ele muda mais rápido.
                const rhoNow = this.n0[i] + this.nN[i] + this.nS[i] + this.nE[i] + this.nW[i] +
                    this.nNE[i] + this.nSE[i] + this.nNW[i] + this.nSW[i];
                // Rampa do piso: em ρ ≥ 1 drena a taxa cheia, em ρ ≤ floor não drena nada.
                const ramp = (rhoNow - floor) / (1 - floor);
                if (ramp <= 0) continue;
                const keep = 1 - alpha * (ramp < 1 ? ramp : 1);
                this.n0[i] *= keep;
                this.nN[i] *= keep;
                this.nS[i] *= keep;
                this.nE[i] *= keep;
                this.nW[i] *= keep;
                this.nNE[i] *= keep;
                this.nSE[i] *= keep;
                this.nNW[i] *= keep;
                this.nSW[i] *= keep;
            }
        }
    }

    /**
     * @private
     * @description Diz se o ponto contínuo (x, y) cai numa célula sólida. Um ponto fora do
     * domínio NÃO é sólido — quem chama trata a saída do domínio com a sua própria regra
     * (reciclar, dar a volta, etc.), que é diferente de esbarrar num obstáculo.
     */
    _isSolidAtPoint(x, y) {
        const rx = Math.floor(x),
            ry = Math.floor(y);
        if (rx < 0 || rx >= this.xdim || ry < 0 || ry >= this.ydim) return false;
        const t = this.cellType[rx + ry * this.xdim];
        return t === FluidSolver.CELL_TYPE.BARRIER || t === FluidSolver.CELL_TYPE.ROTOR;
    }

    /**
     * @private
     * @description Uma célula é "aberta" (fluido, entrada, saída, fumaça) quando não bloqueia a
     * troca de momento com o entorno — usado pelo bounce-back de parede em movimento do Rotor
     * para só injetar/cobrar reação nas direções que dão em fluido de verdade.
     */
    _isOpenCell(index) {
        const t = this.cellType[index];
        return t !== FluidSolver.CELL_TYPE.BARRIER && t !== FluidSolver.CELL_TYPE.ROTOR;
    }

    /**
     * @description Executa o passo de colisão do algoritmo LBM.
     * 1. Calcula as propriedades macroscópicas (densidade, velocidade).
     * 2. Calcula as distribuições de equilíbrio com base nessas propriedades.
     * 3. Relaxa as distribuições atuais em direção ao equilíbrio.
     */
    collide(viscosity) {
        const omega = Math.max(0.01, Math.min(1.99, 1.0 / (3.0 * viscosity + 0.5))); // Parâmetro de relaxação
        let clampedCells = 0;

        // Referências locais aos arrays: evita reler `this.propriedade` a cada célula no loop
        // quente (uma leitura de propriedade a mais por acesso, 9 arrays, centenas de milhares
        // de células por passo). Comportamento idêntico, só implementação mais rápida.
        const n0 = this.n0, nN = this.nN, nS = this.nS, nE = this.nE, nW = this.nW,
            nNE = this.nNE, nSE = this.nSE, nNW = this.nNW, nSW = this.nSW;
        const rho = this.rho, ux = this.ux, uy = this.uy, cellType = this.cellType;
        const FOUR_NINTHS = this.FOUR_NINTHS, ONE_NINTH = this.ONE_NINTH, ONE_THIRTY_SIXTH = this.ONE_THIRTY_SIXTH;

        for (let i = 0; i < this.xdim * this.ydim; i++) {
            // 1. Calcula densidade e velocidades macroscópicas
            const thisrho = n0[i] + nN[i] + nS[i] + nE[i] + nW[i] + nNW[i] + nNE[i] + nSW[i] + nSE[i];

            if (thisrho <= 0) { // Checagem de estabilidade
                rho[i] = 1;
                ux[i] = 0;
                uy[i] = 0;
                continue;
            }
            // Limitador de segurança (bugs.md #51): grampeia densidade e velocidade numa faixa
            // fisicamente sensata ANTES de montar o equilíbrio/relaxar — barra o pico numérico
            // aqui, célula a célula, em vez de deixar ele se espalhar pro streaming seguinte e só
            // detectar o estrago depois (checkStability(), que continua existindo como rede de
            // segurança final). Uso normal do solver fica bem abaixo dos dois tetos (ver
            // comentário nas constantes), então isso não muda nada na simulação em operação
            // normal — só age nas células que já estariam saindo da faixa físicamente sensata.
            const thisrhoClamped = Math.min(FluidSolver.MAX_SAFE_RHO, Math.max(FluidSolver.MIN_SAFE_RHO, thisrho));
            if (thisrhoClamped !== thisrho) clampedCells++;
            rho[i] = thisrhoClamped;

            // Divide pela densidade JÁ grampeada, não pela bruta: numa célula em que `thisrho`
            // caiu para perto de zero, dividir pelo valor bruto devolve uma velocidade
            // gigantesca (o grampo de velocidade logo abaixo só corta a direção do vetor depois,
            // já com a magnitude estourada) e, pior, deixa velocidade e densidade descrevendo
            // estados incompatíveis — o momento resultante deixaria de bater com o `rho[i]`
            // exposto ao resto do app.
            const thisux = (nE[i] + nNE[i] + nSE[i] - nW[i] - nNW[i] - nSW[i]) / thisrhoClamped;
            const thisuy = (nN[i] + nNE[i] + nNW[i] - nS[i] - nSE[i] - nSW[i]) / thisrhoClamped;
            let cux = isFinite(thisux) ? thisux : 0;
            let cuy = isFinite(thisuy) ? thisuy : 0;
            const speed = Math.hypot(cux, cuy);
            if (speed > FluidSolver.MAX_SAFE_SPEED) {
                const scale = FluidSolver.MAX_SAFE_SPEED / speed;
                cux *= scale;
                cuy *= scale;
                // Conta uma vez por célula: se a densidade dela já foi grampeada acima, não soma
                // de novo — a fração comparada com MAX_CLAMPED_FRACTION é de CÉLULAS afetadas,
                // não de grampeamentos aplicados.
                if (thisrhoClamped === thisrho) clampedCells++;
            }
            // Resistência da Grade (bugs.md #32): freia a velocidade macroscópica ANTES dela
            // virar equilíbrio/realimentar o streaming seguinte — ver `MESH_RESISTANCE_KEEP`.
            // MESH nunca entra no bounce-back de `stream()` (fica de fora do branch
            // BARRIER/ROTOR de propósito), então sem isto ela seria uma célula NORMAL comum;
            // isto é o que a torna "com mais resistência" em vez de transparente de verdade.
            if (cellType[i] === FluidSolver.CELL_TYPE.MESH) {
                cux *= FluidSolver.MESH_RESISTANCE_KEEP;
                cuy *= FluidSolver.MESH_RESISTANCE_KEEP;
            }
            ux[i] = cux;
            uy[i] = cuy;

            // Células sólidas (Barreira/Rotor) NÃO colidem. O bounce-back de `stream()` deixa nelas
            // as populações já refletidas; relaxá-las para o equilíbrio aqui as misturava com
            // direções que apontam para FORA da parede, e esse excedente atravessava paredes de
            // 1 célula: numa caixa fechada com a viscosidade padrão (0,02) a massa caía ~2,5% a
            // cada 1000 passos e as próprias paredes ficavam com densidade anômala. `rho`/`ux`/
            // `uy` acima continuam preenchidos, porque o Rotor lê a densidade da própria célula.
            if (cellType[i] === FluidSolver.CELL_TYPE.BARRIER || cellType[i] === FluidSolver.CELL_TYPE.ROTOR) continue;

            // 2. Calcula as distribuições de equilíbrio (f_eq), a partir da densidade JÁ
            // grampeada — sem isso o equilíbrio calculado embaixo poderia continuar explodindo
            // mesmo com rho[i]/ux[i]/uy[i] (os valores expostos/lidos pelo resto do app) já
            // grampeados, porque a relaxação usaria o thisrho bruto de qualquer forma.
            const one9thrho = ONE_NINTH * thisrhoClamped;
            const one36thrho = ONE_THIRTY_SIXTH * thisrhoClamped;
            const ux3 = 3 * cux;
            const uy3 = 3 * cuy;
            const ux2 = cux * cux;
            const uy2 = cuy * cuy;
            const uxuy2 = 2 * cux * cuy;
            const u2 = ux2 + uy2;
            const u215 = 1.5 * u2;

            const eq0 = FOUR_NINTHS * thisrhoClamped * (1 - u215);
            const eqE = one9thrho * (1 + ux3 + 4.5 * ux2 - u215);
            const eqW = one9thrho * (1 - ux3 + 4.5 * ux2 - u215);
            const eqN = one9thrho * (1 + uy3 + 4.5 * uy2 - u215);
            const eqS = one9thrho * (1 - uy3 + 4.5 * uy2 - u215);
            const eqNE = one36thrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
            const eqSE = one36thrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
            const eqNW = one36thrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
            const eqSW = one36thrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);

            // 3. Relaxa as distribuições (colisão)
            n0[i] += omega * (eq0 - n0[i]);
            nE[i] += omega * (eqE - nE[i]);
            nW[i] += omega * (eqW - nW[i]);
            nN[i] += omega * (eqN - nN[i]);
            nS[i] += omega * (eqS - nS[i]);
            nNE[i] += omega * (eqNE - nNE[i]);
            nSE[i] += omega * (eqSE - nSE[i]);
            nNW[i] += omega * (eqNW - nNW[i]);
            nSW[i] += omega * (eqSW - nSW[i]);
        }
        // Fotografia do último passo — lida por `checkStability()`.
        this._clampedCellCount = clampedCells;
    }

    /**
     * @description Executa o passo de propagação (streaming) do algoritmo LBM.
     * As distribuições de partículas movem-se para as células vizinhas.
     * A condição de contorno de obstáculo (bounce-back) é aplicada aqui.
     */
    stream() {
        // Propaga as distribuições para células vizinhas usando arrays temporários. Índices
        // vizinhos com wraparound (mesmo resultado de `% xdim`/`% ydim`, só que com uma
        // comparação em vez de uma divisão — bem mais barato, e é chamado por célula, 8 vezes,
        // a cada passo). setBoundaries() sobrescreve as bordas logo em seguida de qualquer forma.
        const xdim = this.xdim, ydim = this.ydim;
        const n0 = this.n0, nN = this.nN, nS = this.nS, nE = this.nE, nW = this.nW,
            nNE = this.nNE, nSE = this.nSE, nNW = this.nNW, nSW = this.nSW;
        const t0 = this.temp_n0, tN = this.temp_nN, tS = this.temp_nS, tE = this.temp_nE, tW = this.temp_nW,
            tNE = this.temp_nNE, tSE = this.temp_nSE, tNW = this.temp_nNW, tSW = this.temp_nSW;

        for (let y = 0; y < ydim; y++) {
            const yUp = (y + 1 < ydim) ? y + 1 : 0;
            const yDn = (y > 0) ? y - 1 : ydim - 1;
            const rowBase = y * xdim, rowUpBase = yUp * xdim, rowDnBase = yDn * xdim;
            for (let x = 0; x < xdim; x++) {
                const i = rowBase + x;
                const xR = (x + 1 < xdim) ? x + 1 : 0;
                const xL = (x > 0) ? x - 1 : xdim - 1;
                t0[i] = n0[i];
                tE[rowBase + xR] = nE[i];
                tW[rowBase + xL] = nW[i];
                tN[rowUpBase + x] = nN[i];
                tS[rowDnBase + x] = nS[i];
                tNE[rowUpBase + xR] = nNE[i];
                tSE[rowDnBase + xR] = nSE[i];
                tNW[rowUpBase + xL] = nNW[i];
                tSW[rowDnBase + xL] = nSW[i];
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
        const torqueAccum = new Float64Array(this.rotatingBodies.length);
        // Coeficiente de arrasto rotacional (bugs.md #52/#53): a correção de parede em movimento
        // aplicada logo abaixo INJETA momento no fluido (é o que faz o Rotor soprar), e essa
        // injeção tem um custo de reação no próprio corpo que precisa ser cobrado — do contrário
        // o Rotor cria momento do nada e acelera sozinho. Somando o termo de parede móvel sobre
        // as 9 direções, essa reação vale exatamente -2·rho·u_parede por célula, o que em torque
        // dá -2·rho·r²·omega — ou seja, um arrasto LINEAR em omega. Como o coeficiente
        // (2·rho·r²) não depende de omega, ele é acumulado aqui e aplicado de forma implícita em
        // `_updateRotatingBodies()`, o que mantém o esquema estável para qualquer massa.
        const dragAccum = new Float64Array(this.rotatingBodies.length);
        // Massa líquida criada, por corpo, pela correção de parede em movimento neste passo (ver
        // `_removeInjectedMass`).
        const massInjected = new Float64Array(this.rotatingBodies.length);

        for (let i = 0; i < this.xdim * this.ydim; i++) {
            const type = this.cellType[i];
            // ROTOR sofre o mesmo bounce-back que BARRIER (sólido no instante atual), mas não
            // entra no acúmulo global de força/posição — esse acumulador alimenta a seta
            // "Força" existente, que representa obstáculos estáticos; o torque de um corpo
            // giratório é acumulado à parte, por corpo (ver `torqueAccum` abaixo).
            if (type === FluidSolver.CELL_TYPE.BARRIER || type === FluidSolver.CELL_TYPE.ROTOR) {
                // Inverte as direções das distribuições que chegaram ao obstáculo
                [this.nE[i], this.nW[i]] = [this.nW[i], this.nE[i]];
                [this.nN[i], this.nS[i]] = [this.nS[i], this.nN[i]];
                [this.nNE[i], this.nSW[i]] = [this.nSW[i], this.nNE[i]];
                [this.nNW[i], this.nSE[i]] = [this.nSE[i], this.nNW[i]];

                if (type === FluidSolver.CELL_TYPE.BARRIER) {
                    const x = i % this.xdim,
                        y = Math.floor(i / this.xdim);
                    // Calcula a força total exercida pelo fluido sobre as barreiras estáticas
                    this.barrierCount++;
                    this.barrierxSum += x;
                    this.barrierySum += y;
                    // Força do fluido SOBRE a barreira (a seta "Força"). As populações aqui já foram
                    // refletidas, então o momento que chegou à parede é o OPOSTO do somatório
                    // abaixo — daí o sinal negativo, o mesmo usado para o torque do Rotor. Com o
                    // sinal positivo a seta de arrasto apontava CONTRA o vento.
                    this.barrierFx -= 2 * (this.nE[i] + this.nNE[i] + this.nSE[i] - this.nW[i] - this.nNW[i] - this.nSW[i]);
                    this.barrierFy -= 2 * (this.nN[i] + this.nNE[i] + this.nNW[i] - this.nS[i] - this.nSE[i] - this.nSW[i]);
                } else {
                    // ROTOR: mede o torque a partir das distribuições recém-refletidas, ANTES de
                    // injetar a correção de parede em movimento logo abaixo. A troca de momento
                    // com a parede tem dois termos e cada um é tratado no seu lugar: o termo do
                    // bounce-back (este aqui, o torque que o fluido exerce sobre a pá) é medido
                    // agora, sem contaminação da injeção; o termo da própria injeção é linear em
                    // omega e vai para `dragAccum`, aplicado implicitamente em
                    // `_updateRotatingBodies()`. Medir os dois juntos aqui, com o mesmo fator 2 do
                    // bounce-back, conta a injeção em dobro e trava o corpo oscilando de sinal a
                    // cada passo (testado e confirmado).
                    const bodyIndex = this.rotorBodyIndex[i];
                    if (bodyIndex >= 0) {
                        const body = this.rotatingBodies[bodyIndex];
                        const x = i % this.xdim,
                            y = Math.floor(i / this.xdim);
                        const fx = -2 * (this.nE[i] + this.nNE[i] + this.nSE[i] - this.nW[i] - this.nNW[i] - this.nSW[i]);
                        const fy = -2 * (this.nN[i] + this.nNE[i] + this.nNW[i] - this.nS[i] - this.nSE[i] - this.nSW[i]);
                        torqueAccum[bodyIndex] += (x - body.pivotX) * fy - (y - body.pivotY) * fx;
                        // Reação da correção de parede em movimento, aplicada logo abaixo.
                        // Percorre as 8 direções uma a uma, e só age nas que apontam para uma
                        // célula NÃO sólida: injetar momento numa direção bloqueada por outra
                        // célula do próprio corpo (ou por uma barreira encostada) não empurra
                        // fluido nenhum — a população fica presa dentro do sólido — mas cobraria
                        // do corpo o torque de reação correspondente, um freio artificial que
                        // chegava a dominar o giro de pás finas (onde as direções ao longo da
                        // própria pá são justamente as bloqueadas).
                        //
                        // Por direção d, a correção vale 6·w_d·rho·(e_d·u_parede) e a reação no
                        // corpo é o seu negativo. Com u_parede = omega × r, isso dá um torque
                        // -6·rho·omega·w_d·k_d², com k_d = (r × e_d)_z o braço da direção — linear
                        // em omega, então só o coeficiente é acumulado aqui (ver `dragAccum`) e o
                        // omega entra implicitamente em `_updateRotatingBodies()`. Somado sobre
                        // as 9 direções isso reproduz exatamente o -2·rho·r² do caso totalmente
                        // cercado de fluido, que serviu de conferência da derivação.
                        const dx = x - body.pivotX,
                            dy = y - body.pivotY;
                        const cellRho = this.rho[i];
                        const wallVx = this.rotorWallVx[i];
                        const wallVy = this.rotorWallVy[i];
                        const xR = (x + 1 < xdim) ? x + 1 : 0;
                        const xL = (x > 0) ? x - 1 : xdim - 1;
                        const rowUp = ((y + 1 < ydim) ? y + 1 : 0) * xdim;
                        const rowDn = ((y > 0) ? y - 1 : ydim - 1) * xdim;
                        const row = y * xdim;
                        // Desenrolado à mão (sem array de direções nem closure) porque isto roda
                        // por célula de Rotor, a cada passo, dentro do laço quente do solver.
                        const W9 = 6 * cellRho * this.ONE_NINTH;
                        const W36 = 6 * cellRho * this.ONE_THIRTY_SIXTH;
                        let drag = 0;
                        // e = (+1, 0): k = -dy
                        if (this._isOpenCell(row + xR)) {
                            drag += W9 * dy * dy;
                            this.nE[i] += W9 * wallVx;
                            massInjected[bodyIndex] += W9 * wallVx;
                        }
                        // e = (-1, 0): k = +dy
                        if (this._isOpenCell(row + xL)) {
                            drag += W9 * dy * dy;
                            this.nW[i] -= W9 * wallVx;
                            massInjected[bodyIndex] -= W9 * wallVx;
                        }
                        // e = (0, +1): k = +dx
                        if (this._isOpenCell(rowUp + x)) {
                            drag += W9 * dx * dx;
                            this.nN[i] += W9 * wallVy;
                            massInjected[bodyIndex] += W9 * wallVy;
                        }
                        // e = (0, -1): k = -dx
                        if (this._isOpenCell(rowDn + x)) {
                            drag += W9 * dx * dx;
                            this.nS[i] -= W9 * wallVy;
                            massInjected[bodyIndex] -= W9 * wallVy;
                        }
                        // e = (+1, +1): k = dx - dy
                        if (this._isOpenCell(rowUp + xR)) {
                            const k = dx - dy;
                            drag += W36 * k * k;
                            this.nNE[i] += W36 * (wallVx + wallVy);
                            massInjected[bodyIndex] += W36 * (wallVx + wallVy);
                        }
                        // e = (-1, -1): k = dy - dx
                        if (this._isOpenCell(rowDn + xL)) {
                            const k = dx - dy;
                            drag += W36 * k * k;
                            this.nSW[i] -= W36 * (wallVx + wallVy);
                            massInjected[bodyIndex] -= W36 * (wallVx + wallVy);
                        }
                        // e = (-1, +1): k = dx + dy
                        if (this._isOpenCell(rowUp + xL)) {
                            const k = dx + dy;
                            drag += W36 * k * k;
                            this.nNW[i] += W36 * (-wallVx + wallVy);
                            massInjected[bodyIndex] += W36 * (-wallVx + wallVy);
                        }
                        // e = (+1, -1): k = -(dx + dy)
                        if (this._isOpenCell(rowDn + xR)) {
                            const k = dx + dy;
                            drag += W36 * k * k;
                            this.nSE[i] -= W36 * (-wallVx + wallVy);
                            massInjected[bodyIndex] -= W36 * (-wallVx + wallVy);
                        }
                        dragAccum[bodyIndex] += drag;
                    }
                }
            }
        }
        this._rotorTorqueAccum = torqueAccum;
        this._rotorDragAccum = dragAccum;
        for (let b = 0; b < massInjected.length; b++) {
            if (massInjected[b] !== 0) this._removeInjectedMass(b, massInjected[b]);
        }
    }

    /**
     * @private
     * @description A correção de parede em movimento soma `+w` numa direção e `-w` na oposta, mas
     * só nas direções que apontam para células abertas; onde só um lado está aberto sobra massa
     * líquida (medido numa caixa fechada com o motor ligado: ~+1,3% de massa por 1000 passos).
     * Em vez de mexer no sopro do rotor, já calibrado, devolve-se aqui exatamente a massa criada,
     * repartida entre as células de fluido PERTO do próprio corpo (raio da pá + 3), onde ela
     * nasceu. Repartir pelo domínio inteiro não serve: perturbava a região em repouso longe do
     * rotor, e o anel entre uma caixa e a borda aberta entrava em instabilidade numérica.
     * Entrada e saída de massa pelas bordas e pelas Saídas ficam intactas.
     */
    _removeInjectedMass(bodyIndex, mass) {
        const body = this.rotatingBodies[bodyIndex];
        if (!body) return;
        const xdim = this.xdim, ydim = this.ydim, cellType = this.cellType, n0 = this.n0;
        const NORMAL = FluidSolver.CELL_TYPE.NORMAL;
        const reach = Math.ceil(body.maxRadius) + 3;
        const xa = Math.max(0, Math.floor(body.pivotX - reach)), xb = Math.min(xdim - 1, Math.ceil(body.pivotX + reach));
        const ya = Math.max(0, Math.floor(body.pivotY - reach)), yb = Math.min(ydim - 1, Math.ceil(body.pivotY + reach));
        const r2 = reach * reach;
        let count = 0;
        for (let y = ya; y <= yb; y++) {
            for (let x = xa; x <= xb; x++) {
                if (cellType[x + y * xdim] !== NORMAL) continue;
                const dx = x - body.pivotX, dy = y - body.pivotY;
                if (dx * dx + dy * dy <= r2) count++;
            }
        }
        if (count === 0) return;
        const per = mass / count;
        for (let y = ya; y <= yb; y++) {
            for (let x = xa; x <= xb; x++) {
                if (cellType[x + y * xdim] !== NORMAL) continue;
                const dx = x - body.pivotX, dy = y - body.pivotY;
                if (dx * dx + dy * dy <= r2) n0[x + y * xdim] -= per;
            }
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

    checkStability() {
        // Grade tomada pelo limitador de segurança: os valores continuam dentro da faixa
        // "sensata" célula a célula (é o que o limitador faz), mas o resultado já não descreve
        // escoamento nenhum. Sem esta checagem o detector fica cego para tudo que não seja NaN,
        // já que ele lê exatamente os arrays que o limitador grampeia (ver MAX_CLAMPED_FRACTION).
        const clamped = this._clampedCellCount || 0;
        if (clamped > FluidSolver.MAX_CLAMPED_FRACTION * this.rho.length) {
            console.warn('Instabilidade: limitador de segurança ativo em', clamped, 'de', this.rho.length, 'células');
            return false;
        }
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

    /**
     * @description Move os traçadores de fluxo pelo campo de velocidade interpolado. Só a
     * Saída "absorve" de verdade (recicla o traçador de volta pra entrada) — é um dreno, faz
     * sentido sumir ali. Barreira e Rotor são sólidos: o traçador não entra na célula, mas
     * DESLIZA ao longo dela (ver `_slideAlongSolid`) em vez de ficar congelado no lugar.
     */
    moveTracers() {
        if (!this.tracerX) return;
        for (let t = 0; t < FluidSolver.N_TRACERS; t++) {
            const ux_interp = this._bilinearInterpolate(this.tracerX[t], this.tracerY[t], this.ux);
            const uy_interp = this._bilinearInterpolate(this.tracerX[t], this.tracerY[t], this.uy);
            if (!isFinite(ux_interp) || !isFinite(uy_interp)) continue;
            const newX = this.tracerX[t] + ux_interp;
            const newY = this.tracerY[t] + uy_interp;
            const rx = Math.floor(newX);
            const ry = Math.floor(newY);
            const cellAtNew = (rx >= 0 && rx < this.xdim && ry >= 0 && ry < this.ydim) ? this.cellType[rx + ry * this.xdim] : -1;

            if (newX > this.xdim - 1 || cellAtNew === FluidSolver.CELL_TYPE.SINK) {
                this.tracerX[t] = 0;
                this.tracerY[t] = Math.random() * this.ydim;
                continue;
            }
            if (cellAtNew === FluidSolver.CELL_TYPE.BARRIER || cellAtNew === FluidSolver.CELL_TYPE.ROTOR) {
                const slid = this._slideAlongSolid(this.tracerX[t], this.tracerY[t], newX, newY);
                if (slid) {
                    this.tracerX[t] = slid.x;
                    this.tracerY[t] = slid.y;
                    this.tracerStuck[t] = 0;
                } else if (++this.tracerStuck[t] > FluidSolver.TRACER_MAX_STUCK_STEPS) {
                    // Canto fechado dos dois lados ou estagnação: recicla na entrada, mesma
                    // regra já usada pela Saída logo acima.
                    this.tracerX[t] = 0;
                    this.tracerY[t] = Math.random() * this.ydim;
                    this.tracerStuck[t] = 0;
                }
                continue;
            }
            this.tracerStuck[t] = 0;
            this.tracerX[t] = newX;
            this.tracerY[t] = newY;
        }
    }

    /**
     * @private
     * @description Resolve um passo de traçador que terminaria dentro de um sólido, deslizando
     * ao longo da parede em vez de travar: tenta o deslocamento só na horizontal e, se também
     * estiver bloqueado, só na vertical. Devolve `null` quando as duas direções estão bloqueadas
     * (canto interno), aí quem chama decide o que fazer.
     *
     * Isto é o item #25 do bugs.md. Antes, um destino dentro do sólido simplesmente abortava o
     * passo daquele traçador — e onde o campo de velocidade aponta para dentro da parede de
     * forma persistente (o que é a regra, não a exceção, em toda a face de barlavento de uma
     * barreira e em cada degrau de uma diagonal), ele nunca mais saía dali. Medido no cenário do
     * relato (barreira diagonal + fumaça a montante, 12 mil passos): 1906 dos 4000 traçadores
     * ficavam imóveis por mais de 500 passos seguidos, todos grudados na linha — quase metade do
     * pool morto, exatamente o acúmulo que aparecia com o passar do tempo.
     */
    _slideAlongSolid(oldX, oldY, newX, newY) {
        if (!this._isSolidAtPoint(newX, oldY) && newX >= 0 && newX < this.xdim) {
            return { x: newX, y: oldY };
        }
        if (!this._isSolidAtPoint(oldX, newY) && newY >= 0 && newY < this.ydim) {
            return { x: oldX, y: newY };
        }
        return null;
    }

    _emitNewDyeTracers() {
        const activeSources = this.dyeSources.filter(source => {
            const ix = Math.floor(source.x),
                iy = Math.floor(source.y);
            const t = ix >= 0 && ix < this.xdim && iy >= 0 && iy < this.ydim ? this.cellType[ix + iy * this.xdim] : FluidSolver.CELL_TYPE.BARRIER;
            return t !== FluidSolver.CELL_TYPE.BARRIER && t !== FluidSolver.CELL_TYPE.ROTOR;
        });
        if (activeSources.length === 0) return;
        const activeTracers = this.dyeTracers.filter(t => t.x >= 0).length;
        const availableSlots = FluidSolver.MAX_DYE_TRACERS - activeTracers;
        if (availableSlots <= 0) return;
        const particlesToEmit = Math.min(FluidSolver.PARTICLES_PER_FRAME_EMISSION, availableSlots);
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
            const t = ix >= 0 && ix < this.xdim && iy >= 0 && iy < this.ydim ? this.cellType[ix + iy * this.xdim] : FluidSolver.CELL_TYPE.BARRIER;
            return t !== FluidSolver.CELL_TYPE.BARRIER && t !== FluidSolver.CELL_TYPE.ROTOR;
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

    /**
     * @description Move os traçadores de fumaça pelo campo de velocidade interpolado. Mesma
     * regra de `moveTracers()`: só a Saída recicla de verdade (dreno); Barreira e Rotor não
     * deixam a partícula entrar na célula sólida, mas ela desliza ao longo da parede
     * (`_slideAlongSolid`) em vez de ficar parada ali para sempre (bugs.md #25).
     */
    moveDyeTracers() {
        for (const tracer of this.dyeTracers) {
            if (tracer.x < 0) continue;
            const ux_interp = this._bilinearInterpolate(tracer.x, tracer.y, this.ux);
            const uy_interp = this._bilinearInterpolate(tracer.x, tracer.y, this.uy);
            if (!isFinite(ux_interp) || !isFinite(uy_interp)) {
                this._recycleDyeTracer(tracer);
                continue;
            }
            const newX = tracer.x + ux_interp;
            const newY = tracer.y + uy_interp;
            const rx = Math.floor(newX);
            const ry = Math.floor(newY);
            if (rx < 0 || rx >= this.xdim || ry < 0 || ry >= this.ydim) {
                this._recycleDyeTracer(tracer);
                continue;
            }
            const cellType = this.cellType[rx + ry * this.xdim];
            if (cellType === FluidSolver.CELL_TYPE.SINK) {
                this._recycleDyeTracer(tracer);
                continue;
            }
            if (cellType === FluidSolver.CELL_TYPE.BARRIER || cellType === FluidSolver.CELL_TYPE.ROTOR) {
                const slid = this._slideAlongSolid(tracer.x, tracer.y, newX, newY);
                if (slid) {
                    tracer.x = slid.x;
                    tracer.y = slid.y;
                    tracer.stuck = 0;
                } else if ((tracer.stuck = (tracer.stuck || 0) + 1) > FluidSolver.TRACER_MAX_STUCK_STEPS) {
                    tracer.stuck = 0;
                    this._recycleDyeTracer(tracer);
                }
                continue;
            }
            tracer.stuck = 0;
            tracer.x = newX;
            tracer.y = newY;
        }
    }

    /**
     * @description Coloca UM objeto avulso no pool de partículas físicas (bugs.md #32) — sem
     * fonte contínua: o usuário pediu explicitamente "clique = um objeto", não um ponto que fica
     * emitindo pra sempre (como a Fumaça). Reaproveita o primeiro slot inativo do pool fixo;
     * devolve `false` sem fazer nada se o pool já estiver cheio (`MAX_PARTICLES`).
     */
    addParticle(x, y, weight, shapeType) {
        const p = this.particles.find(p => p.x < 0);
        if (!p) return false;
        const phys = FluidSolver.particlePhysicsFromWeight(weight);
        p.x = x;
        p.y = y;
        p.vx = 0;
        p.vy = 0;
        p.weight = weight;
        p.radius = phys.radius;
        p.shapeType = shapeType || 'ball';
        return true;
    }

    /**
     * @private
     * @description Remove a partícula de vez do pool (some da cena) — usado quando ela sai do
     * domínio pela borda aberta ou toca uma Saída. Sem fonte pra reciclar de volta (ver
     * `addParticle`), sair da cena agora é definitivo, igual a um objeto real que voou pra longe.
     */
    _deactivateParticle(p) {
        p.x = -1;
        p.y = -1;
    }

    /**
     * @private
     * @description Um sólido, do ponto de vista de uma partícula física, no ponto contínuo
     * (x, y) — diferente de `_isSolidAtPoint` (usado pelo Rotor) em dois pontos: (1) as BORDAS
     * do domínio contam como sólido nos três lados que não são a saída (esquerda/topo/baixo —
     * ver bugs.md #32, uma partícula sob gravidade precisa de um "chão" pra assentar, e uma
     * parede esquerda pra não escapar por trás da Entrada); a direita fica de fora de propósito,
     * é a saída natural, tratada à parte em `_updateParticles` (recicla, como um traçador). (2)
     * uma célula MESH só bloqueia se a partícula for grande demais pro furo daquela célula —
     * pequena o bastante, ela atravessa como se a célula fosse líquida.
     */
    _isSolidForParticle(x, y, radius) {
        // Testa o CORPO da partícula (todas as células que o disco de raio `radius` toca), não
        // só o ponto do centro. Um teste de centro deixava uma Bolinha/Caixa (diâmetro até 1,1
        // célula) passar RENTE a uma Grade fina — desenhada com a ferramenta Linha, a Grade
        // ocupa só 1 célula na física (Bresenham, ver bugs.md #42), então bastava o centro
        // passar pela célula vizinha pra ela atravessar de corpo inteiro sem nunca "colidir".
        // Era isso que fazia bolinhas atravessarem a Grade mesmo com o furo bem menor que elas.
        const minX = x - radius,
            maxX = x + radius,
            minY = y - radius,
            maxY = y + radius;
        if (minX < 0 || minY < 0 || maxY >= this.ydim) return true;
        if (minX >= this.xdim) return false;
        const x0 = Math.floor(minX),
            x1 = Math.min(Math.floor(maxX), this.xdim - 1),
            y0 = Math.floor(minY),
            y1 = Math.floor(maxY);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const i = cx + cy * this.xdim;
                const t = this.cellType[i];
                if (t === FluidSolver.CELL_TYPE.BARRIER || t === FluidSolver.CELL_TYPE.ROTOR) return true;
                if (t === FluidSolver.CELL_TYPE.MESH && (2 * radius) > this.meshHoleSize[i]) return true;
            }
        }
        return false;
    }

    /**
     * @description Atualiza a física de cada partícula ativa: interpola a velocidade do fluido
     * no ponto dela (mesma interpolação bilinear das setas/fumaça), soma um arrasto proporcional
     * à diferença de velocidade fluido↔partícula (mais forte pra peso leve — segue o vento de
     * perto, como uma folha) e uma gravidade constante (mais forte pra peso pesado), integra
     * velocidade/posição, e resolve colisão eixo a eixo contra sólidos (Barreira/Rotor/bordas do
     * domínio/Grade com furo pequeno demais) refletindo a velocidade nesse eixo com perda de
     * energia (`PARTICLE_RESTITUTION`) — bugs.md #32, "pode bater em uma parede, pode retornar".
     * Sai da cena (recicla, como um traçador) ao tocar uma Saída ou ao passar da borda direita.
     */
    _updateParticles() {
        for (const p of this.particles) {
            if (p.x < 0) continue;
            const fluidUx = this._bilinearInterpolate(p.x, p.y, this.ux);
            const fluidUy = this._bilinearInterpolate(p.x, p.y, this.uy);
            if (!isFinite(fluidUx) || !isFinite(fluidUy)) {
                this._deactivateParticle(p);
                continue;
            }
            const phys = FluidSolver.particlePhysicsFromWeight(p.weight);
            p.vx += phys.drag * (fluidUx - p.vx);
            p.vy += phys.drag * (fluidUy - p.vy) - phys.gravity;
            const speed = Math.hypot(p.vx, p.vy);
            if (speed > FluidSolver.PARTICLE_MAX_SPEED) {
                const scale = FluidSolver.PARTICLE_MAX_SPEED / speed;
                p.vx *= scale;
                p.vy *= scale;
            }

            let newX = p.x + p.vx;
            let newY = p.y + p.vy;
            const rx = Math.floor(newX),
                ry = Math.floor(newY);
            const cellAtNew = (rx >= 0 && rx < this.xdim && ry >= 0 && ry < this.ydim) ? this.cellType[rx + ry * this.xdim] : -1;
            if (newX > this.xdim - 1 || cellAtNew === FluidSolver.CELL_TYPE.SINK) {
                this._deactivateParticle(p);
                continue;
            }

            // Resolve colisão eixo a eixo (mesmo espírito de `_slideAlongSolid`, mas refletindo
            // em vez de deslizar — uma partícula tem massa/inércia de verdade, não é um traço
            // sem peso que só precisa contornar a parede).
            if (this._isSolidForParticle(newX, p.y, p.radius)) {
                p.vx = Math.abs(p.vx) < FluidSolver.PARTICLE_REST_EPS ? 0 : -p.vx * FluidSolver.PARTICLE_RESTITUTION;
                newX = p.x;
            }
            if (this._isSolidForParticle(p.x, newY, p.radius)) {
                p.vy = Math.abs(p.vy) < FluidSolver.PARTICLE_REST_EPS ? 0 : -p.vy * FluidSolver.PARTICLE_RESTITUTION;
                newY = p.y;
            }
            // Rede de segurança contra "corte de esquina": os dois testes acima são POR EIXO
            // (mover só em X, mover só em Y) — nenhum deles olha a posição final COMBINADA. Com
            // uma célula sólida na diagonal cujas duas vizinhas ortogonais estão abertas (a ponta
            // de uma Grade, um degrau de linha diagonal), mover nos dois eixos ao mesmo tempo
            // passa pelos dois testes e aterrissa DENTRO do sólido — reproduzido: uma bolinha
            // vinda na diagonal entrava na célula de Grade e ficava presa lá dentro. Se a posição
            // combinada ainda for sólida, o passo inteiro é desfeito e a velocidade reflete nos
            // dois eixos (é uma batida de quina).
            if (this._isSolidForParticle(newX, newY, p.radius)) {
                newX = p.x;
                newY = p.y;
                p.vx = Math.abs(p.vx) < FluidSolver.PARTICLE_REST_EPS ? 0 : -p.vx * FluidSolver.PARTICLE_RESTITUTION;
                p.vy = Math.abs(p.vy) < FluidSolver.PARTICLE_REST_EPS ? 0 : -p.vy * FluidSolver.PARTICLE_RESTITUTION;
            }
            p.x = newX;
            p.y = newY;
        }
    }
}
