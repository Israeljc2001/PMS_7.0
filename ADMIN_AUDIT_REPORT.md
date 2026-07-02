# Relatorio de auditoria Admin - PMS J7S / SinalizaFlow

## Mapa de dependencias

| Arquivo | Funcao real | Tipo | Scripts/CSS | Globais, DOM, APIs e storage | Decisao |
| --- | --- | --- | --- | --- | --- |
| `pages/admin.html` | Shell principal do Admin com dashboard, comercial, relatorios, usuarios, configuracoes, modais e acoes master de pedidos. | Pagina principal | `sinaliza-core.js`, `admin.js`, ApexCharts, SweetAlert2, Phosphor; CSS `admin.css`. | Usa handlers globais de `admin.js`, IDs obrigatorios preservados, `sinaliza_sessao`, `theme`, `/api/*`, `SinalizaCore`, ApexCharts e Swal. | Grupo 1. Deve continuar sendo a tela principal. |
| `assets/js/pages/admin.js` | Motor do Admin: sessao, tema, pedidos, workflow, usuarios, BI comercial, relatorios, gargalos internos, modais, auditoria, bypass, acoes em massa e arquivos VPN. | Script principal | Importado por `admin.html`. | Declara `apiFetch`, `loadConfig`, `loadData`, `renderOrders`, `renderSalesDashboard`, `renderReports`, `loadUsers`, `saveConfig`, `applyBulkAction`, `abrirPreview`, `submitChangePass` e funcoes auxiliares. Usa `/api/pedidos`, `/api/config/workflow`, `/api/config/motivos`, `/api/usuarios`, `/api/change-password`, `localStorage.sinaliza_sessao`, `localStorage.theme`, `SinalizaCore`, ApexCharts, Swal. | Grupo 1. Consolidado sem alterar endpoints. |
| `assets/css/admin.css` | Tema visual do Admin no padrao SinalizaFlow, herdando `global.css`, com sidebar, topbar, cards, dark mode, modais e views internas. | CSS principal | `@import './global.css'`. | Formata IDs/classes do Admin e agora oculta atalhos legados externos. | Grupo 1. Mantido e ampliado. |
| `pages/dashboard-comercial.html` | Dashboard comercial standalone com KPIs e graficos de vendas. | Pagina auxiliar/legada | `sinaliza-core.js`, ApexCharts, SweetAlert2, Phosphor; CSS inline. | Usa `sinaliza_sessao`, `theme`, `/api/config/workflow`, `/api/pedidos`, ApexCharts. IDs de graficos tambem existem no Admin. | Grupo 2. Ja incorporado em `view-sales`; manter como legado/fallback. |
| `pages/relatorios.html` | Relatorios operacionais standalone por setor usando `shared-report.js`. | Pagina auxiliar/legada | `shared-report.js`, `sinaliza-core.js`, Phosphor; CSS inline. | Usa `sinaliza_sessao`, `theme`, `fetchWorkflowAndOrders`, IDs proprios de relatorio. | Grupo 2. Parte ja incorporada em `view-reports`; manter como fallback. |
| `pages/gargalos.html` | Analise standalone de lead time bruto, ocorrencias e retornos. | Pagina auxiliar/legada | `shared-report.js`, `sinaliza-core.js`, Phosphor; CSS inline. | Usa `sinaliza_sessao`, `theme`, `fetchWorkflowAndOrders`, `search-input`, `filter-errors`, `orders-list`, `dashboard-kpis`. | Grupo 2. Motor portado para `view-gargalos` com IDs proprios. |
| `pages/usuarios.html` | CRUD standalone de usuarios. | Pagina auxiliar/legada | `sinaliza-core.js`, SweetAlert2, Phosphor; CSS inline. | Usa `/api/usuarios`, `sinaliza_sessao`, `theme`, Swal. Duplicado com `loadUsers/saveUser/deleteUser` do Admin. | Grupo 2. Funcionalidade ja no Admin; manter como fallback. |
| `pages/configuracoes.html` | Configuracao standalone de workflow e motivos. | Pagina auxiliar/legada | `sinaliza-core.js`, SweetAlert2, Phosphor; CSS inline. | Usa `/api/config/workflow`, `/api/config/motivos`, `sinaliza_sessao`, `theme`, Swal. Duplicado com `loadConfig/saveConfig/renderReasonsConfig` do Admin. | Grupo 2. Funcionalidade ja no Admin; manter como fallback. |
| `pages/monitoramento-executivo.html` | Auditoria executiva standalone, mais proxima de diretoria/BI do que Admin operacional. | Pagina separada | `shared-report.js`, `sinaliza-core.js`, SweetAlert2, Phosphor; CSS inline. | Usa `sinaliza_sessao`, `fetchWorkflowAndOrders`, Swal. | Grupo 3. Manter separada por escopo executivo. |
| `pages/relatorios-executivo.html` | Relatorios executivos com ApexCharts e tabs por setor. | Pagina separada | `shared-report.js`, `sinaliza-core.js`, ApexCharts, SweetAlert2, Phosphor; CSS inline. | Usa `sinaliza_sessao`, ApexCharts, Swal. | Grupo 3. Manter separada por logica executiva/graficos proprios. |
| `assets/js/core/shared-report.js` | Funcoes compartilhadas de relatorios: parse de historico, status seguro, lead time, fetch workflow/pedidos. | Core compartilhado | Nenhum import. | Declara `API_URL = '/api'`, `fetchWorkflow`, `fetchOrders`, `fetchWorkflowAndOrders`, `formatLeadTime`, `formatAvgTime`. | Grupo 3/core. Nao mover agora para nao quebrar paginas legadas. |
| `assets/js/core/sinaliza-core.js` | Core global: VPN, SLA, workflow anterior/proximo e payload de timestamps. | Core compartilhado | Nenhum import. | Expõe `SinalizaCore`; usa VPN `http://192.168.2.41:3001/api/pedidos/:id/files`. | Grupo 3/core. Preservado. |
| `assets/js/pages/index.js` | Login, reset de senha, roteamento pos-login. | Auth/entrada | Importado por `index.html`. | Usa `/api/login`, `/api/request-password-reset`, `/api/reset-password`, `sinaliza_sessao`, Swal. | Grupo 3. Nao consolidar no Admin. |
| `assets/js/auth/layout-auth.js` | Protecao simples de sessao/role para Layout. | Auth auxiliar | Nenhum. | Usa `sinaliza_sessao`. | Grupo 3. Fora do Admin. |
| `assets/css/global.css` | Design system global: variaveis, cards, tabelas, modais, dark mode, helpers. | CSS core | Importado por CSS setoriais. | Define `.hidden`, `.list-row`, `.card-details`, modal base, tabelas e tokens visuais. | Grupo 3/core. Preservado. |

## Duplicacoes encontradas

- Tema e logout: `toggleTheme`, `loadTheme`, `updateThemeIcon`, `logout` existem em Admin e paginas standalone.
- Fetch API: `apiFetch` duplicado em Admin, Usuarios e Configuracoes.
- Usuarios: `loadUsers`, `openUserModal`, `saveUser`, `deleteUser`, `togglePassword` duplicados em `admin.js` e `usuarios.html`.
- Configuracoes: `loadConfig`, `renderConfigTable`, `renderReasonsConfig`, `addStep`, `rmStep`, `addReason`, `removeReason`, `saveConfig` duplicados em `admin.js` e `configuracoes.html`.
- Comercial: `renderSalesDashboard`, `renderSalesCharts`, filtros e KPIs duplicados entre Admin e `dashboard-comercial.html`.
- Relatorios/gargalos: calculos de lead time e normalizacao existem em `shared-report.js`, paginas standalone e Admin.

## Problemas encontrados

- A sidebar do Admin misturava views internas com atalhos para paginas separadas, criando navegacao visual desordenada.
- `gargalos.html` usava IDs genericos como `search-input`, arriscando colisao se copiado integralmente para `admin.html`.
- Paginas auxiliares usam CSS inline/standalone, por isso podem parecer fora do padrao SinalizaFlow aprovado.
- `admin.css` contem muitas camadas historicas e repeticoes de regras, o que aumenta risco de regressao visual.
- Algumas funcionalidades criticas estavam duplicadas, mas com pequenas diferencas de comportamento; por isso nao foram removidas agressivamente.

## Ajuste aplicado

- `Análise de Gargalos` virou view interna do Admin: `view-gargalos`.
- Foram criados IDs proprios para gargalos: `gargalos-kpi-container`, `gargalos-search-input`, `gargalos-filter-errors`, `gargalos-orders-list`.
- A sidebar principal fica ordenada por views internas; atalhos legados foram escondidos no CSS, sem remover as paginas antigas.
- O motor de gargalos foi incorporado em `admin.js` com nomes isolados: `processAdminBottlenecks`, `renderAdminBottleneckList`, `toggleAdminBottleneckCard`.
- IDs e modais obrigatorios do Admin foram preservados.

## Estrutura final sugerida

Manter por enquanto a estrutura atual, sem mover arquivos fisicamente:

```text
pages/admin.html
assets/css/admin.css
assets/js/pages/admin.js
assets/js/core/shared-report.js
assets/js/core/sinaliza-core.js
assets/js/pages/index.js
assets/js/auth/layout-auth.js
```

Proxima etapa segura, se desejado:

```text
assets/js/pages/admin-modules/
    admin-dashboard.js
    admin-comercial.js
    admin-relatorios.js
    admin-gargalos.js
    admin-usuarios.js
    admin-configuracoes.js
```

Essa modularizacao deve ser feita depois de testes funcionais com API real, porque `admin.js` ainda compartilha muito estado global entre pedidos, workflow, usuarios, graficos e modais.
