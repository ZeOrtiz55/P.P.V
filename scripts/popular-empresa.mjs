// ============================================================
// Script para popular coluna "Empresa" em Produtos_Completos
// Testa cada produto nas duas contas Omie via ConsultarProduto
//
// Uso: node scripts/popular-empresa.mjs
// ============================================================

const SUPABASE_URL = "https://yvwwqxunabvmmqzznrxl.supabase.co";
const SUPABASE_KEY = "sb_publishable_ckUGvi64JZH1qIPCqlzwrQ_Oz8HcW4W";

const OMIE_ACCOUNTS = [
  { name: "Principal", key: "2729522270475", secret: "113d785bb86c48d064889d4d73348131" },
  { name: "Secundario", key: "2730028269969", secret: "dc270bf5348b40d3ed1398ef70beb628" },
];

const OMIE_BASE = "https://app.omie.com.br/api/v1";

// --- Omie API call (com retry em rate limit) ---
async function omieCall(endpoint, call, param, appKey, appSecret) {
  const res = await fetch(`${OMIE_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: appKey,
      app_secret: appSecret,
      param: [param],
    }),
  });

  if (res.status === 429) {
    console.log("  Rate limit, aguardando 60s...");
    await new Promise((r) => setTimeout(r, 60000));
    return omieCall(endpoint, call, param, appKey, appSecret);
  }

  const data = await res.json();
  return data;
}

// --- Testar em qual conta o produto existe ---
async function identificarEmpresa(idOmie) {
  for (const acc of OMIE_ACCOUNTS) {
    try {
      const data = await omieCall(
        "/geral/produtos/",
        "ConsultarProduto",
        { codigo_produto: idOmie },
        acc.key,
        acc.secret
      );
      // Se retornou sem erro, o produto existe nessa conta
      if (data.codigo_produto && !data.faultstring) {
        return acc.name;
      }
    } catch {
      // Produto nao existe nessa conta, tenta proxima
    }
  }
  return null;
}

// --- Atualizar Supabase em lotes ---
async function atualizarEmpresa(idsOmie, empresa) {
  const BATCH = 50;
  for (let i = 0; i < idsOmie.length; i += BATCH) {
    const batch = idsOmie.slice(i, i + BATCH);
    const filter = batch.map((id) => `id_omie.eq.${id}`).join(",");

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Produtos_Completos?or=(${filter})`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ Empresa: empresa }),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      console.error(`  Erro ao atualizar lote: ${txt}`);
    }
  }
}

// --- Main ---
async function main() {
  console.log("=== Popular coluna Empresa em Produtos_Completos ===\n");

  // 1. Buscar todos os id_omie do Supabase que ainda nao tem Empresa
  console.log("Buscando produtos sem Empresa no Supabase...");
  const todosSemEmpresa = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Produtos_Completos?Empresa=is.null&select=id_omie&order=id_omie&offset=${offset}&limit=1000`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const data = await res.json();
    if (!data.length) break;
    todosSemEmpresa.push(...data.map((r) => r.id_omie));
    offset += data.length;
    if (data.length < 1000) break;
  }

  console.log(`${todosSemEmpresa.length} produtos para classificar\n`);

  if (todosSemEmpresa.length === 0) {
    console.log("Todos os produtos ja tem empresa definida!");
    return;
  }

  // 2. Para cada produto, testar nas contas Omie
  const porEmpresa = {};
  const naoEncontrados = [];
  let processados = 0;

  // Processar em paralelo (3 por vez para nao estourar rate limit)
  const CONCURRENCY = 3;

  for (let i = 0; i < todosSemEmpresa.length; i += CONCURRENCY) {
    const batch = todosSemEmpresa.slice(i, i + CONCURRENCY);

    const resultados = await Promise.all(
      batch.map(async (idOmie) => {
        const empresa = await identificarEmpresa(idOmie);
        return { idOmie, empresa };
      })
    );

    for (const { idOmie, empresa } of resultados) {
      processados++;
      if (empresa) {
        if (!porEmpresa[empresa]) porEmpresa[empresa] = [];
        porEmpresa[empresa].push(idOmie);
      } else {
        naoEncontrados.push(idOmie);
      }
    }

    // Progresso
    if (processados % 30 === 0 || processados === todosSemEmpresa.length) {
      const stats = Object.entries(porEmpresa).map(([k, v]) => `${k}: ${v.length}`).join(", ");
      console.log(`  ${processados}/${todosSemEmpresa.length} processados | ${stats} | sem empresa: ${naoEncontrados.length}`);
    }

    // Pausa a cada lote para rate limit
    await new Promise((r) => setTimeout(r, 350));

    // Salvar no Supabase a cada 100 identificados
    for (const [empresa, ids] of Object.entries(porEmpresa)) {
      if (ids.length >= 100) {
        console.log(`  Salvando ${ids.length} produtos como "${empresa}"...`);
        await atualizarEmpresa(ids, empresa);
        porEmpresa[empresa] = [];
      }
    }
  }

  // 3. Salvar remanescentes
  for (const [empresa, ids] of Object.entries(porEmpresa)) {
    if (ids.length > 0) {
      console.log(`Salvando ${ids.length} produtos como "${empresa}"...`);
      await atualizarEmpresa(ids, empresa);
    }
  }

  // 4. Resumo final
  console.log("\n=== Resumo ===");
  const resFinal = await fetch(
    `${SUPABASE_URL}/rest/v1/Produtos_Completos?select=Empresa&limit=20000`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  const todos = await resFinal.json();
  const contagem = {};
  for (const p of todos) {
    const emp = p.Empresa || "(sem empresa)";
    contagem[emp] = (contagem[emp] || 0) + 1;
  }
  for (const [emp, qtd] of Object.entries(contagem)) {
    console.log(`  ${emp}: ${qtd} produtos`);
  }

  if (naoEncontrados.length > 0) {
    console.log(`\n${naoEncontrados.length} produtos nao encontrados em nenhuma conta Omie`);
  }

  console.log("\n=== Concluido! ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
