# Resumo da Migração PPV - Apps Script → Next.js

## Contexto
Sistema de gestão de vendas (PPV) da **Nova Tratores**, migrado de Google Apps Script + HTML/jQuery para **Next.js 16 + TypeScript + Tailwind CSS 4**.

O sistema original era dividido em 3 arquivos:
- **Frontend**: HTML com jQuery, CSS inline, modais manuais
- **Backend**: Google Apps Script com `google.script.run` chamando Supabase via `UrlFetchApp`
- **Template**: HTML de impressão/PDF (TemplateVisualizacao)

---

## Funcionalidades migradas (todas mantidas)
- Kanban board com 5 colunas (Aguardando, Em Andamento, Aguar. Faturar, Fechado, Cancelado)
- Formulário de novo lançamento (PPV/REM)
- Busca de clientes (apenas Omie)
- Busca de Ordens de Serviço (com serviço solicitado)
- Busca de produtos (Completos + Manuais)
- Criação/edição de produto manual
- Importação de kit de revisão (por trator + horas)
- Modal de detalhes com edição completa (status, técnico, OS, tipo, motivo)
- Adição de itens extras no modal
- Devolução de itens (com saldo parcial/total)
- Histórico de ações (logs)
- Geração de PDF/impressão (template A4 estilo profissional com dados do cliente)
- Vínculo PPV ↔ Ordem de Serviço (bidirecional)
- Atualização automática do valor total após movimentações
- Auto-refresh do kanban a cada 60s
- Filtro por texto (cliente, ID, técnico), por status (Ativos/Fechados/Todos), por técnico e por cliente
- **Catálogo de Peças** — busca de peças de tratores via CSV (~33K linhas) com filtros cascata
- **Dados do Cliente** — CNPJ/CPF, endereço e cidade exibidos em tempo real (read-only, do Omie)
- **Troca de Cliente** — possibilidade de alterar cliente em pedidos existentes
- **Integração Omie** — envio de Pedido de Venda para o ERP Omie diretamente do sistema
- **Sincronização OS → PPV** — status do PPV acompanha automaticamente o status da OS vinculada

---

## Estrutura de arquivos criada

```
app/
├── globals.css                          ← Tailwind + tema vermelho/laranja/creme + classes ppv-* e ppv-form-*
├── layout.tsx                           ← Layout raiz (Poppins + FontAwesome)
├── page.tsx                             ← Página principal (compõe tudo com PPVProvider)
│
├── lib/
│   ├── types.ts                         ← Todos os tipos TypeScript do sistema
│   ├── constants.ts                     ← Tabelas Supabase, cores, opções de select, magic strings
│   ├── utils.ts                         ← normalizarStatus, formatarDataFrontend, formatarMoeda
│   ├── supabase.ts                      ← Helper fetch Supabase (server-side, lê .env.local)
│   ├── queries.ts                       ← Funções compartilhadas server-side (ZERO duplicação)
│   ├── schemas.ts                       ← Schemas Zod para validação das API routes
│   ├── api.ts                           ← Camada client-side tipada (api.buscarClientes, etc.)
│   ├── omie.ts                          ← Integração Omie (Pedido de Venda, lookup cliente/vendedor/produto)
│   └── PPVContext.tsx                    ← Context global (tecnicos, kanban, toast, cache, loader)
│
├── api/
│   ├── clientes/route.ts                ← GET busca clientes (apenas Omie)
│   ├── cliente-dados/route.ts           ← GET dados do cliente por nome (documento, endereço, cidade)
│   ├── produtos/route.ts                ← GET busca + POST salvar produto manual
│   ├── ordens-servico/route.ts          ← GET busca OS
│   ├── pedidos/route.ts                 ← GET listar/buscar + POST criar + PATCH editar
│   ├── pedidos/omie/route.ts            ← POST enviar PPV para Omie (cria Pedido de Venda)
│   ├── movimentacoes/route.ts           ← POST registrar saída ou devolução
│   ├── dados-iniciais/route.ts          ← GET técnicos + opções de revisão
│   ├── revisoes/route.ts                ← GET itens do kit de revisão
│   ├── logs/route.ts                    ← GET histórico por ID
│   ├── pdf/route.ts                     ← GET gerar HTML de impressão (template Montserrat, laranja)
│   └── pecas/route.ts                   ← GET catálogo de peças (CSV, filtros, paginação)
│
└── components/
    ├── Header.tsx                        ← Barra de busca + filtros (só aparece no Kanban)
    ├── Toast.tsx                         ← Notificação temporária (sucesso/erro)
    ├── GlobalLoader.tsx                  ← Tela de carregamento
    ├── PhaseView.tsx                     ← Kanban por fases com tabs + skeleton loading + MiniCard memo
    ├── FormNovoLancamento.tsx            ← Form 2 colunas (campos + carrinho) com validação e grades pretas
    ├── PPVDrawer.tsx                     ← Modal centralizado de detalhes (dados + itens + histórico + log panel)
    ├── ModalBuscaCliente.tsx             ← Modal de busca de clientes (auto-load, filtro local, highlight)
    ├── ModalBuscaOS.tsx                  ← Modal de busca de Ordens de Serviço
    ├── ModalBuscaProduto.tsx             ← Modal de busca de produtos (inclui modo editar)
    ├── ModalProdutoManual.tsx            ← Modal criar/editar produto manual
    ├── ModalDevolucao.tsx                ← Popup de devolução (slider + botões ±0.5)
    └── CatalogoPecas.tsx                ← Catálogo de peças com filtros cascata + paginação
```

---

## Mapeamento: google.script.run → API Routes

| Função original (Apps Script)          | API Route Next.js                  | Método |
|----------------------------------------|------------------------------------|--------|
| `buscarClientesSupabase(termo)`        | `/api/clientes?termo=X`           | GET    |
| —                                      | `/api/cliente-dados?nome=X`       | GET    |
| `buscarProdutosSupabase(termo)`        | `/api/produtos?termo=X`           | GET    |
| `salvarProdutoManual(dados)`           | `/api/produtos`                   | POST   |
| `buscarOrdensServicoSupabase(termo)`   | `/api/ordens-servico?termo=X`     | GET    |
| `getDadosIniciaisComRevisao()`         | `/api/dados-iniciais`             | GET    |
| `getItensDaRevisao(trator, horas)`     | `/api/revisoes?trator=X&horas=Y`  | GET    |
| `listarDocumentosKanban()`             | `/api/pedidos`                    | GET    |
| `getPPVPorId(id)`                      | `/api/pedidos?id=X`               | GET    |
| `salvarGerarPDF(dados)`               | `/api/pedidos`                    | POST   |
| `salvarEdicaoPPV(dados)`              | `/api/pedidos`                    | PATCH  |
| `registrarNovaSaida(dados)`            | `/api/movimentacoes`              | POST   |
| `registrarDevolucao(dados)`            | `/api/movimentacoes`              | POST   |
| `getHistoricoPorId(id)`               | `/api/logs?id=X`                  | GET    |
| `TemplateVisualizacao` (HTML)          | `/api/pdf?id=X`                   | GET    |
| —                                      | `/api/pecas?...`                  | GET    |
| —                                      | `/api/pedidos/omie`               | POST   |

---

## Refatorações / Melhorias aplicadas (2ª etapa)

### 1. Segurança - Chaves em `.env.local`
- `SUPABASE_URL` e `SUPABASE_KEY` removidos do código-fonte
- `.env.local` criado (protegido por `.gitignore`)
- `supabase.ts` lê de `process.env` com validação (erro claro se não configurado)
- `OMIE_APP_KEY` e `OMIE_APP_SECRET` também em `.env.local`

### 2. Eliminação de duplicação - `lib/queries.ts`
- `buscarPPVPorId` existia em 3 arquivos → agora em 1 só
- `atualizarValorTotal` existia em 2 arquivos → centralizado
- `registrarLog` existia em 2 arquivos → centralizado
- `vincularPPVnaOS` existia em 2 arquivos → centralizado
- `gerarProximoId` → centralizado
- `montarDadosParaImpressao` → centralizado
- `buscarDadosCliente` → centralizado (busca CNPJ, endereço, cidade do Omie)
- `sincronizarStatusComOS` → sync automático OS→PPV

### 3. API client tipada - `lib/api.ts`
- Todos os `fetch()` crus substituídos por funções tipadas
- Exemplo: `api.buscarClientes(termo)` retorna `Promise<ClienteBusca[]>`
- `api.buscarClientePorNome(nome)` retorna `Promise<{ documento, endereco, cidade }>`
- `api.enviarParaOmie(id)` retorna `Promise<{ success, numeroPedido }>`
- Se URL base mudar, muda em 1 lugar só

### 4. Context global - `lib/PPVContext.tsx`
- Dados compartilhados via `usePPV()`: tecnicos, opcoesRevisao, kanbanItems, productCache, toast, globalLoading
- `atualizarKanbanLocal()` para updates otimistas
- Reduziu prop drilling significativamente

### 5. Validação Zod - `lib/schemas.ts`
- `criarPedidoSchema` - campos obrigatórios, tipos, defaults
- `editarPedidoSchema` - valida ID, status, tecnico, cliente (opcional)
- `movimentacaoSchema` - enum para tipo de movimento (Saída | Devolução)
- `produtoManualSchema` - código e descrição não-vazios
- `buscaTermoSchema` / `buscaTermoOSSchema` - mínimo de caracteres

### 6. Constantes para magic strings
- `MOV_SAIDA = "Saída"` e `MOV_DEVOLUCAO = "Devolução"` em constants.ts
- `TBL_TECNICOS = "Tecnicos_Appsheet"` (corrigido de "Tecnicos")

---

## Integração Omie (4ª etapa)

### Arquivo: `lib/omie.ts`
Integração completa com o ERP Omie para criação de Pedidos de Venda.

- **`omieCall<T>()`** — client genérico da API Omie com retry automático em rate limit (429)
- **`buscarNcodCli()`** — lookup de cliente por CNPJ (cache Supabase → fallback API Omie)
- **`buscarNcodVend()`** — lookup de vendedor/técnico por nome (normalização de acentos)
- **`buscarCodigoProdutoOmie()`** — lookup de produto via ConsultarProduto
- **`enviarPPVParaOmie()`** — função principal:
  1. Valida status ("Aguardando Para Faturar") e ausência de pedido Omie existente
  2. Busca CNPJ do cliente (match exato → parcial na tabela Clientes)
  3. Agrega produtos (saídas - devoluções = quantidade líquida)
  4. Cria Pedido de Venda via `IncluirPedido` (etapa "10" = Aprovado)
  5. Atualiza PPV: salva `pedido_omie` + muda status para "Fechado"
  6. Registra log

### Endpoint: `POST /api/pedidos/omie`
- Recebe `{ id: string }`, chama `enviarPPVParaOmie()`
- Retorna `{ success: true, numeroPedido }` ou `{ error }` com status 400/500

### Botão na UI
- Botão verde "Enviar para Omie" no footer do PPVDrawer
- Visível apenas quando `status === "Aguardando Para Faturar"` e `!pedidoOmie`

---

## Sincronização automática OS → PPV (5ª etapa)

### Função: `sincronizarStatusComOS()` em `queries.ts`
Roda automaticamente (em background, não-bloqueante) a cada carregamento do kanban.

### Mapeamento de status:

| Status da OS | Status do PPV |
|---|---|
| Execução, Execução Procurando peças, Execução aguardando peças... | **Em Andamento** |
| Executada, Executada aguardando cliente, Executada aguardando comercial | **Aguardando Para Faturar** |
| Orçamento, Aguardando ordem Técnico, Aguardando outros | **Aguardando** |

### Regras:
- PPVs com status **Fechado** ou **Cancelado** nunca são alterados (terminais)
- PPVs sem OS vinculada não são afetados
- Cada mudança automática é registrada no log: `"Status auto-sync: X → Y (OS 123: 'status da OS')"`
- Executa fire-and-forget no GET /api/pedidos (não bloqueia resposta)

---

## Otimizações de Performance (6ª etapa)

### 1. Sync OS→PPV não-bloqueante
- `sincronizarStatusComOS()` roda em background (fire-and-forget)
- GET /api/pedidos retorna dados imediatamente

### 2. Select de colunas no Supabase
- Antes: `select=*` (todos os campos)
- Depois: `select=id_pedido,cliente,tecnico,...` (só o necessário)

### 3. Updates otimistas no kanban
- Ao trocar status pelo dropdown, o card atualiza na UI instantaneamente
- Se der erro na API, reverte automaticamente
- `atualizarKanbanLocal()` no PPVContext

### 4. Drawer só recarrega kanban quando necessário
- Flag `drawerDirty` marca quando houve alteração (salvar/adicionar/devolver/enviar Omie)
- Se só abriu pra olhar e fechou, não recarrega

### 5. Skeleton loading
- 6 cards fantasma com animação pulse enquanto carrega pela primeira vez
- `SkeletonCards` component em PhaseView

### 6. Init paralelo
- `getDadosIniciais()` e `listarPedidos()` rodam em paralelo com `Promise.all`

### 7. MiniCard com `React.memo`
- Evita re-render de cards que não mudaram quando o kanban atualiza

---

## Template PDF (estilo profissional)

### Design
- **Fonte**: Montserrat (Google Fonts) — mesmo estilo do POS
- **Cor primária**: Laranja escuro `#C2410C` (diferencia do POS que usa azul `#1E3A5F`)
- **Layout**: Grid-based com `.info-grid` (3 colunas), `.cost-table` para itens
- **Header**: Nome da empresa (20pt) + número do PPV (28pt) + badge de status
- **Total**: Borda laranja 2.5px + valor em 22pt bold
- **Devoluções**: Em vermelho itálico na coluna Dev.

---

## Redesign de UX (3ª etapa)

### 1. FormNovoLancamento - Layout 2 colunas, tela única
**Antes**: Wizard de 3 steps (Documento → Produtos → Revisão) — lento, muitos cliques.
**Depois**: Tela única com 2 colunas lado a lado.

- **Coluna esquerda (460px, scroll)**: Campos com grades pretas (`#1E293B`):
  - Tipo + Motivo (selects lado a lado)
  - Técnico (select dropdown da tabela `Tecnicos_Appsheet`)
  - Cliente (picker-button com dados read-only do Omie)
  - O.S. (picker-button opcional)
  - Observações (textarea)
  - Kit de Revisão (modelo + horas + importar)
  - Busca produto (picker separado) + Qtd + Botão Adicionar (linha própria, nunca some)
- **Coluna direita (flex, sempre visível)**: Carrinho com grades pretas:
  - Lista com edição inline de quantidade (+/-)
  - Animação ao adicionar (highlight verde) e remover (slide-out)
  - Auto-scroll para item recém-adicionado
  - Total + botão "Finalizar Lançamento" fixos no rodapé do carrinho
- **Validação**: `tentouEnviar` state — bordas vermelhas + mensagens inline no submit
- **CSS dedicado**: Classes `ppv-form-*` com bordas `#1E293B`, fontes 15px, labels 14px bold

### 2. PPVDrawer - Modal centralizado com log panel lateral
**Antes**: Painel lateral (780px) com 3 abas.
**Depois**: Modal centralizado (920px, expande para 1240px com logs) com scroll vertical.

- **Header sticky**: ID + badge de status colorido + botões Imprimir/Log/Fechar
- **Summary card**: Gradiente vermelho com cliente, total, técnico, data, tipo
- **Cards com grades pretas** (`#1E293B`):
  - Status (select + campos condicionais Fechado/Cancelado)
  - Cliente (nome grande + CNPJ/cidade/endereço read-only + botão "Trocar")
  - Pedido (técnico, tipo, motivo, OS vinculada)
  - Observações (textarea)
  - Itens & Materiais (adicionar + lista com progress bar + devolução)
- **Total bar**: Fundo escuro com saídas/devoluções + total grande
- **Footer sticky**: Cancelar + Enviar para Omie (verde, condicional) + Salvar
- **Log Panel**: Painel lateral (320px) desliza da direita com histórico

### 3. Visual geral
- **Overlay do modal**: `rgba(15, 23, 42, 0.6)` — neutro escuro, sem blur (evita tom avermelhado)
- **Grades/bordas internas**: `#1E293B` (preto-azulado) nos cards do modal e no formulário
- **Esquema de cores**:
  - Vermelho (`red-600/700/900`): Sidebar, botões principais, totais, badges
  - Laranja (`orange-200/300/400/500`): Bordas externas, ícones, labels, botões secundários
  - Fundo creme (`#FEF5EE` / `#FFFAF5`): Background geral, cards, painéis
  - Catálogo: Tema vermelho escuro (`red-950`)
- Header de filtros só aparece na aba Kanban (escondido no Catálogo e Form)

### 4. Catálogo de Peças
- Fonte de dados: arquivo CSV `pecazetec.csv` (~33K linhas) parseado server-side com cache em memória
- API: `/api/pecas` com suporte a filtros e paginação (50 itens/página)
- Filtros cascata: Catálogo → Seção → Conjunto → Tipo
- Busca por código ou nome da peça
- Tabela com 8 colunas: código, nome, catálogo, seção, conjunto, ref, qtd, tipo
- Tema escuro (vermelho escuro) diferenciado do resto do sistema

### 5. Acessibilidade para usuários mais velhos
- Fontes maiores em todo o sistema (15px inputs, 14px labels)
- Botões maiores (py-3/py-4)
- Inputs com padding generoso
- Pickers que parecem campos (clicáveis, com ícone e feedback visual)

---

## Dados do Cliente - Fluxo

Os dados do cliente (CNPJ/CPF, endereço, cidade) **NÃO são armazenados nos pedidos**. São buscados em tempo real da tabela `Clientes` (Omie):

1. O pedido armazena apenas `cliente` (nome) no Supabase
2. Ao exibir detalhes (PPVDrawer, FormNovoLancamento, PDF), o sistema busca via `/api/cliente-dados?nome=X`
3. Server-side: `buscarDadosCliente()` em `queries.ts` faz match exato por `nome_fantasia` → `razao_social` → busca parcial `ilike`
4. Campos são read-only na interface — alteração só via "Trocar Cliente" (busca novo cliente Omie)
5. Clientes manuais foram removidos — sistema usa apenas Omie

---

## Banco de dados (Supabase - não alterado)

| Tabela              | Uso                              |
|---------------------|----------------------------------|
| `pedidos`           | Cabeçalho dos pedidos/remessas   |
| `movimentacoes`     | Saídas e devoluções de produtos  |
| `Produtos_Completos`| Produtos do estoque (Omie)       |
| `Produtos_Manuais`  | Produtos criados manualmente     |
| `Clientes`          | Clientes do Omie (nome, CNPJ, endereço, cidade, estado) |
| `Tecnicos_Appsheet` | Lista de técnicos/vendedores     |
| `revisoes`          | Kits de revisão por trator/horas |
| `Ordem_Servico`     | Ordens de serviço (vínculo OS↔PPV)|
| `logs_ppv`          | Histórico de ações               |

---

## Como rodar

```bash
# Instalar dependências
npm install

# Configurar variáveis (já criado .env.local)
# SUPABASE_URL=https://...
# SUPABASE_KEY=sb_...
# OMIE_APP_KEY=...
# OMIE_APP_SECRET=...

# Desenvolvimento
npm run dev

# Build produção
npm run build && npm start
```

---

## Problemas conhecidos / Troubleshooting

### "Failed to fetch" / TypeError ao clicar em pedido ou carregar kanban
- **Causa**: O servidor de desenvolvimento (`npm run dev`) não está rodando.
- **Solução**: Iniciar o servidor com `npm run dev` e acessar `http://localhost:3000`.

### Loop infinito de requests ao abrir PPVDrawer (GET /api/pedidos?id=X em loop)
- **Causa**: A prop `onSetModalOS` era passada como arrow function inline em `page.tsx`, criando nova referência a cada render → loop infinito.
- **Solução**: Extrair o handler para um `useCallback` com dependências vazias (`handleSetModalOS`) em `page.tsx`.

### Dados do cliente não aparecem
- **Causa**: Endpoint antigo retornava array e a lógica de match falhava.
- **Solução**: Criado endpoint dedicado `/api/cliente-dados` que retorna objeto direto `{ documento, endereco, cidade }` via `buscarDadosCliente()` server-side.

### Técnicos não carregam (lista vazia)
- **Causa**: Tabela era `Tecnicos_Appsheet` (dois p's), não `Tecnicos_Apsheet`. Coluna era `UsuNome`, não `Nome`.
- **Solução**: Corrigido `TBL_TECNICOS` em constants.ts e lookup de coluna em dados-iniciais/route.ts.

### Busca de clientes não encontra resultados
- **Causa**: Query não fazia URL-encode de caracteres especiais nos nomes.
- **Solução**: Adicionado `encodeURIComponent()` na query + aumentado limite para 50 + mínimo de busca reduzido para 1 caractere.

### Overlay do modal com tom avermelhado
- **Causa**: `backdrop-filter: blur(8px)` embaçava o fundo creme do site, criando tom avermelhado.
- **Solução**: Removido blur, mantido apenas overlay escuro `rgba(15, 23, 42, 0.6)`.

### Botão "Adicionar" some ao selecionar produto
- **Causa**: Picker do produto, campo Qtd e botão estavam na mesma linha flex — produto selecionado expandia o picker e empurrava o botão para fora.
- **Solução**: Separado em duas linhas — picker na linha de cima, Qtd + Botão na linha de baixo.

### Estilos não mudam após alteração
- **Causa**: Cache do navegador.
- **Solução**: Ctrl+Shift+R para limpar cache.

---

## Pendências futuras sugeridas
- **Autenticação**: Atualmente logs registram `sistema@ppv.local` - implementar auth real para rastreabilidade
- **Testes**: Adicionar testes unitários nas queries e testes e2e nos fluxos principais
- **Error boundary**: Componente React para capturar erros e mostrar fallback amigável
- **Responsividade mobile**: Layout atual é desktop-first
