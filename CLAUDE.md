# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Projeto em português (pt-BR): código, comentários, commits e documentação. O README.md tem a descrição completa dos recursos (tipos de célula, ferramentas, atalhos, parâmetros).

## Visão geral

Simulador 2D de dinâmica dos fluidos (Lattice-Boltzmann D2Q9) 100% client-side: JavaScript com módulos ES, sem build e sem bundler. Para rodar, sirva a pasta por HTTP (`python3 -m http.server 8080`); abrir `index.html` via `file://` não funciona por causa dos módulos ES.

## Comandos

- `npm test` — testes do solver e dos objetos (Node puro, sem navegador): `tests/solver.test.mjs` e `tests/objetos.test.mjs`.
- `npm run test:ui` — teste de interface com Playwright (`playwright-core` + `/usr/bin/google-chrome`, caminho fixo em `tests/ui.test.mjs`). Executa um roteiro de desenho e compara o estado exportado com `tests/snapshots/ui-config.json`. Para regravar o instantâneo, só quando a mudança de comportamento for intencional: `UPDATE_SNAPSHOT=1 npm run test:ui`.
- `npm run test:all` — todos os testes.
- Um único teste: `node --test --test-name-pattern="trecho do nome" tests/solver.test.mjs`.
- Não há lint nem build.

## Arquitetura

Módulos em `js/`, carregados a partir de `main.js` (que instancia `FluidSimulationApp` em `window.__app`):

- `FluidSolver.js` — motor físico LBM, sem DOM (por isso é testável no Node). Contém também rotores/palhetas com física de corpo rígido, partículas físicas, traçadores e os tipos de célula (`FluidSolver.CELL_TYPE`). O passo da simulação é `step({ u0, viscosity, moveTracers, ... })`.
- `Renderer.js` — desenho no Canvas 2D usando `ImageData` offscreen; importa o solver para ler o estado.
- `PolygonGeometry.js` — polígonos das formas e operações booleanas (Clipper.js, global carregada por `<script>`).
- `FluidSimulationApp.js` (~1000 linhas) — núcleo do controlador: construtor, consulta ao DOM, estado, ligação dos eventos, laço de simulação e pintura.
- `app/*.js` — o resto do controlador, um arquivo por assunto (mouse, arrastos, painel de propriedades, rasterização, seleção, histórico, viewport, persistência, etc.). Cada arquivo é uma classe cujos métodos são anexados ao `FluidSimulationApp.prototype` por `applyMixin` (no fim de `FluidSimulationApp.js`), então `this` dentro deles é a instância do app. Ao criar um método novo, coloque-o no arquivo do assunto certo; `applyMixin` recusa dois métodos com o mesmo nome.

Os comentários do código citam "bugs.md #N" para itens já concluídos; o histórico está no git (commit 7fd3bfe). `bugs.md` lista só as pendências.

## Convenções que não são óbvias

- **Cache-busting manual:** os imports e o `<script>` usam `?v=20260908d` (em `index.html`, `main.js` e em todos os imports de `js/` e `js/app/`). Ao mudar o código servido ao navegador, troque esse sufixo em todos esses lugares, de forma consistente. Isso importa de verdade: os mixins de `js/app/` importam `FluidSimulationApp.js` de volta (import circular), e um sufixo diferente em um só lugar faz o navegador carregar o módulo duas vezes. `tests/versao.test.mjs` verifica a consistência.
- Os testes do solver importam `../js/FluidSolver.js` sem o sufixo `?v=`, então o solver não deve importar nada que exija DOM.
- `fluid-sim-config.json` (grande, ~1,4 MB) é um cenário exportado pelo app e está no `.gitignore`; não o edite à mão nem o commite.
