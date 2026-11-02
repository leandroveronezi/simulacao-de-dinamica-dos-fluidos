# Simulação de Dinâmica dos Fluidos

Editor interativo de escoamento 2D que roda inteiro no navegador, baseado no método
Lattice-Boltzmann (LBM D2Q9). Você desenha obstáculos, entradas, saídas, rotores e outros
elementos, e vê o fluido reagir em tempo real. Sem backend e sem build.

## Como executar

Sirva a pasta por HTTP e abra no navegador:

```bash
python3 -m http.server 8080    # ou: npx serve .
```

Abrir o `index.html` direto (`file://`) não funciona: os módulos ES exigem um servidor HTTP.
É preciso internet na primeira carga, porque Pico.css, Font Awesome, SweetAlert2, Clipper.js e
a fonte vêm de CDN.

## Testes

```bash
npm install            # só na primeira vez (instala o playwright-core)
npm test               # solver e objetos, em Node puro, sem navegador
npm run test:ui        # roteiro de desenho em um Chrome real
npm run test:all       # tudo
```

O teste de interface usa o Chrome do sistema (`/usr/bin/google-chrome`) e compara o estado
exportado com `tests/snapshots/ui-config.json`. Só regrave o instantâneo quando a mudança de
comportamento for intencional: `UPDATE_SNAPSHOT=1 npm run test:ui`.

## Tipos de célula

| Tipo | Comportamento |
|---|---|
| **Barreira** | Sólido fixo. O fluido contorna (bounce-back, sem deslizamento). |
| **Entrada** | Impõe velocidade e densidade a cada passo. Direção e velocidade ajustáveis pela seta ou pelo painel. |
| **Saída** | Ralo: drena uma fração da massa da célula por passo (força ajustável). Também absorve traçadores, fumaça e partículas. |
| **Rotor** | Corpo rígido que gira com o torque do fluido e também empurra o fluido. Pode virar motor. |
| **Válvula** | Nasce fechada (age como Barreira); aberta, deixa o fluido passar. Liga e desliga pelo painel de controle. |
| **Grade** | Nunca bloqueia o fluido, mas o freia (15% por célula de espessura). Bloqueia só partículas maiores que o furo ajustável. |

## Ferramentas

- **Desenho:** Pincel, Linha, Retângulo, Elipse (cheios ou só contorno), Retângulo arredondado.
  Linhas, retângulos e elipses viram **formas vetoriais**: dá para selecioná-las, movê-las,
  esticá-las, mudar a espessura e apagá-las depois.
- **Preencher:** preenche uma área fechada e funde contorno e preenchimento numa forma só.
  Em área aberta, vira pintura livre.
- **Borracha** (retangular ou em traço livre): corta de verdade as formas vetoriais, apagando só
  a parte coberta. O Rotor só é removido pela seleção e Delete.
- **Fumaça:** define pontos que emitem traçadores coloridos (até 4000).
- **Partículas:** cada clique solta um objeto avulso (folha, bolinha ou caixa) com peso
  ajustável. Eles sofrem vento e gravidade, e quicam em Barreira, Rotor e bordas. Somem ao sair
  do domínio ou tocar uma Saída (até 300 ao mesmo tempo).
- **Ponteiro:** seleciona formas, Rotores, Entradas e fontes de fumaça para editar no painel
  flutuante. Também arrasta o pivô do Rotor e a seta da Entrada.
- **Seleção:** copiar, recortar, colar, espelhar e girar uma área.
- **Pan e zoom** (1× a 8×), **sensor** de ρ, ux e uy em qualquer ponto, **screenshot** em PNG.

### Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `Delete` ou `Backspace` | Apaga a forma ou o Rotor selecionado |
| `Esc` | Cancela o arraste da seta, desmarca, descarta o clipboard e limpa a seleção |

## Modos e parâmetros

**Modo de contorno** (trocar não apaga o desenho, só reinicia o fluido):

- **Canal** (padrão): a borda esquerda é uma entrada com velocidade `u0`, a direita é saída, e o
  topo e o fundo são paredes com deslizamento livre. Atenção: o vento do canal se soma às
  Entradas desenhadas. Para que só elas movam o fluido, use Mundo Aberto ou zere a velocidade.
- **Mundo Aberto**: as 4 bordas são saída. Só as Entradas desenhadas movimentam o fluido.

**Parâmetros:**

- **Velocidade do fluxo `u0`** (0 a 0,10): velocidade da entrada do modo Canal.
- **Viscosidade `ν`** (0,005 a 0,2): ar ≈ 0,01 a 0,02, água ≈ 0,02 a 0,04. Relaciona-se com a
  relaxação por `ω = 1 / (3ν + 0,5)`.
- **Passos por frame** (1 a 40): equilíbrio entre velocidade aparente e custo.
- **Tamanho da grade:** por padrão acompanha a janela; ajustável no painel Simulação.

**Visualizações:** Densidade (pressão), Velocidade X, Velocidade Y, Módulo da velocidade e
Rotação (curl, que mostra vórtices bem), além de traçadores, setas de velocidade e de força.

**Estabilidade:** velocidade alta com viscosidade baixa pode divergir. O solver limita
densidade (0,2 a 3,0) e velocidade (0,3) célula a célula e, se detectar NaN, `|u| > 0,5` ou mais
de 5% da grade grampeada, pausa e oferece resetar o fluido. Para evitar: reduza a velocidade,
aumente a viscosidade ou reduza os passos por frame.

## Salvar e carregar

- **Autosave** no navegador (`localStorage`), restaurado ao reabrir.
- **Projetos nomeados** no navegador: novo, salvar, salvar como, abrir, excluir.
- **Exportar e importar JSON** (versão 17). Arquivos com versão menor que 15 são rejeitados.
  Partículas físicas, traçadores e fumaça em voo não entram no arquivo.

## Como funciona

O LBM simula distribuições de partículas em uma grade, em 9 direções por célula (D2Q9). A cada
passo há **colisão** (relaxação BGK em direção ao equilíbrio) e **propagação** para as células
vizinhas. Densidade e velocidade surgem dos momentos das distribuições.

- **Obstáculos** usam bounce-back (reflexão), o que impõe não deslizamento na parede.
- **Rotores** usam a correção de parede em movimento: a velocidade `ω × r` de cada célula é
  somada às distribuições refletidas, então a pá empurra o fluido. A reação sobre o corpo entra
  de forma implícita na equação do movimento, senão o rotor ganharia momento do nada. O torque
  é medido antes dessa correção, para não realimentar. A velocidade angular é limitada para
  manter a ponta da pá dentro da faixa estável do solver.
- **Saída** multiplica as 9 distribuições por `1 − α`: a densidade cai e a velocidade fica
  igual, então o ralo não vira obstáculo. Um piso de densidade (`SINK_RHO_FLOOR = 0,6`) evita
  esvaziar recintos selados.
- **Grade** multiplica a velocidade por `0,85` em cada célula, então uma faixa mais grossa
  resiste mais.
- **Partículas** têm raio, arrasto e gravidade interpolados de um único peso (0 a 1). O arrasto
  é interpolado em escala logarítmica.

## Estrutura

```
index.html, style.css, main.js    # página, estilos e ponto de entrada
js/
  FluidSolver.js        # física LBM, rotores, partículas, traçadores (sem DOM)
  Renderer.js           # desenho no Canvas 2D (ImageData offscreen)
  FluidSimulationApp.js # controlador: DOM, ferramentas, undo/redo, zoom, import/export
  PolygonGeometry.js    # polígonos das formas e operações booleanas (Clipper.js)
tests/                  # testes do solver, dos objetos e da interface
bugs.md                 # pendências em aberto
```

`FluidSolver` não toca no DOM e `Renderer` recebe tudo pronto por um `viewState`, o que permite
testar a física no Node. O histórico de decisões e correções está no git; comentários no código
que citam "bugs.md #N" apontam para o `bugs.md` do commit `7fd3bfe`.

## Referências

- Krüger et al. (2017), *The Lattice Boltzmann Method: Principles and Practice*, Springer.
- Succi (2001), *The Lattice Boltzmann Equation for Fluid Dynamics and Beyond*, Oxford.
- Ladd (1994), *Numerical Simulations of Particulate Suspensions via a Discretized Boltzmann
  Equation*, J. Fluid Mech. (bounce-back e paredes em movimento).

## Licença

MIT. Texto completo em [LICENSE](LICENSE).
