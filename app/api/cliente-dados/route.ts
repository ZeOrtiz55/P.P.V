import { NextRequest, NextResponse } from "next/server";
import { buscarDadosCliente } from "@/app/lib/queries";

export async function GET(req: NextRequest) {
  const nome = req.nextUrl.searchParams.get("nome") || "";
  if (!nome.trim()) {
    return NextResponse.json({ documento: "", endereco: "", cidade: "" });
  }
  const dados = await buscarDadosCliente(nome.trim());
  return NextResponse.json(dados);
}
