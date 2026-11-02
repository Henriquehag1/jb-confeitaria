-- JB OS · Saúde usa a venda real nos meses conferidos para o contador (02/11/2026)
-- Pedido do Henrique: outubro apareceu com "faltaram R$ 1.171,68" porque a venda do mês era estimada
-- pelo dinheiro que caiu na conta (repasse), e parte da venda do fim do mês só cai no mês seguinte.
-- Agora, quando o mês tem apuração em jb_contador_mes (apuracao.canais), a venda de cada app é o
-- valor real dos itens do mês inteiro; o canal próprio continua pelo que entrou na conta; o
-- vale-refeição (canal 5) sai, porque já está dentro da venda dos apps.
-- O imposto passa a ser a alíquota sobre a receita conferida (itens menos o desconto da casa),
-- mostrado como fatia da venda. Meses sem apuração continuam como antes (fonte = 'estimado').
-- Colunas novas no fim: fonte, receita.
-- Correção junto: o peso de cada doce agora é a fatia dele dividida pela soma das fatias que têm preço
-- naquele canal. Antes a soma dava 92,5% nos apps (doces sem preço no canal ficavam de fora), e a venda
-- do mês aparecia 7,5% menor do que foi.
create or replace view public.jb_kpi_destino as
 with cfg as (
         select jb_imposto_pct() as imposto,
            coalesce(max(jb_config.valor) filter (where jb_config.chave = 'perdas_pct'::text), 0::numeric) as perdas
           from jb_config
        ), mixp as (
         select jb_giro_produto.ficha_id,
            jb_giro_produto.fatia
           from jb_giro_produto
          where coalesce(jb_giro_produto.fatia, 0::numeric) > 0::numeric and not jb_giro_produto.inconsistente
        ), ap as (
         select cm.mes, cm.apuracao -> 'canais' as canais
           from jb_contador_mes cm
          where jsonb_typeof(cm.apuracao -> 'canais') = 'object'
        ), bruto as (
         select f.mes,
            f.canal_id,
            f.valor / nullif(1::numeric - coalesce(c.taxa_efetiva, c.taxa + c.promo), 0::numeric) as bruto,
            null::numeric as receita
           from jb_faturamento f
             join jb_canal c on c.id = f.canal_id
          where coalesce(c.taxa_efetiva, c.taxa + c.promo) < 1::numeric and f.valor > 0::numeric
            and not exists (select 1 from ap where ap.mes = f.mes)
        union all
         select ap.mes,
            k.key::integer,
            (k.value ->> 'itens')::numeric,
            coalesce((k.value ->> 'receita')::numeric, (k.value ->> 'itens')::numeric)
           from ap, jsonb_each(ap.canais) k(key, value)
          where (k.value ->> 'itens')::numeric > 0::numeric
        union all
         select f.mes, f.canal_id, f.valor, f.valor
           from jb_faturamento f
             join ap on ap.mes = f.mes
          where f.canal_id = 1 and f.valor > 0::numeric
        ), fator as (
         select b.mes,
            case when count(b.receita) = count(*) then sum(b.receita) / nullif(sum(b.bruto), 0::numeric) else null::numeric end as fator_receita,
            case when count(b.receita) = count(*) then round(sum(b.receita), 2) else null::numeric end as receita
           from bruto b
          group by b.mes
        ), lin as (
         select b.mes,
            b.bruto * mixp.fatia / nullif(sum(mixp.fatia) over (partition by b.mes, b.canal_id), 0::numeric) as peso,
            m.fatia_app as p_app,
            cfg.imposto * coalesce(fa.fator_receita, 1::numeric) as p_imp,
            m.cmv * (1::numeric + cfg.perdas) / nullif(m.preco, 0::numeric) as p_ingr,
            m.custo_fixo_un * (1::numeric + cfg.perdas) / nullif(m.preco, 0::numeric) as p_fixo
           from bruto b
             join jb_margem m on m.canal_id = b.canal_id
             join mixp on mixp.ficha_id = m.ficha_id
             left join fator fa on fa.mes = b.mes
             cross join cfg
          where m.preco is not null and m.preco > 0::numeric and not m.rascunho
        )
 select lin.mes,
    round(sum(lin.peso * lin.p_app) / nullif(sum(lin.peso), 0::numeric), 4) as app,
    round(sum(lin.peso * lin.p_imp) / nullif(sum(lin.peso), 0::numeric), 4) as imposto,
    round(sum(lin.peso * lin.p_ingr) / nullif(sum(lin.peso), 0::numeric), 4) as ingrediente,
    round(sum(lin.peso * lin.p_fixo) / nullif(sum(lin.peso), 0::numeric), 4) as custo_fixo,
    round(1::numeric - sum(lin.peso * (lin.p_app + lin.p_imp + lin.p_ingr + lin.p_fixo)) / nullif(sum(lin.peso), 0::numeric), 4) as sobra,
    round(sum(lin.peso), 2) as bruto_estimado,
    case when max(fa.mes) is not null and max(fa.fator_receita) is not null then 'apurado'::text else 'estimado'::text end as fonte,
    max(fa.receita) as receita
   from lin
     left join fator fa on fa.mes = lin.mes and fa.fator_receita is not null
  group by lin.mes;
