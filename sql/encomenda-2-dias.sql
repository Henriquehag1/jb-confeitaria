-- JB OS, 13/11/2026: jb_encomenda_criar passa a exigir 2 dias inteiros de produção (o dia do pedido não conta).
-- Aplicado pelo Claude via execute_sql (troca só a linha da antecedência na função existente). Registro para o repositório.
do $$
declare d text := pg_get_functiondef('public.jb_encomenda_criar(jsonb)'::regprocedure);
  a text := 'if v_quando is null or v_quando < v_agora + interval ''48 hours'' then raise exception ''antecedencia''; end if;';
  b text := '-- 2 dias inteiros de produção (pedido da Jessica, 13/11/2026): o dia do pedido não conta
  if v_quando is null or (v_quando at time zone ''America/Sao_Paulo'')::date < (v_agora at time zone ''America/Sao_Paulo'')::date + 3 then raise exception ''antecedencia''; end if;';
begin
  if position(a in d) = 0 then raise exception 'trecho da antecedência não encontrado'; end if;
  execute replace(d, a, b);
end $$;
