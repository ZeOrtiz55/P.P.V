import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/app/lib/supabase";
import { TBL_CLIENTES } from "@/app/lib/constants";
import { buscaTermoSchema } from "@/app/lib/schemas";
import type { ClienteBusca } from "@/app/lib/types";

export async function GET(req: NextRequest) {
  const termo = req.nextUrl.searchParams.get("termo") || "";
  const parsed = buscaTermoSchema.safeParse({ termo });
  if (!parsed.success) return NextResponse.json([]);

  const query = encodeURIComponent(parsed.data.termo.replace(/ /g, "%"));
  const resultados: ClienteBusca[] = [];

  try {
    const res = await supabaseFetch<Record<string, unknown>[]>(
      `${TBL_CLIENTES}?or=(nome_fantasia.ilike.*${query}*,razao_social.ilike.*${query}*,cnpj_cpf.ilike.*${query}*)&select=*&limit=50`
    );
    res.forEach((row) => {
      const partes = [
        String(row.endereco || "").trim(),
        String(row.numero || "").trim(),
        String(row.bairro || "").trim(),
      ].filter(Boolean);
      resultados.push({
        nome: String(row.nome_fantasia || row.razao_social || "Sem Nome").trim(),
        documento: String(row.cnpj_cpf || "").trim(),
        endereco: partes.join(", "),
        cidade: [String(row.cidade || "").trim(), String(row.estado || "").trim()].filter(Boolean).join(" - "),
        origem: "OMIE",
      });
    });
  } catch (e) {
    console.error("Erro busca Clientes:", e);
  }

  return NextResponse.json(resultados);
}
