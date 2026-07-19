<div align="center">

# 🌊 Simulação de Dinâmica dos Fluidos

### Editor interativo de escoamento baseado no método Lattice-Boltzmann (LBM D2Q9)

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5-Canvas-E34F26?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Pico CSS](https://img.shields.io/badge/Pico.css-1.x-1095c1?style=flat-square)](https://picocss.com/)
[![Licença](https://img.shields.io/badge/Licen%C3%A7a-MIT-green?style=flat-square)](#licença)
[![Módulos ES](https://img.shields.io/badge/M%C3%B3dulos-ES%20Modules-blueviolet?style=flat-square)]()

> **Simule, visualize e experimente a dinâmica de fluidos em tempo real diretamente no seu navegador** — sem backend, sem dependências pesadas, sem instalação. Um motor físico completo, um editor de cenários poderoso e uma renderização fluída a até 60 FPS.

---

</div>

## 📖 Índice

- [Visão Geral](#-visão-geral)
- [Fundamentos Físicos](#-fundamentos-físicos)
- [Arquitetura do Projeto](#-arquitetura-do-projeto)
- [Tipos de Célula](#-tipos-de-célula)
- [Ferramentas de Desenho](#-ferramentas-de-desenho)
- [Modos de Simulação](#-modos-de-simulação)
- [Visualizações Disponíveis](#-visualizações-disponíveis)
- [Objetos Giratórios (Rotores)](#-objetos-giratórios-rotores)
- [Grupos de Entrada (Sources)](#-grupos-de-entrada-sources)
- [Sistema de Saída (Sink)](#-sistema-de-saída-sink)
- [Import / Export de Configuração](#-import--export-de-configuração)
- [Atalhos de Teclado](#-atalhos-de-teclado)
- [Parâmetros de Simulação](#-parâmetros-de-simulação)
- [Estabilidade Numérica](#-estabilidade-numérica)
- [Como Executar](#-como-executar)
- [Estrutura de Arquivos](#-estrutura-de-arquivos)
- [Referências Técnicas](#-referências-técnicas)
- [Licença](#-licença)

---

## 🔭 Visão Geral

Este projeto é um **simulador interativo de dinâmica dos fluidos em 2D** inteiramente no navegador. O motor físico implementa o método **Lattice-Boltzmann D2Q9** — um dos algoritmos mais elegantes para simular escoamentos incompressíveis —, enquanto a interface oferece um editor de cenários rico com ferramentas vetoriais, undo/redo ilimitado, objetos giratórios com física de corpo rígido e múltiplos modos de visualização do campo de escoamento.

### Por que Lattice-Boltzmann?

Ao contrário dos métodos de diferenças finitas ou elementos finitos que discretizam diretamente as equações de Navier-Stokes, o **LBM** simula a evolução de distribuições de partículas em uma grade. A evolução macroscópica (densidade e velocidade do fluido) emerge naturalmente dos passos de **colisão** e **propagação** microscópicos — uma abordagem localmente paralela, fisicamente intuitiva e numericamente estável numa ampla faixa de regimes de escoamento.

### Destaques do Projeto

| Recurso | Descrição |
|---|---|
| 🖌️ **12 ferramentas de desenho** | Pincel, linha, retângulo, elipse, contorno, arredondado, preenchimento (flood-fill), spray, borracha, fumaça, seleção, pan |
| 🔲 **4 tipos de célula** | Barreira, Entrada (Source), Saída (Sink), Rotor |
| 🌀 **Rotores físicos** | Turbinas e palhetas elásticas com inércia, amortecimento e mola de retorno individuais |
| 💡 **5 modos de visualização** | Densidade (pressão), Vel. X, Vel. Y, Velocidade (módulo), Rotação/Curl |
| 🎨 **Corante (Smoke)** | Traçadores de fumaça coloridos emitidos a partir de fontes definidas pelo usuário |
| 📐 **Zoom & Pan** | Zoom de 1× até 8× com ancoragem no cursor; pan livre; botões +/−/reset |
| ↩️ **Undo / Redo** | Pilha ilimitada com snapshot completo da geometria (Ctrl+Z / Ctrl+Y) |
| 📋 **Seleção & Clipboard** | Copiar, recortar, colar, inverter horizontal/vertical, rotacionar 90°/180°/270° |
| 💾 **Import / Export** | Configuração completa serializada em JSON (versão 16) |
| 📷 **Screenshot** | Exporta o canvas como PNG com timestamp |
| 📡 **Sensor** | Leitura ao vivo de ρ, ux, uy em qualquer ponto da grade (arrastável) |
| 🔧 **Modo Canal / Mundo Aberto** | Muda o regime de contorno sem apagar a geometria desenhada |

---

## 🧮 Fundamentos Físicos

### Lattice-Boltzmann D2Q9

A grade tem **9 velocidades discretas** por célula (D2 = 2D, Q9 = 9 direções), anotadas pelas direções cardeais e diagonais mais a direção de repouso:

```
NW  N  NE
 W  0   E
SW  S  SE
```

Cada célula armazena as **funções de distribuição** `f_i(x, t)` — a densidade de partículas se movendo na direção `i`. As propriedades macroscópicas do fluido são obtidas pelos momentos:

| Propriedade | Cálculo |
|---|---|
| Densidade `ρ` | `Σ f_i` |
| Velocidade `ux` | `(f_E + f_NE + f_SE − f_W − f_NW − f_SW) / ρ` |
| Velocidade `uy` | `(f_N + f_NE + f_NW − f_S − f_SE − f_SW) / ρ` |

### Passo de Colisão (BGK)

O operador de colisão **Bhatnagar-Gross-Krook (BGK)** relaxa cada distribuição em direção ao equilíbrio termodinâmico local com taxa `ω`:

```
f_i(x, t+1) = f_i(x, t) + ω · [f_i^eq(ρ, u) − f_i(x, t)]
```

O parâmetro de relaxação `ω = 1 / (3ν + 0.5)` relaciona-se diretamente com a **viscosidade cinemática** `ν`. O slider de viscosidade controla exatamente esse valor.

### Passo de Propagação (Streaming)

Após a colisão, cada distribuição `f_i` é transportada para a célula vizinha na direção `i`. A propagação usa **arrays temporários** para evitar dependências de dados entre células — o swap de ponteiros ao final é O(1) e não envolve cópia de dados.

### Condição de Contorno — Bounce-Back

Barreiras (e Rotores) refletem as distribuições de partículas de volta na direção oposta (**bounce-back**). Isso impõe a condição de **não deslizamento** na superfície do obstáculo — o comportamento correto de um fluido viscoso em contato com uma parede sólida:

```
f_E  ↔  f_W
f_N  ↔  f_S
f_NE ↔  f_SW
f_NW ↔  f_SE
```

### Parede em Movimento (Rotores)

Para que um Rotor realmente **sopre/arraste o fluido** com sua rotação (não apenas receba torque dele), aplica-se a correção clássica de **parede em movimento** do LBM. A velocidade local de cada célula do Rotor `v = ω × r` é injetada nas distribuições refletidas:

```
f_E  += (2/3) · ρ · wallVx
f_NE += (1/6) · ρ · (wallVx + wallVy)
f_NW += (1/6) · ρ · (−wallVx + wallVy)
...
```

Isso transforma cada pá do rotor em uma fonte localizada de quantidade de movimento.

### Vorticidade / Curl

A visualização **"Rotação (Curl)"** exibe `ω_z = ∂uy/∂x − ∂ux/∂y`, computado por diferenças centrais:

```
curl[x,y] = uy[x+1,y] − uy[x−1,y] − ux[x,y+1] + ux[x,y−1]
```

Valores positivos (azul) indicam rotação anti-horária; negativos (vermelho), horária. É a melhor visualização para observar **vórtices e turbulência** gerados por obstáculos.

---

## 🏗️ Arquitetura do Projeto

O código é estruturado em três módulos ES com responsabilidades bem separadas:

```text
┌─────────────────────────────────────────────────────────────────┐
│                        index.html                               │
│   (UI, controles, modo tema escuro, Font Awesome, Pico CSS)     │
└──────────────────────┬──────────────────────────────────────────┘
                       │ instancia
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│               FluidSimulationApp.js                             │
│  • Controlador principal da aplicação                           │
│  • DOM: queries, event listeners, sliders, modais (SweetAlert2) │
│  • Ferramentas: brush, line, rect, ellipse, fill, spray, smoke  │
│  • Transformações de seleção: flip, rotate, cut/copy/paste      │
│  • Undo/Redo: pilha de snapshots completos da geometria         │
│  • Zoom/Pan: transformações de viewport com âncora no cursor    │
│  • Import/Export: JSON v16 completo                             │
│  • Loop de animação: requestAnimationFrame + setTimeout ~60 FPS │
└────────────┬────────────────────────────────┬───────────────────┘
             │ orquestra                       │ orquestra
             ▼                                 ▼
┌───────────────────────┐         ┌─────────────────────────┐
│    FluidSolver.js     │         │      Renderer.js        │
│  Motor de física puro │         │  Pintura do canvas pura │
│  • LBM D2Q9 completo  │         │  • ImageData offscreen  │
│  • collide() BGK      │         │  • Colormap 400 tons    │
│  • stream()           │         │  • Réguas e grid        │
│  • Rotores + torque   │         │  • Traçadores de fluxo  │
│  • Sources/Sinks      │         │  • Fumaça (dye tracers) │
│  • Traçadores         │         │  • Setas força/Entrada  │
│  • Estabilidade       │         │  • Sensor ao vivo       │
└───────────────────────┘         └─────────────────────────┘
```

### Decisões de Design

- **Sem acoplamento DOM ↔ Física**: `FluidSolver` não toca em nada do DOM. `Renderer` recebe tudo via `viewState` — nenhum formulário é lido diretamente por esses módulos.
- **ImageData offscreen**: a renderização do campo de escoamento usa um canvas offscreen com `putImageData()`, evitando milhares de `fillRect()` individuais por frame.
- **Typed Arrays**: toda a grade física usa `Float32Array` e `Uint8Array`, garantindo layout de memória denso e operações numéricas eficientes.
- **Torque separado do bounce-back**: o torque nos Rotores é medido nas distribuições **pós-reflexão mas pré-correção de parede em movimento** — separação obrigatória para evitar realimentação que travaria o corpo oscilando entre passos.
- **ResizeObserver**: o canvas se redimensiona automaticamente ao contêiner sem polling.

---

## 🧱 Tipos de Célula

| Tipo | Valor | Cor | Comportamento |
|---|---|---|---|
| **Normal** | `0` | Campo de escoamento | Fluido livre — evolui pelo LBM completo |
| **Barreira** | `1` | ⬛ Preto | Sólido fixo — bounce-back sem deslizamento |
| **Entrada (Source)** | `2` | 🔵 Azul-céu | Impõe velocidade e densidade a cada passo |
| **Saída (Sink)** | `3` | 🔴 Vermelho | Absorve fluido via rampa de pressão gradual |
| **Rotor** | `4` | 🟣 Violeta | Sólido giratório com física de corpo rígido |

---

## 🖌️ Ferramentas de Desenho

### Ferramentas de Forma

| Ferramenta | Comportamento |
|---|---|
| **Pincel** | Desenha célula a célula ao arrastar com interpolação de Bresenham |
| **Linha** | Preview em tempo real; exibe comprimento e ângulo; confirma no soltar |
| **Retângulo Preenchido** | Área sólida delimitada pelos cantos de início e fim |
| **Elipse Preenchida** | Elipse preenchida inscrita no bounding box arrastado |
| **Retângulo Contorno** | Apenas as bordas do retângulo |
| **Elipse Contorno** | Apenas a borda da elipse (banda de 0.2 de largura normalizada) |
| **Retângulo Arredondado** | Bordas com raio = 20% do menor lado; ângulos via arcos trigonométricos |
| **Preenchimento (Flood-Fill)** | BFS a partir do ponto clicado; limite de 10.000 iterações de segurança |
| **Spray** | Distribuição aleatória em raio configurável (2–50 células) |
| **Borracha Retangular** | Apaga um retângulo de células para o tipo Normal |

### Ferramentas Especiais

| Ferramenta | Comportamento |
|---|---|
| **Fumaça / Corante** | Registra ponto de emissão de traçadores de fumaça (até 4.000 partículas) |
| **Seleção** | Define área retangular para copiar/recortar/transformar |
| **Pan** | Navega pelo canvas arrastando; também ativado pela roda do mouse |

---

## 🌐 Modos de Simulação

### Canal (`channel` — padrão)

- **Borda esquerda**: entrada com velocidade `u0` constante
- **Borda direita**: saída de gradiente zero (copia distribuições da penúltima coluna)
- **Bordas superior/inferior**: paredes com **deslizamento livre** — reflete apenas a componente normal Y, preservando X

> Ideal para simular escoamento em torno de obstáculos: perfil de asa (aerofólio), cilindros, canais com estreitamentos.

### Mundo Aberto (`open`)

- **Todas as 4 bordas**: saída de gradiente zero
- Sem entrada fixa — o fluido é movimentado exclusivamente pelas células **Entrada** desenhadas pelo usuário

> Ideal para simulações de fontes e ralos livres, vórtices confinados ou escoamentos multidirecionais.

> ℹ️ Trocar o modo de simulação **preserva toda a geometria desenhada**; apenas o campo de escoamento é reiniciado.

---

## 🎨 Visualizações Disponíveis

| Modo | O que é mostrado | Azul → Vermelho |
|---|---|---|
| **Densidade** | Pressão local do fluido (`ρ`) | Baixa → Alta pressão |
| **Velocidade X** | Componente horizontal (`ux`) | Esquerda → Direita |
| **Velocidade Y** | Componente vertical (`uy`) | Baixo → Cima |
| **Velocidade (módulo)** | Magnitude total `√(ux² + uy²)` | Lento → Rápido |
| **Rotação (Curl)** | Vorticidade `∂uy/∂x − ∂ux/∂y` | Anti-horário → Horário |

O slider **Contraste** aplica `1.2^n` (−10 a +10) sobre o valor mapeado, ampliando ou comprimindo a escala de cores sem alterar a física.

---

## 🔄 Objetos Giratórios (Rotores)

Rotores são corpos rígidos 2D que **giram sob o torque do fluido** e, por sua vez, **movimentam ativamente o fluido** ao seu redor via parede em movimento.

### Como criar

1. Selecione o tipo de pintura **Rotor** na barra lateral direita
2. Desenhe a forma com qualquer ferramenta — o centróide vira o pivô automaticamente
3. Um pontinho violeta indica o eixo de rotação; clique nele para selecionar e ajustar propriedades

### Propriedades por Rotor

| Propriedade | Intervalo | Descrição |
|---|---|---|
| **Massa/Densidade** | 0.2 – 5.0 | Multiplica o momento de inércia calculado pela forma |
| **Amortecimento Angular** | 0 – 0.2 | Fração de velocidade angular perdida por passo (atrito viscoso) |
| **Rigidez da Mola** | 0 – 0.05 | `0` = turbina livre; `> 0` = palheta elástica (balança e volta ao ângulo de repouso) |

### Equação de Movimento

```
I_eff · Δω = τ_fluido − β · ω − k · (θ − θ_repouso)

onde:
  I_eff     = massMultiplier × Σ(dx² + dy²)      [momento de inércia]
  τ_fluido  = Σ_células [ r × F_bounce-back ]     [torque do fluido]
  β         = damping                              [amortecimento]
  k         = stiffness                            [rigidez da mola]
```

A velocidade angular é limitada a `ω_max = 0.10 / r_max` para garantir que a velocidade de ponta das pás permaneça dentro da faixa de estabilidade do solver.

---

## 💧 Grupos de Entrada (Sources)

Células **Entrada** impõem velocidade e densidade a cada passo, atuando como bombas locais. Podem injetar fluido em qualquer direção.

### Como configurar a direção

1. Após desenhar uma Entrada, uma **seta azul** mostra direção e intensidade
2. Clique na origem da seta (pontinho azul) — cursor muda para `pointer`
3. Arraste na direção desejada — distância de arraste controla a velocidade (máx. ~20 células)
4. Solte para confirmar; `Esc` para cancelar

> A velocidade máxima de uma Entrada é `0.15` (mesma faixa validada para estabilidade do solver).

---

## 🔴 Sistema de Saída (Sink)

Células **Saída** simulam um dreno: absorvem fluido criando um gradiente de baixa pressão que atrai o fluido vizinho.

### Mecanismo de amortecimento em rampa

Via **BFS a partir das bordas** da região de Saída, calcula-se a profundidade de cada célula:

```
sinkDamping[i] = min(0.9,  depth[i] / 8  ×  0.9)
```

A densidade é puxada suavemente em direção a `ρ_alvo = 0.97`:

```
ρ_novo = ρ − (ρ − 0.97) × damping
```

A velocidade local **não é alterada** — isso cria uma sucção por gradiente de pressão real em vez de uma resistência que desviaria o escoamento para os lados.

---

## 💾 Import / Export de Configuração

O formato de configuração é **JSON versão 16**. Inclui:

```json
{
  "version": 16,
  "xdim": 320,
  "ydim": 180,
  "boundaryMode": "channel",
  "cellTypes": [...],
  "sourceVx": [...],
  "sourceVy": [...],
  "dyeSources": [...],
  "rotatingBodies": [...],
  "sourceGroups": [...],
  "flowSpeed": "0.1",
  "viscosity": "0.02",
  "animationSpeed": "20",
  "plotMode": 4,
  "contrast": "0",
  "showTracers": false,
  "showForce": false,
  "showSensor": false
}
```

> ⚠️ Arquivos com `version < 15` são rejeitados (formato incompatível com rotores e tamanho de grade variável).

A grade importada usa **exatamente** as dimensões `xdim × ydim` do arquivo — zoom e pan cuidam da exibição independente do tamanho da janela.

---

## ⌨️ Atalhos de Teclado

| Atalho | Ação |
|---|---|
| `Ctrl + Z` | Desfazer |
| `Ctrl + Y` | Refazer |
| `Esc` | Cancela arrastar direção / Deseleciona Rotor / Descarta clipboard / Limpa seleção |

---

## 🎚️ Parâmetros de Simulação

### Velocidade do Fluxo (`u0`)

Controla a velocidade da entrada no **modo Canal**. Intervalo: `0` a `0.10` (adimensional).

**Conversão aproximada** (assumindo objeto de ~40 células ≈ 1 m):

| `u0` | Equivalência |
|---|---|
| 0.01 | ~1.5 m/s (~5 km/h) |
| 0.05 | ~7.5 m/s (~27 km/h) |
| 0.10 | ~15.0 m/s (~54 km/h) |

### Viscosidade (`ν`)

| Fluido | Viscosidade (aprox.) |
|---|---|
| Ar | 0.010 – 0.020 |
| Água | 0.020 – 0.040 |
| Mercúrio | 0.050 – 0.080 |
| Mel | 0.100 – 0.150 |
| Óleo de Motor | 0.150 – 0.200 |

### Velocidade da Animação

Slider de 1–40 **passos por frame**. O loop roda `stepsPerFrame` passos completos do LBM antes de redesenhar, controlando o equilíbrio entre velocidade aparente e custo computacional.

---

## ⚖️ Estabilidade Numérica

O método LBM BGK monitora instabilidades verificando a cada passo:

- `ρ ≤ 0` ou `ρ` não finito
- `|ux| > 0.5` ou `|uy| > 0.5` (limite de Mach do modelo D2Q9)

Ao detectar instabilidade, a simulação pausa e oferece a opção de **resetar o fluido**.

**Para evitar instabilidade:**
- 🔽 Reduza a **velocidade do fluxo**
- 🔼 Aumente a **viscosidade**
- 🔽 Reduza o número de **passos por frame**

O parâmetro de relaxação `ω` é limitado ao intervalo `[0.01, 1.99]`:

```
ω = 1 / (3ν + 0.5)
```

Valores de `ω → 2` (viscosidade muito baixa) são numericamente instáveis; `ω → 0` (viscosidade muito alta) convergem lentamente mas sempre estáveis.

---

## 🚀 Como Executar

Este projeto é **100% client-side** — não requer nenhum servidor, build tool ou instalação.

### Opção 1 — Servidor HTTP local (recomendado)

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# PHP
php -S localhost:8080
```

Acesse `http://localhost:8080` no navegador.

### Opção 2 — Extensão "Live Server" (VS Code)

Abra a pasta no VS Code e clique em **Go Live** na barra de status.

> ⚠️ **Não abra `index.html` diretamente** pelo sistema de arquivos (`file://`). Os módulos ES (`import`/`export`) requerem um servidor HTTP real — o navegador bloqueará o carregamento por restrições de CORS.

### Requisitos de Navegador

| Navegador | Suporte |
|---|---|
| Chrome/Edge 90+ | ✅ Recomendado |
| Firefox 90+ | ✅ Suportado |
| Safari 15+ | ✅ Suportado |
| IE / Edge Legacy | ❌ Não suportado |

Requer: ES Modules, `Float32Array`, `requestAnimationFrame`, `ResizeObserver`, Canvas 2D API.

---

## 📁 Estrutura de Arquivos

```
simulacao-de-dinamica-dos-fluidos/
│
├── index.html                  # UI principal: header, sidebars, canvas, controles
├── style.css                   # Estilos customizados (tema escuro, sliders, layout)
├── main.js                     # Entry-point: instancia FluidSimulationApp
├── fluid-sim-config.json       # Configuração de exemplo (importável)
│
└── js/
    ├── FluidSimulationApp.js   # Controlador (DOM, ferramentas, undo, zoom, I/O)
    ├── FluidSolver.js          # Motor físico LBM D2Q9 (puro JS, sem DOM)
    └── Renderer.js             # Renderização Canvas 2D (offscreen ImageData)
```

### Tamanho por Módulo

| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `FluidSimulationApp.js` | ~1533 | UI, ferramentas, estado da aplicação |
| `FluidSolver.js` | ~1012 | Física LBM, rotores, traçadores |
| `Renderer.js` | ~601 | Renderização Canvas 2D |
| `index.html` | ~184 | Estrutura HTML e controles |
| `style.css` | ~380 | Estilos e tema escuro |

---

## 📚 Referências Técnicas

- **Kruger et al. (2017)** — *The Lattice Boltzmann Method: Principles and Practice* — Springer. Referência canônica para o método LBM moderno.
- **Succi, S. (2001)** — *The Lattice Boltzmann Equation for Fluid Dynamics and Beyond* — Oxford University Press.
- **Bhatnagar, Gross & Krook (1954)** — *A Model for Collision Processes in Gases* — Physical Review. Artigo original do operador BGK.
- **Ladd, A.J.C. (1994)** — *Numerical Simulations of Particulate Suspensions via a Discretized Boltzmann Equation* — Journal of Fluid Mechanics. Bounce-back e paredes em movimento no LBM.
- **Aidun & Clausen (2010)** — *Lattice-Boltzmann Method for Complex Flows* — Annual Review of Fluid Mechanics. Revisão de aplicações avançadas.

---

## 📄 Licença

Este projeto está licenciado sob os termos da **MIT License**.

```text
MIT License — Copyright (c) 2026 Leandro Veronezi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

<div align="center">

**Desenvolvido com 🌊 física real, código limpo e amor pela simulação computacional.**

[⬆️ Voltar ao topo](#-simulação-de-dinâmica-dos-fluidos)

</div>
