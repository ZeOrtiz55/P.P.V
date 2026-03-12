// =============================================
// INTEGRAÇÃO OMIE — PEDIDO DE VENDA (PPV)
// =============================================

import { supabaseFetch } from "./supabase";
import { TBL_PEDIDOS, TBL_ITENS, TBL_CLIENTES, TBL_LOGS } from "./constants";
import { buscarPPVPorId, registrarLog } from "./queries";

// --- Credenciais ---
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || "";
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || "";
const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";

// --- Constantes Omie ---
const OMIE_COD_CATEG_VENDA = "1.01.03";
const OMIE_COD_CC = 1969919780; // Banco do Brasil

// --- Client genérico Omie ---
async function omieCall<T>(endpoint: string, call: string, param: Record<string, unknown>): Promise<T> {
  const payload = {
    call,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param],
  };

  const response = await fetch(`${OMIE_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (data?.faultstring) {
    throw new Error(`Omie [${data.faultcode}]: ${data.faultstring}`);
  }

  if (response.status === 429) {
    console.warn("[Omie] Rate limit — aguardando 60s...");
    await new Promise((r) => setTimeout(r, 60000));
    return omieCall(endpoint, call, param);
  }

  return data as T;
}

// --- Helpers ---
function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, "");
}

function formatarDataOmie(): string {
  const d = new Date();
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

// --- Lookup de cliente pelo CNPJ ---
const cacheClientes = new Map<string, number>();

async function buscarNcodCli(cnpjOriginal: string): Promise<number> {
  const cnpjNorm = normalizarCnpj(cnpjOriginal);
  if (cacheClientes.has(cnpjNorm)) return cacheClientes.get(cnpjNorm)!;

  // Tenta buscar na tabela Clientes do Supabase (campo id_omie)
  try {
    const res = await supabaseFetch<Record<string, unknown>[]>(
      `${TBL_CLIENTES}?cnpj_cpf=ilike.*${cnpjNorm.substring(0, 8)}*&select=id_omie,cnpj_cpf&limit=1`
    );
    if (res && res.length > 0 && res[0].id_omie) {
      const idOmie = Number(res[0].id_omie);
      cacheClientes.set(cnpjNorm, idOmie);
      return idOmie;
    }
  } catch { /* fallback para API */ }

  // Fallback: busca direto na API Omie
  const result = await omieCall<{ clientes_cadastro?: Array<{ codigo_cliente_omie: number }> }>(
    "/geral/clientes/",
    "ListarClientes",
    { pagina: 1, registros_por_pagina: 1, clientesFiltro: { cnpj_cpf: cnpjOriginal } }
  );

  const nCodCli = result?.clientes_cadastro?.[0]?.codigo_cliente_omie;
  if (!nCodCli) {
    throw new Error(`Cliente não encontrado no Omie para CNPJ: ${cnpjOriginal}`);
  }

  cacheClientes.set(cnpjNorm, nCodCli);
  return nCodCli;
}

// --- Lookup de vendedor (técnico) ---
let listaVendedores: Array<{ codigo: number; nome: string }> | null = null;
const cacheVendedores = new Map<string, number>();

async function carregarVendedores(): Promise<Array<{ codigo: number; nome: string }>> {
  if (listaVendedores) return listaVendedores;
  listaVendedores = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const result = await omieCall<{
      cadastro?: Array<{ codigo: number; nome: string; inativo: string }>;
      total_de_paginas?: number;
    }>("/geral/vendedores/", "ListarVendedores", {
      pagina,
      registros_por_pagina: 50,
    });
    if (pagina === 1 && result.total_de_paginas) totalPaginas = result.total_de_paginas;
    for (const v of result.cadastro || []) {
      if (v.inativo !== "S") listaVendedores.push({ codigo: v.codigo, nome: v.nome });
    }
    pagina++;
    if (pagina > 1) await new Promise((r) => setTimeout(r, 400));
  }
  return listaVendedores;
}

async function buscarNcodVend(tecnico: string): Promise<number> {
  const t = (tecnico || "").trim();
  if (!t) return 0;
  if (cacheVendedores.has(t)) return cacheVendedores.get(t)!;

  const vendedores = await carregarVendedores();
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nt = norm(t);

  for (const v of vendedores) {
    if (norm(v.nome).includes(nt)) {
      cacheVendedores.set(t, v.codigo);
      return v.codigo;
    }
  }

  console.warn(`[Omie] Vendedor não encontrado para: ${t}`);
  return 0;
}

// --- Lookup de produto no Omie ---
const cacheProdutos = new Map<string, number>();

async function buscarCodigoProdutoOmie(codigoInterno: string): Promise<number> {
  if (cacheProdutos.has(codigoInterno)) return cacheProdutos.get(codigoInterno)!;

  const result = await omieCall<{ codigo_produto?: number }>(
    "/produtos/produto/",
    "ConsultarProduto",
    { codigo: codigoInterno }
  );

  const codProd = result?.codigo_produto;
  if (!codProd) {
    throw new Error(`Produto "${codigoInterno}" não encontrado no Omie`);
  }

  cacheProdutos.set(codigoInterno, codProd);
  return codProd;
}

// =============================================
// FUNÇÃO PRINCIPAL: Enviar PPV para Omie
// =============================================
export async function enviarPPVParaOmie(idPPV: string): Promise<{ sucesso: boolean; numeroPedido?: string; erro?: string }> {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return { sucesso: false, erro: "Credenciais Omie não configuradas" };
  }

  // 1. Busca detalhes do PPV
  const detalhes = await buscarPPVPorId(idPPV);
  if (!detalhes) {
    return { sucesso: false, erro: "PPV não encontrado" };
  }

  // 2. Validações
  if (detalhes.status !== "Aguardando Para Faturar") {
    return { sucesso: false, erro: `Status inválido: "${detalhes.status}". Precisa estar "Aguardando Para Faturar"` };
  }

  if (detalhes.pedidoOmie) {
    return { sucesso: false, erro: `PPV já possui pedido Omie: ${detalhes.pedidoOmie}` };
  }

  if (!detalhes.cliente) {
    return { sucesso: false, erro: "Cliente não informado" };
  }

  // 3. Busca CNPJ do cliente
  let cnpjCliente = "";
  try {
    const res = await supabaseFetch<Record<string, unknown>[]>(
      `${TBL_CLIENTES}?or=(nome_fantasia.eq.${encodeURIComponent(detalhes.cliente)},razao_social.eq.${encodeURIComponent(detalhes.cliente)})&select=cnpj_cpf&limit=1`
    );
    if (res && res.length > 0) {
      cnpjCliente = String(res[0].cnpj_cpf || "").trim();
    }
  } catch { /* continua */ }

  if (!cnpjCliente) {
    // Tenta busca parcial
    try {
      const query = encodeURIComponent(detalhes.cliente.replace(/ /g, "%"));
      const res = await supabaseFetch<Record<string, unknown>[]>(
        `${TBL_CLIENTES}?or=(nome_fantasia.ilike.*${query}*,razao_social.ilike.*${query}*)&select=cnpj_cpf&limit=1`
      );
      if (res && res.length > 0) {
        cnpjCliente = String(res[0].cnpj_cpf || "").trim();
      }
    } catch { /* continua */ }
  }

  if (!cnpjCliente) {
    return { sucesso: false, erro: `CNPJ/CPF não encontrado para o cliente "${detalhes.cliente}"` };
  }

  // 4. Agrega produtos (saídas - devoluções)
  const resumo: Record<string, { descricao: string; qtde: number; preco: number }> = {};
  for (const p of detalhes.produtos) {
    if (!resumo[p.codigo]) resumo[p.codigo] = { descricao: p.descricao, qtde: 0, preco: p.preco };
    resumo[p.codigo].qtde += p.quantidade;
  }
  for (const d of detalhes.devolucoes) {
    if (resumo[d.codigo]) resumo[d.codigo].qtde -= d.quantidade;
  }

  const produtosFinais = Object.entries(resumo).filter(([, p]) => p.qtde > 0);
  if (produtosFinais.length === 0) {
    return { sucesso: false, erro: "Todos os produtos foram devolvidos, nada para faturar" };
  }

  try {
    // 5. Lookups no Omie
    const nCodCli = await buscarNcodCli(cnpjCliente);
    const nCodVend = await buscarNcodVend(detalhes.tecnico);

    // 6. Monta itens do pedido
    const det: Array<{
      ide: { codigo_item_integracao: string };
      produto: { codigo_produto: number; quantidade: number; valor_unitario: number };
    }> = [];

    for (let i = 0; i < produtosFinais.length; i++) {
      const [cod, prod] = produtosFinais[i];
      const codigoProdutoOmie = await buscarCodigoProdutoOmie(cod);
      det.push({
        ide: { codigo_item_integracao: `${idPPV}-${i + 1}` },
        produto: {
          codigo_produto: codigoProdutoOmie,
          quantidade: prod.qtde,
          valor_unitario: prod.preco,
        },
      });
    }

    // 7. Cria Pedido de Venda
    const payload = {
      cabecalho: {
        codigo_pedido_integracao: `PV-${idPPV}`,
        codigo_cliente: nCodCli,
        data_previsao: formatarDataOmie(),
        etapa: "10", // Aprovado
        quantidade_itens: det.length,
      },
      informacoes_adicionais: {
        codigo_categoria: OMIE_COD_CATEG_VENDA,
        codigo_conta_corrente: OMIE_COD_CC,
        codVend: nCodVend || undefined,
        numero_contrato: idPPV,
      },
      det,
    };

    const resposta = await omieCall<{ numero_pedido?: string; codigo_pedido?: number }>(
      "/produtos/pedido/",
      "IncluirPedido",
      payload as unknown as Record<string, unknown>
    );

    const numPedido = resposta.numero_pedido || String(resposta.codigo_pedido || "");
    console.log(`[Omie PPV] ✓ ${idPPV} → Pedido de Venda nº ${numPedido}`);

    // 8. Atualiza PPV: salva pedido_omie + muda status para Fechado
    await supabaseFetch(
      `${TBL_PEDIDOS}?id_pedido=eq.${idPPV}`,
      "PATCH",
      { pedido_omie: numPedido, status: "Fechado" }
    );

    // 9. Registra log
    await registrarLog(idPPV, `Pedido de Venda Omie nº ${numPedido} criado. PPV fechado.`);

    return { sucesso: true, numeroPedido: numPedido };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Omie PPV] ✗ ${idPPV}: ${msg}`);
    return { sucesso: false, erro: msg };
  }
}
