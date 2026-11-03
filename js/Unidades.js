// Escala física do simulador: conversão entre unidades de rede (1 célula = 1 de comprimento,
// 1 passo = 1 de tempo) e unidades do SI. Sem DOM, para poder ser testado no Node.
//
// A física do LBM só enxerga grandezas adimensionais. Três delas fixam a escala:
//   comprimento:  dx   = tamanho real de uma célula (m)
//   viscosidade:  ν_rede = ν_real · dt / dx²   →   dt = ν_rede · dx² / ν_real
//   velocidade:   u_real = u_rede · dx / dt
// Com isso o número de Reynolds é o mesmo na rede e no mundo real: Re = U·D/ν.

/** Viscosidade cinemática (m²/s) de fluidos comuns, a ~20 °C. */
export const FLUIDOS = {
    ar: { nome: 'Ar', nu: 1.5e-5 },
    agua: { nome: 'Água', nu: 1.0e-6 },
    mercurio: { nome: 'Mercúrio', nu: 1.1e-7 },
    oleo: { nome: 'Óleo de motor (SAE 30)', nu: 3.0e-4 },
    mel: { nome: 'Mel', nu: 7.0e-3 },
};

export const FLUIDO_PADRAO = 'ar';
/** Célula padrão: 1 mm (uma grade de 300×150 vira um recinto de 30×15 cm). */
export const CELULA_PADRAO_MM = 1;
/** Faixa aceita para o tamanho da célula, em mm (do campo da interface). */
export const CELULA_MIN_MM = 0.001, CELULA_MAX_MM = 100000;

/** Limites dos sliders do app (unidades de rede). */
export const LIMITES_REDE = { nuMin: 0.005, nuMax: 0.2, nuPasso: 0.005, uMax: 0.1, uPasso: 0.005 };

/**
 * Escala a partir de um fluido real, do tamanho da célula e da viscosidade de rede escolhida.
 * @returns {{dt: number, velocidade: number, comprimento: number}} passo de tempo (s), metros por
 * unidade de velocidade de rede (m/s por unidade) e metros por célula.
 */
export function calcularEscala({ nuFisico, tamanhoCelulaM, nuRede }) {
    const dt = nuRede * tamanhoCelulaM * tamanhoCelulaM / nuFisico;
    return { dt, velocidade: tamanhoCelulaM / dt, comprimento: tamanhoCelulaM };
}

/**
 * Escolhe velocidade e viscosidade de rede para reproduzir uma velocidade real. Tenta manter a
 * velocidade de rede em `uAlvo` (longe do limite de ~0,1 onde o método perde a precisão) e ajusta
 * a viscosidade de rede, que é o que fixa o passo de tempo. Se a viscosidade necessária cair fora
 * da faixa do slider, ela é limitada e a velocidade de rede acompanha; se a velocidade de rede
 * passar do máximo, a velocidade real obtida fica abaixo da pedida.
 * @returns {{nuRede, uRede, velocidadeObtida, limitado, motivo}}
 */
export function calibrar({ nuFisico, tamanhoCelulaM, velocidade, uAlvo = 0.05, limites = LIMITES_REDE }) {
    for (const [nome, v] of Object.entries({ nuFisico, tamanhoCelulaM, velocidade })) {
        if (!Number.isFinite(v) || v <= 0) throw new RangeError(`calibrar: "${nome}" precisa ser um número positivo (recebeu ${v}).`);
    }
    const { nuMin, nuMax, nuPasso, uMax, uPasso } = limites;
    const arredonda = (v, p) => Math.round(v / p) * p;
    let nuRede = nuFisico * uAlvo / (velocidade * tamanhoCelulaM);
    let limitado = false, motivo = '';
    if (nuRede < nuMin) { nuRede = nuMin; limitado = true; motivo = 'viscosidade mínima'; }
    if (nuRede > nuMax) { nuRede = nuMax; limitado = true; motivo = 'viscosidade máxima'; }
    nuRede = Math.min(nuMax, Math.max(nuMin, arredonda(nuRede, nuPasso)));
    let uRede = velocidade * nuRede * tamanhoCelulaM / nuFisico;
    if (uRede > uMax) { uRede = uMax; limitado = true; motivo = 'velocidade máxima'; }
    if (uRede < uPasso / 2) { limitado = true; motivo = 'velocidade mínima'; }
    uRede = Math.min(uMax, Math.max(uPasso, arredonda(uRede, uPasso)));
    const { velocidade: v } = calcularEscala({ nuFisico, tamanhoCelulaM, nuRede });
    const velocidadeObtida = Number((uRede * v).toPrecision(6));
    if (!limitado && Math.abs(velocidadeObtida - velocidade) / velocidade > 0.25) {
        limitado = true; motivo = 'resolução dos sliders';
    }
    return { nuRede, uRede, velocidadeObtida, limitado, motivo };
}

const num = (v) => v.toLocaleString('pt-BR', { maximumSignificantDigits: 3 });

// Escolhe a maior unidade em que o valor, já arredondado a 3 algarismos, é >= 1. Arredondar ANTES
// de escolher evita "1.000 µs" (que um leitor lê como 1000 µs) quando o certo é "1 ms".
function comUnidade(valor, unidades) {
    if (!Number.isFinite(valor)) return '—';
    const a = Math.abs(valor);
    if (a === 0) return `0 ${unidades[0][1]}`;
    for (const [fator, rotulo] of unidades) {
        if (Number((a / fator).toPrecision(3)) >= 1) return `${valor < 0 ? '-' : ''}${num(a / fator)} ${rotulo}`;
    }
    return `~0 ${unidades[0][1]}`;
}

/** "12,3 cm/s", "0,75 m/s", "3,4 mm/s" — o que for mais legível. */
export function formatarVelocidade(ms) {
    return comUnidade(ms, [[1, 'm/s'], [0.01, 'cm/s'], [0.001, 'mm/s'], [1e-6, 'µm/s']]);
}

/** "1,33 ms", "2,5 s", "35 µs". */
export function formatarTempo(s) {
    return comUnidade(s, [[1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns']]);
}

/** "30 cm", "1,2 m", "8 mm". */
export function formatarComprimento(m) {
    return comUnidade(m, [[1, 'm'], [0.01, 'cm'], [0.001, 'mm'], [1e-6, 'µm']]);
}
