/** Pedido vindo da mesma origem do app (barra envio de formulário de outro site com o cookie da sessão). */
export function mesmaOrigem(req: Request) {
  const origem = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !!origem && !!host && new URL(origem).host === host;
  } catch {
    return false;
  }
}
