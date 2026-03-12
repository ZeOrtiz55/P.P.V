# P.O.S — Documentação da API (para integração com PPV)

Sistema de pós-venda Nova Tratores. Este documento descreve a API do POS para referência do sistema PPV.

**Base URL:** (Railway deploy)
**Stack:** Next.js (App Router) · Supabase · Omie API

---

## Tabelas Compartilhadas (Supabase)

Tabelas que o POS e o PPV usam em comum:

| Tabela | Descrição | Usado pelo POS | Usado pelo PPV |
|---|---|---|---|
| `movimentacoes` | Itens/peças dos pedidos | Leitura (financeiro) | Escrita (movimentações) |
| `pedidos` | Pedidos de peças (PPV) | Leitura + Update (status, pedido_omie) | Escrita + Leitura |
| `logs_ppv` | Logs de ações nos PPVs | Escrita (sync status, fechamento) | Escrita + Leitura |
| `Clientes` | Clientes importados do Omie | Escrita (sync) + Leitura | Leitura |
| `Clientes_Manuais` | Clientes manuais | Escrita + Leitura | Leitura |
| `Projeto` | Projetos/Chassis | Escrita (sync) + Leitura | Leitura |
| `Tecnicos_Appsheet` | Lista de técnicos | Leitura | Leitura |
| `Ordem_Servico` | Ordens de serviço | Escrita + Leitura | Leitura (vínculo Id_Os) |

---

## Como o POS Interage com PPVs

### 1. Vínculo OS ↔ PPV
- Campo `ID_PPV` na `Ordem_Servico` contém IDs separados por vírgula: `"PPV-0001,PPV-0002"`
- Campo `Id_Os` na tabela `pedidos` contém o ID da OS vinculada

### 2. Sincronização de Status (POS → PPV)
Quando o status de uma OS muda, o POS atualiza automaticamente os PPVs vinculados:

| Status POS | → Status PPV |
|---|---|
| Execução | Em Andamento |
| Execução Procurando peças | Em Andamento |
| Execução aguardando peças (em transporte) | Em Andamento |
| Executada aguardando comercial | Aguardando Para Faturar |
| Executada aguardando cliente | Aguardando Para Faturar |

**Arquivo:** `lib/sync-ppv.ts`
**Lógica:** Busca `ID_PPV` da OS → separa por vírgula → atualiza status de cada PPV na tabela `pedidos` → registra log em `logs_ppv`
**Pula:** PPVs com status "Fechado" ou "Cancelado"

**Pontos de disparo:**
1. Edição da OS (`PATCH /api/ordens/[id]`)
2. Mudança rápida de fase (`PATCH /api/ordens/[id]/fase`)
3. Auto-move por data de previsão (`GET /api/ordens`)

### 3. Envio para Omie (Fechamento de PPVs)
Quando uma OS é enviada para o Omie (`POST /api/ordens/[id]/omie`):

1. **Cria OS no Omie** com todos os serviços
2. **Cria Pedido de Venda no Omie** se existem PPVs com produtos:
   - Busca produtos na `movimentacoes` por `Id_PPV`
   - Agrega por `CodProduto`, desconta devoluções (`TipoMovimento` com "devolu")
   - Consulta código interno do produto no Omie via `ConsultarProduto`
   - Cria pedido com `IncluirPedido` (etapa "10" = Aprovado)
   - Salva número do pedido em `pedido_omie` nos PPVs
3. **Fecha PPVs:** Atualiza status para "Fechado" + registra log em `logs_ppv`

### 4. Cálculo Financeiro
O POS calcula o valor total da OS buscando produtos das PPVs:

```
GET /api/financeiro?ppv=PPV-0001,PPV-0002
```

**Retorno:** `{ descricao, qtde, valor }[]` — produtos agregados com devoluções descontadas

---

## API Routes Relevantes para o PPV

### `GET /api/financeiro?ppv=PPV-0001,PPV-0002`
Resumo financeiro dos produtos nas PPVs vinculadas a uma OS.

**Retorno:**
```json
[
  { "descricao": "Filtro de óleo", "qtde": 2, "valor": 45.50 },
  { "descricao": "Correia", "qtde": 1, "valor": 120.00 }
]
```

### `GET /api/clientes`
Lista todos os clientes (Omie + Manuais) para dropdown.

**Retorno:**
```json
[
  { "chave": "OMIE:12345", "display": "Nova Tratores [CNPJ: 12.345.678/0001-00] (OMIE)" },
  { "chave": "MANUAL:1", "display": "Cliente Manual [CPF: 123.456.789-00] (MANUAL)" }
]
```

Com `?id=OMIE:12345`:
```json
{ "nome": "Nova Tratores", "cpf": "12.345.678/0001-00", "email": "...", "telefone": "...", "endereco": "..." }
```

### `GET /api/tecnicos`
Lista técnicos disponíveis.

**Retorno:** `["João Silva", "Pedro Santos", ...]`

### `GET /api/buscas/projetos?termo=texto`
Busca projetos/chassis por nome (top 50, multi-termo).

**Retorno:** `[{ "nome": "Projeto ABC" }, ...]`

### `POST /api/sync` — Sync Manual Omie → Supabase
Sincroniza clientes e projetos do Omie para o Supabase. Chamado pelo botão "SINCRONIZAR" do POS.

**Header:** `x-sync-manual: true`

**Retorno:**
```json
{
  "sucesso": true,
  "resultados": {
    "clientes": { "total": 150, "novos": 5, "atualizados": 145 },
    "projetos": { "total": 80, "novos": 2 }
  },
  "timestamp": "2026-03-12T10:00:00.000Z"
}
```

---

## Sync Omie → Supabase (Detalhes)

O POS sincroniza dados do Omie para o Supabase (usado por POS e PPV):

### Clientes (`lib/sync-omie.ts → syncClientes`)
- API: `POST https://app.omie.com.br/api/v1/geral/clientes/` → `ListarClientes`
- Paginação: 50 por página
- Upsert na tabela `Clientes` por `id_omie`
- Campos: `id_omie, id_cliente, cnpj_cpf, razao_social, nome_fantasia, email, telefone, endereco, cidade, estado, cep`

### Projetos (`lib/sync-omie.ts → syncProjetos`)
- API: `POST https://app.omie.com.br/api/v1/geral/projetos/` → `ListarProjetos`
- Paginação: 50 por página
- Insert na tabela `Projeto` por `Nome_Projeto` (pula existentes)

### Rate Limit
- 400ms entre páginas
- Retry com 60s se HTTP 429

### Trigger
- **Manual:** Botão "SINCRONIZAR" no header do POS
- **Automático:** Cron no Railway chamando `GET /api/sync` a cada 6h

---

## Fases da OS (Kanban)

1. Orçamento
2. Orçamento enviado para o cliente e aguardando
3. Execução
4. Execução Procurando peças
5. Execução aguardando peças (em transporte)
6. Executada aguardando comercial
7. Aguardando outros
8. Aguardando ordem Técnico
9. Executada aguardando cliente
10. Concluída
11. Cancelada

---

## Constantes

| Constante | Valor |
|---|---|
| `VALOR_HORA` | R$ 193,00 |
| `VALOR_KM` | R$ 2,80 |

---

## Colunas Importantes

### `Ordem_Servico`
```
Id_Ordem (PK), Status, Data, Os_Cliente, Cnpj_Cliente, Endereco_Cliente,
Os_Tecnico, Os_Tecnico2, Tipo_Servico, Revisao, Projeto,
Serv_Solicitado, Serv_Realizado, Qtd_HR, Valor_HR, Qtd_KM, Valor_KM,
Valor_Total, ID_PPV, Id_Req, ID_Relatorio_Final, Ordem_Omie,
Motivo_Cancelamento, Desconto, Desconto_Hora, Desconto_KM,
Previsao_Execucao, Previsao_Faturamento
```

### `pedidos` (PPV)
```
id_pedido (PK), cliente, tecnico, status, data, valor_total, observacao,
motivo_cancelamento, Motivo_Saida_Pedido, pedido_omie, email_usuario,
Id_Os, Tipo_Pedido
```

### `movimentacoes` (Itens PPV)
```
Id_PPV, Data_Hora, Tecnico, TipoMovimento, CodProduto, Descricao, Qtde, Preco, Id
```

### `Clientes` (Omie)
```
id_omie, id_cliente, cnpj_cpf, razao_social, nome_fantasia,
email, telefone, endereco, cidade, estado, cep
```

### `logs_ppv`
```
id_ppv, data_hora, acao, usuario_email
```
