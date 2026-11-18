-- NOSSO FINANCEIRO (projeto oihyhyyhessqnpkknhsi), 18/11/2026.
-- Recebe do JB OS o pagamento da diarista: as diárias entram como gasto da confeitaria
-- (Pessoas) na data do Pix. As compras que ela fez entram pela jb_receber_compra, cada
-- uma na sua categoria. Mesmo token da sincronização (jbos_sync_token); não duplica
-- (origem_ref "jbos pagamento N").
create or replace function public.jb_receber_pagamento(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'vault', 'pg_temp' as $fn$
declare v_tok text; v_ref text; v_ex record; v_id uuid; v_val numeric; v_data date; v_cat bigint;
begin
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'jbos_sync_token' limit 1;
  if v_tok is null or p_token is null or p_token <> v_tok then raise exception 'token invalido' using errcode = '42501'; end if;
  if coalesce(p->>'pagamento_id', '') !~ '^\d+$' then raise exception 'pagamento_id invalido'; end if;
  v_ref := 'jbos pagamento ' || (p->>'pagamento_id');
  select e.id, e.data, e.descricao, e.valor into v_ex from evento e where e.origem_ref = v_ref limit 1;
  if found then
    return jsonb_build_object('status', 'ja_lancado', 'evento', jsonb_build_object('id', v_ex.id, 'data', v_ex.data, 'descricao', v_ex.descricao, 'valor', v_ex.valor));
  end if;
  v_val := round((p->>'valor')::numeric, 2);
  v_data := (p->>'data')::date;
  v_cat := coalesce(nullif(p->>'categoria_id', '')::bigint, 50);
  if v_val is null or v_val <= 0 or v_val > 20000 then raise exception 'valor invalido'; end if;
  if v_data is null or v_data < current_date - 60 or v_data > current_date + 2 then raise exception 'data fora do esperado'; end if;
  if not exists (select 1 from categoria where id = v_cat and tipo = 'gasto' and 'confeitaria' = any(frentes)) then
    raise exception 'categoria invalida';
  end if;
  insert into evento (casal_id, data, valor, tipo, frente, categoria_id, descricao, forma, situacao, origem, origem_ref, obs, parcelas, parcela_num)
  values ('11111111-1111-1111-1111-111111111111', v_data, v_val, 'gasto', 'confeitaria', v_cat,
          left(coalesce(nullif(btrim(p->>'descricao'), ''), 'Diárias da confeitaria'), 100), 'pix', 'confirmado', 'manual', v_ref,
          left('lançado pelo JB OS no pagamento da diarista' || coalesce('; ' || nullif(btrim(p->>'obs'), ''), ''), 300), 1, 1)
  returning id into v_id;
  return jsonb_build_object('status', 'lancado', 'id', v_id, 'valor', v_val);
end $fn$;
revoke all on function public.jb_receber_pagamento(text, jsonb) from public;
grant execute on function public.jb_receber_pagamento(text, jsonb) to anon, authenticated;
