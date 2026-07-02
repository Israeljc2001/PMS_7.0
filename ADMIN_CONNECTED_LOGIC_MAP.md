# Mapa de logica conectada ao Admin

Este mapa foca nas paginas que aparecem como area administrativa ou BI administrativo e como elas se relacionam hoje com `pages/admin.html` e `assets/js/pages/admin.js`.

## Resumo rapido

| Pagina | Papel atual | Equivalente no Admin | Situacao recomendada |
| --- | --- | --- | --- |
| `pages/dashboard-comercial.html` | Dashboard comercial standalone. | `#view-sales` + `renderSalesDashboard()` + `renderSalesCharts()`. | Pode virar apenas legado/fallback. |
| `pages/relatorios.html` | Relatorios Master standalone. | `#view-reports` + `renderReports()`. | Pode virar apenas legado/fallback. |
| `pages/gargalos.html` | Analise standalone de gargalos/lead time bruto. | `#view-gargalos` + `processAdminBottlenecks()` + `renderAdminBottleneckList()`. | Ja pode operar como view interna do Admin. |
| `pages/usuarios.html` | CRUD standalone de utilizadores. | `#view-users` + `loadUsers()` + `saveUser()` + `deleteUser()`. | Pode virar apenas legado/fallback. |
| `pages/configuracoes.html` | Workflow e motivos standalone. | `#view-conf` + `loadConfig()` + `saveConfig()` + `renderConfigTable()` + `renderReasonsConfig()`. | Pode virar apenas legado/fallback. |
| `pages/monitoramento-executivo.html` | Auditoria executiva. | Parcialmente relacionado a gargalos, mas com foco executivo. | Melhor manter separado. |
| `pages/relatorios-executivo.html` | BI executivo com ApexCharts por setor. | Relacionado a relatorios, mas com experiencia propria. | Melhor manter separado. |
| `pages/diretoria.html` | Painel de diretoria. | Nao e modulo Admin, mas navega para Admin/relatorios/usuarios. | Manter separado. |
| `pages/metas-comercial.html` | Metas comerciais. | Relacionado a Comercial/BI. | Manter separado. |

## `dashboard-comercial.html`

Logica real:
- Carrega sessao por `localStorage.getItem('sinaliza_sessao')`.
- Usa `API_URL = '/api'`.
- Busca `/api/config/workflow` e `/api/pedidos`.
- Normaliza pedidos para dados comerciais.
- Popula filtro de periodo e vendedor.
- Calcula vendas totais, faturado/concluido, ticket medio e lista detalhada.
- Renderiza graficos ApexCharts em `chart-payment`, `chart-clients`, `chart-status`, `chart-daily`.
- Controla tema por `localStorage.theme`.

Funcoes principais:
- `loadData()`
- `populateSalesPersonFilter()`
- `getFilteredSalesData()`
- `renderSalesDashboard()`
- `renderSalesCharts()`
- `toggleTheme()`, `loadTheme()`, `logout()`

Como o Admin usa hoje:
- A mesma logica existe em `assets/js/pages/admin.js` nas funcoes `renderSalesDashboard()` e `renderSalesCharts()`.
- A view interna correspondente e `#view-sales`.
- Os IDs sao os mesmos: `sales-period-filter`, `sales-person-filter`, `sales-kpi-container`, `chart-payment`, `chart-clients`, `chart-status`, `chart-daily`, `sales-table-body`.

Risco:
- Se editar a formula comercial em uma pagina e nao na outra, os numeros podem divergir.

## `relatorios.html`

Logica real:
- Usa `shared-report.js` para buscar workflow e pedidos.
- Busca dados via `fetchWorkflowAndOrders()`.
- Processa estatisticas de Layout, PCP, Producao, Faturamento e Comercial.
- Calcula lead time, motivos, retornos, entregas por usuario e funil por setor.
- Renderiza cards e tabelas no container `sectors-container`.
- Controla sessao e tema.

Funcoes principais:
- `loadData()`
- `processReportsData()`
- `renderSectors()`
- `getFriendlyMonth()`
- `toggleTheme()`, `loadTheme()`, `logout()`

Como o Admin usa hoje:
- A logica equivalente fica em `renderReports()` dentro de `admin.js`.
- A view interna correspondente e `#view-reports`.
- O Admin usa IDs especificos: `report-lay-funnel`, `report-lay-users`, `report-lay-reasons`, `report-prod-users`, `report-prod-reasons`, `report-pcp-body`, `report-fat-body`, `report-sales-body`.

Risco:
- `relatorios.html` e `admin.js` nao compartilham exatamente o mesmo renderer. Consolidar exige comparar metricas antes de apagar a pagina.

## `gargalos.html`

Logica real:
- Usa `shared-report.js` e `sinaliza-core.js`.
- Busca workflow e pedidos com `fetchWorkflowAndOrders()`.
- Filtra pedidos concluídos/faturados.
- Reconstroi o tempo bruto por setor a partir do historico (`from`, `to`, `date`).
- Separa tempos de Layout, PCP, Fabrica/Producao e Faturamento.
- Detecta ocorrencias por palavras-chave no historico: devolucao, retorno, reprovacao, problema, estendido, justificativa.
- Renderiza KPIs de lead time medio e lista de auditoria.

Funcoes principais:
- `loadData()`
- `processLeadTimeBruto()`
- `renderAuditoriaList()`
- `toggleTheme()`, `loadTheme()`, `logout()`

Como o Admin usa hoje:
- A logica foi portada para `admin.js` com nomes isolados:
  - `processAdminBottlenecks()`
  - `renderAdminBottleneckList()`
  - `toggleAdminBottleneckCard()`
- A view interna correspondente e `#view-gargalos`.
- IDs proprios foram usados para evitar colisao com o dashboard principal:
  - `gargalos-kpi-container`
  - `gargalos-search-input`
  - `gargalos-filter-errors`
  - `gargalos-orders-list`

Risco:
- `gargalos.html` usa IDs genericos como `search-input`, `filter-errors`, `orders-list`; por isso nao deve ser copiado literalmente para dentro do `admin.html`.

## `usuarios.html`

Logica real:
- Protege acesso por `sinaliza_sessao` e role admin.
- Usa `API_URL = '/api'`.
- Busca usuarios em `/api/usuarios`.
- Cria/atualiza usuario por `POST /api/usuarios`.
- Se alterar login, apaga o usuario antigo com `DELETE /api/usuarios/:originalUser`.
- Exclui usuario com `DELETE /api/usuarios/:u`.
- Usa SweetAlert2 para avisos, confirmacoes e erros.
- Mostra/oculta senha por linha.

Funcoes principais:
- `apiFetch()`
- `loadUsers()`
- `togglePassword()`
- `openUserModal()`
- `saveUser()`
- `deleteUser()`
- `toggleTheme()`, `loadTheme()`, `logout()`

Como o Admin usa hoje:
- As mesmas responsabilidades estao em `admin.js`:
  - `loadUsers()`
  - `togglePassword()`
  - `openUserModal()`
  - `saveUser()`
  - `deleteUser()`
- A view interna correspondente e `#view-users`.
- O modal correspondente e `#userModal`.

Risco:
- CRUD duplicado. Alteracoes de regra de usuario devem ser feitas no Admin e depois replicadas/removidas da pagina legada.

## `configuracoes.html`

Logica real:
- Protege acesso por `sinaliza_sessao` e role admin.
- Usa `API_URL = '/api'`.
- Busca workflow em `/api/config/workflow`.
- Busca motivos em `/api/config/motivos`.
- Renderiza tabela editavel de workflow: nome, role, SLA, retorno.
- Renderiza motivos por setor.
- Salva workflow e motivos por `POST /api/config/workflow` e `POST /api/config/motivos`.
- Usa SweetAlert2 para confirmacoes.

Funcoes principais:
- `apiFetch()`
- `loadConfig()`
- `renderConfigTable()`
- `addStep()`
- `rmStep()`
- `updStep()`
- `renderReasonsConfig()`
- `addReason()`
- `removeReason()`
- `saveConfig()`
- `toggleTheme()`, `loadTheme()`, `logout()`

Como o Admin usa hoje:
- As mesmas responsabilidades estao em `admin.js`:
  - `loadConfig()`
  - `renderConfigTable()`
  - `renderReasonsConfig()`
  - `addStep()`
  - `rmStep()`
  - `updStep()`
  - `addReason()`
  - `removeReason()`
  - `saveConfig()`
- A view interna correspondente e `#view-conf`.
- IDs correspondentes: `config-body`, `reasons-container`.

Risco:
- Configuracao de workflow e motivos impacta todos os setores. Nao remover a pagina antiga antes de testar salvamento real no Admin.

## Paginas executivas relacionadas

### `monitoramento-executivo.html`

Logica:
- Usa `shared-report.js`.
- Busca workflow e pedidos.
- Gera auditoria executiva e lista filtravel.
- Usa `search-input`, `filter-errors`, `orders-list`, mas no contexto executivo.

Decisao:
- Nao consolidar automaticamente no Admin. Ela pertence mais ao pacote Diretoria/Executivo.

### `relatorios-executivo.html`

Logica:
- Usa `shared-report.js`.
- Usa ApexCharts.
- Tem abas por setor: Layout, PCP, Fabrica, Emissao.
- Calcula lead time e rankings de forma executiva.

Decisao:
- Manter separada, porque tem visual, graficos e escopo diferente dos relatorios master do Admin.

### `diretoria.html`

Logica:
- Painel de diretoria com KPIs financeiros/funil e ApexCharts.
- Busca `/api/config/workflow` e `/api/pedidos`.
- Navega para `admin.html`, `relatorios.html`, `usuarios.html`.

Decisao:
- Manter separada, mas revisar links futuramente para apontar preferencialmente ao Admin consolidado quando fizer sentido.

### `metas-comercial.html`

Logica:
- BI de metas comerciais.
- Busca workflow e pedidos.
- Alterna perspectiva entre vendas e faturado.
- Navega para Admin e Dashboard Comercial.

Decisao:
- Manter separada por ser BI comercial/diretoria, nao administracao operacional.

## Como estamos usando na sidebar atual do Admin

A sidebar principal do `admin.html` agora esta organizada assim:

1. `Visao Geral` -> `switchView('dash')` -> `#view-dash`
2. `Gestao Comercial` -> `switchView('sales')` -> `#view-sales`
3. `Relatorios Master` -> `switchView('reports')` -> `#view-reports`
4. `Analise de Gargalos` -> `switchView('gargalos')` -> `#view-gargalos`
5. `Utilizadores` -> `switchView('users')` -> `#view-users`
6. `Configuracoes` -> `switchView('conf')` -> `#view-conf`

Os links antigos para `dashboard-comercial.html`, `relatorios.html`, `usuarios.html` e `configuracoes.html` ainda existem no HTML como `legacy-page-links`, mas estao ocultos no CSS para preservar fallback sem poluir a navegacao principal.

## Proxima consolidacao segura

1. Comparar numeros do `dashboard-comercial.html` contra `#view-sales`.
2. Comparar numeros de `relatorios.html` contra `#view-reports`.
3. Comparar `gargalos.html` contra `#view-gargalos`.
4. Testar CRUD de usuarios no Admin contra `usuarios.html`.
5. Testar salvamento de workflow/motivos no Admin contra `configuracoes.html`.
6. Depois dos testes, transformar paginas legadas em redirecionamentos para `admin.html` com parametro de view, por exemplo:

```text
admin.html?view=sales
admin.html?view=reports
admin.html?view=gargalos
admin.html?view=users
admin.html?view=conf
```
