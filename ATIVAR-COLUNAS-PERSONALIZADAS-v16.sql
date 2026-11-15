-- Feito em Forma v16: permite etapas criadas pelo usuário no Quadro de Pedidos.
-- Execute UMA vez no SQL Editor do mesmo projeto Supabase, antes de
-- começar a usar colunas personalizadas. Não apaga pedidos existentes.
-- As colunas e suas cores ficam na conta (Supabase Auth user_metadata);
-- o campo status continua armazenando o identificador da etapa no pedido.

begin;
alter table public.quotes drop constraint if exists quotes_valid_status;
alter table public.quotes add constraint quotes_valid_status
  check (status in ('a_fazer','enviado','aprovado','producao','embalagem','pagamento','finalizado','standby')
         or status ~ '^custom_[a-z0-9_]{1,34}$');
commit;
