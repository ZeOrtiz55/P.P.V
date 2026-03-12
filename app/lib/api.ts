// =============================================
// CAMADA DE API CLIENT-SIDE TIPADA
// Todas as chamadas ao backend passam por aqui.
// Se a URL base mudar ou precisar de token, muda só aqui.
// =============================================

import type {
  KanbanItem, PPVDetalhes, ClienteBusca, OSBusca,
  ProdutoBusca, DadosIniciais, ItemRevisao, LogEntry,
  DadosProdutoManual,
} from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// =============================================
// ENDPOINTS
// =============================================

export const api = {
  // --- Dados Iniciais ---
  getDadosIniciais: () =>
    request<DadosIniciais>("/api/dados-iniciais"),

  // --- Kanban / Pedidos ---
  listarPedidos: () =>
    request<KanbanItem[]>("/api/pedidos"),

  buscarPedido: (id: string) =>
    request<PPVDetalhes>(`/api/pedidos?id=${encodeURIComponent(id)}`),

  criarPedido: (dados: {
    tipoPedido: string; motivoSaida: string; tecnico: string;
    cliente: string; observacao: string; osId: string;
    valorTotal: number; produtosSelecionados: unknown[];
    idExistente?: string;
  }) => post<{ id: string; detalhes: PPVDetalhes }>("/api/pedidos", dados),

  editarPedido: (dados: {
    id: string; status: string; observacao: string; tecnico: string;
    cliente?: string;
    motivoCancelamento: string; pedidoOmie: string; osId: string;
    tipoPedido: string; motivoSaida: string;
  }) => patch<{ success: boolean }>("/api/pedidos", dados),

  // --- Movimentações ---
  registrarMovimentacao: (dados: {
    id: string; codigo: string; descricao: string; quantidade: number;
    preco: number; tecnico: string; tipoMovimento: string;
  }) => post<PPVDetalhes>("/api/movimentacoes", dados),

  // --- Busca de Clientes ---
  buscarClientes: (termo: string) =>
    request<ClienteBusca[]>(`/api/clientes?termo=${encodeURIComponent(termo)}`),

  buscarClientePorNome: (nome: string) =>
    request<{ documento: string; endereco: string; cidade: string }>(`/api/cliente-dados?nome=${encodeURIComponent(nome)}`),

  // --- Busca de OS ---
  buscarOS: (termo: string) =>
    request<OSBusca[]>(`/api/ordens-servico?termo=${encodeURIComponent(termo)}`),

  listarOSAbertas: () =>
    request<OSBusca[]>("/api/ordens-servico?abertas=1"),

  // --- Busca de Produtos ---
  buscarProdutos: (termo: string) =>
    request<ProdutoBusca[]>(`/api/produtos?termo=${encodeURIComponent(termo)}`),

  salvarProdutoManual: (dados: DadosProdutoManual) =>
    post<{ success: boolean }>("/api/produtos", dados),

  // --- Revisões / Kit ---
  buscarKitRevisao: (trator: string, horas: string) =>
    request<ItemRevisao[]>(`/api/revisoes?trator=${encodeURIComponent(trator)}&horas=${encodeURIComponent(horas)}`),

  // --- Logs / Histórico ---
  buscarHistorico: (id: string) =>
    request<LogEntry[]>(`/api/logs?id=${encodeURIComponent(id)}`),

  // --- PDF ---
  gerarPDF: (id: string) =>
    request<{ html: string }>(`/api/pdf?id=${encodeURIComponent(id)}`),

  // --- Omie ---
  enviarParaOmie: (id: string) =>
    post<{ success: boolean; numeroPedido: string }>("/api/pedidos/omie", { id }),
};
