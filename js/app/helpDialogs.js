// Diálogos de ajuda (botões "?") do FluidSimulationApp. Extraído de FluidSimulationApp.js; os
// métodos são anexados ao protótipo do app por applyMixin, então `this` é a instância do app.

import { formatarVelocidade, formatarTempo } from '../Unidades.js?v=20261102b';

export class HelpDialogs {
    _showMeshHoleSizeHelp() {
        Swal.fire({
            title: 'Tamanho do Furo da Grade',
            icon: 'info',
            html: ` <p>Controla só QUAIS PARTÍCULAS FÍSICAS conseguem atravessar esta Grade — uma partícula passa quando o próprio diâmetro é menor que o furo, e é barrada (quica de volta) quando é maior.</p> <p>Vento, fumaça e as setas de traçador sempre atravessam a Grade (com a resistência de sempre) — o furo não afeta esses três, só as partículas.</p> <div class="note"> Diâmetro de cada partícula, pelos pesos padrão: Folha ~0,47 célula, Bolinha ~0,73, Caixa ~0,99 (o Peso na barra de ferramentas muda isso). O padrão de fábrica é <strong>0,30</strong> — menor que qualquer partícula, ou seja, a Grade segura tudo. Abra o furo para deixar as menores passarem: em 0,5 a Folha passa; em 0,8 Folha e Bolinha passam; acima de 1,0 passa tudo. </div> <div class="note"> <strong>Se algo estiver escapando:</strong> confira se a Grade encosta de verdade nas duas paredes — um vão de UMA célula na ponta já é suficiente para as partículas passarem por ali. Arrastar a linha até um pouco além da parede faz ela grudar sozinha. </div>`
        });
    }

    _showRotorMotorHelp() {
        Swal.fire({
            title: 'Motor do Rotor',
            icon: 'info',
            html: ` <p>A chave tem três posições: girar para a <strong>esquerda</strong> (anti-horário), <strong>desligado</strong> no meio, e girar para a <strong>direita</strong> (horário).</p> <ul> <li><strong>Desligado:</strong> o Rotor é uma turbina livre — só o fluido o move. É o comportamento de sempre.</li> <li><strong>Ligado:</strong> o Rotor vira motor e passa a mover o fluido: ele gira sozinho e sopra/arrasta o ar em volta, mesmo sem nenhuma Entrada na cena.</li> </ul> <p>A <strong>Velocidade do Motor</strong> é uma porcentagem da rotação máxima que o solver aceita com estabilidade. O motor persegue essa rotação, mas cede um pouco sob carga (uma pá grande ou um obstáculo perto seguram o giro), como um ventilador de verdade.</p> <div class="note"> As outras propriedades continuam valendo com o motor ligado: <em>Massa/Densidade</em> muda a rapidez com que ele chega na rotação escolhida (e quanto tempo continua girando ao desligar), e <em>Amortecimento</em> freia o giro. </div>`
        });
    }

    _showViscosityHelp() {
        const e = this._physicalScale();
        Swal.fire({
            title: 'Viscosidade',
            icon: 'info',
            html: `<p>Este slider é a viscosidade <strong>da rede</strong> (adimensional). Ela controla a estabilidade: valores baixos dão fluxo mais turbulento e podem divergir; valores altos suavizam tudo.</p><p>Com o fluido e o tamanho de célula do painel <strong>Escala Física</strong>, ela define quanto tempo real dura um passo: <strong>${formatarTempo(e.dt)}</strong> agora. O fluido real (ar, água...) não muda a rede, só a conversão para o SI; o que muda o comportamento é o número de Reynolds <code>Re = U·D/ν</code>, e o botão <strong>Calibrar</strong> escolhe velocidade e viscosidade de rede para reproduzir uma velocidade real.</p>`
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
        const e = this._physicalScale();
        Swal.fire({
            title: 'Velocidade do Fluxo',
            icon: 'info',
            html: `<p>O slider está em unidades de rede (<strong>${u0.toFixed(3)}</strong>, em células por passo). Com a escala atual isso equivale a <strong>${formatarVelocidade(u0 * e.velocidade)}</strong> (${(u0 * e.velocidade * 3.6).toLocaleString('pt-BR', { maximumSignificantDigits: 3 })} km/h).</p><div class="note">A conversão vem do painel <strong>Escala Física</strong>: <code>m/s = unidade de rede × tamanho da célula ÷ tempo de um passo</code>. Mantenha a velocidade de rede abaixo de ~0,1: acima disso o fluido deixa de ser aproximadamente incompressível.</div>`
        });
    }

    _showPhysicalScaleHelp() {
        Swal.fire({
            title: 'Escala Física',
            icon: 'info',
            html: `<p>O solver trabalha em unidades de rede (1 célula, 1 passo). Esta escala traduz para o SI:</p><ul><li><strong>Fluido real</strong>: viscosidade cinemática verdadeira (ar 1,5×10⁻⁵, água 1×10⁻⁶ m²/s...).</li><li><strong>Tamanho da célula</strong>: quantos mm tem cada quadradinho. Define o tamanho real da cena e dos obstáculos.</li><li><strong>Calibrar</strong>: dada a velocidade real desejada, ajusta a velocidade e a viscosidade de rede. O tempo de cada passo sai de <code>dt = ν_rede·dx² / ν_real</code>.</li></ul><div class="note">O número de Reynolds é preservado: <code>Re = U·D/ν</code> é o mesmo na simulação e na vida real. Fluxos reais muito rápidos exigem células pequenas, senão a calibração bate no limite e avisa.</div>`
        });
    }

    _showGridSizeHelp() {
        const s = this.solver;
        Swal.fire({
            title: 'Tamanho da Grade',
            icon: 'info',
            html: ` <p>A grade é o "papel quadriculado" onde a física acontece: cada célula é um ponto de cálculo. Hoje sua cena tem <strong>${s.xdim} × ${s.ydim}</strong> células.</p> <ul> <li><strong>Grade maior</strong> = mais espaço e mais detalhe (obstáculos finos e vórtices pequenos aparecem melhor), porém mais lenta — o custo de cada passo é proporcional ao número de células.</li> <li><strong>Grade menor</strong> = roda mais rápido e é melhor para experimentar, com menos detalhe.</li> </ul> <div class="note"> Ao aplicar um tamanho novo a grade é recriada do zero e <strong>o desenho atual é apagado</strong>. Se quiser guardar a cena antes, use Exportar — uma cena importada traz a própria grade junto, independente do tamanho da sua janela. </div>`
        });
    }

    _showBoundaryModeHelp() {
        Swal.fire({
            title: 'Canal ou Mundo Aberto?',
            icon: 'info',
            html: ` <p>O modo define o que acontece nas <strong>bordas da grade</strong> — é independente do que você desenha dentro dela.</p> <ul> <li><strong>Canal:</strong> a borda esquerda INTEIRA (de cima a baixo) sopra com a "Velocidade do Fluxo" do painel, a borda direita é saída livre e as bordas de cima/baixo são paredes. É o modo de túnel de vento: existe um vento de fundo mesmo sem nenhuma Entrada desenhada.</li> <li><strong>Mundo Aberto:</strong> as quatro bordas viram saída livre, sem vento de fundo nenhum. Só as <strong>Entradas</strong> que você desenhar movimentam o fluido.</li> </ul> <div class="note"> <strong>Desenhou um duto/canal alimentado por uma Entrada e apareceu ar entrando pela esquerda?</strong> É o vento de fundo do modo Canal se somando à sua Entrada. Troque para <em>Mundo Aberto</em> (ou deixe a Velocidade do Fluxo em 0) para que só a Entrada sopre. </div>`
        });
    }

    _showVisualizationHelp() {
        Swal.fire({
            title: 'Entendendo as Visualizações',
            icon: 'info',
            html: ` <p>As cores no canvas representam as propriedades físicas do fluido em cada ponto. Com exceção da Densidade, todas as outras mostram a INTENSIDADE (magnitude) — não o sinal/direção. <em>Azul = zero/fraco</em>, <em>Vermelho = forte</em>.</p> <ul> <li><strong>Densidade:</strong> Pressão real do fluido. <em>Azul = baixa pressão</em>, <em>Verde/Amarelo = repouso</em>, <em>Vermelho = alta pressão</em>.</li> <li><strong>Velocidade X:</strong> O quanto o fluido se move na horizontal, rápido ou devagar, pra qualquer lado.</li> <li><strong>Velocidade Y:</strong> O quanto o fluido se move na vertical, rápido ou devagar, pra qualquer lado.</li> <li><strong>Velocidade (módulo):</strong> Rapidez total do fluido, sem separar direção.</li> <li><strong>Rotação (Curl):</strong> O quanto o fluido está girando ali — ideal pra ver vórtices e turbulência, mas não distingue giro horário de anti-horário (só a força do giro).</li> </ul>`
        });
    }
}
