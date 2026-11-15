# Feito em Forma — Planner v17 | Assistente de Pedidos

## Novidade

Na barra superior e no menu do celular, abra **Assistente de pedidos**. Cole a mensagem que chega pelo site/WhatsApp, no formato:

```
Olá, Feito em Forma! Gostaria de solicitar um orçamento.

Cliente: Kethyleen
Telefone: 11958108697

Produtos selecionados:
1. Calendário do Advento de Natal
Quantidade: 1
Valor unitário: R$ 120,00
Subtotal: R$ 120,00
Medidas: 5cm x 10cm

2. Placa Welcome Grinch
Quantidade: 1
Valor unitário: R$ 30,00
Subtotal: R$ 30,00
Medidas: 20 × 15 cm

3. Enfeite Ho Ho Ho
Quantidade: 1
Valor unitário: R$ 15,00
Subtotal: R$ 15,00
Medidas: 20 × 13 cm

Total estimado: R$ 165,00
Observações: Nenhuma
```

Selecione **Montar pedido**. O assistente identificará cliente, telefone, itens, quantidades, preços e medidas. Ele consulta os produtos cadastrados na tabela `studio_products`, além de produtos de propostas anteriores. Há sugestões de correspondência por nome; nomes ambíguos exigem seleção manual.

## Cálculo e controle

- O **preço de venda** é inicialmente o da mensagem, não o do catálogo. Ele é editável na prévia.
- O **custo de fabricação** é buscado, nessa ordem, do estoque vinculado, de proposta anterior ou, quando há todos os parâmetros necessários, dos dados de precificação salvos neste aparelho. Custos antigos devem ser conferidos.
- Se o custo não for encontrado, é necessário informar o **custo por unidade** antes de salvar. Zero não é inferido automaticamente.
- **Venda bruta = soma(quantidade × valor unitário)**.
- **Lucro estimado = venda bruta − soma(quantidade × custo unitário)**.
- **Margem estimada = lucro estimado / venda bruta × 100**.
- Frete, taxas de marketplace, comissões e impostos não informados não estão incluídos automaticamente no custo. Inclua-os manualmente, se aplicáveis.
- Se o total do texto divergir do total calculado, a prévia exige uma confirmação explícita antes de salvar.
- Itens podem ficar sem vínculo se não estiverem cadastrados, mas exigem custo informado para cálculo financeiro.

Depois de conferir, escolha a etapa inicial e clique **Salvar pedido no Quadro**. O pedido é salvo na tabela `quotes` do Supabase, com cada item em `calculator_data`, e aparece no Quadro, em Todos os orçamentos e nos cálculos do Financeiro.

O pedido inicia com **pagamento pendente / recebido R$ 0,00**, podendo ser editado nos detalhes. Seus pedidos antigos permanecem intactos.

## Tecnologia

Esta primeira versão é um **assistente por regras que lê a mensagem estruturada**. Ele **não usa serviço externo de IA**, não envia a mensagem para uma API de inteligência artificial e não responde diretamente ao cliente no WhatsApp. É necessário colar a mensagem manualmente. O login existente e as políticas RLS do Supabase continuam protegendo os dados.

## Como instalar

1. Faça backup do GitHub e dos seus registros no Planner.
2. Descompacte o ZIP.
3. Envie **o conteúdo dentro de `Planner-main`** para a raiz do repositório GitHub Pages, substituindo os arquivos correspondentes. Não envie a pasta `Planner-main` como uma subpasta.
4. O Planner deve estar configurado com o **mesmo Supabase** de antes. É necessário que `ATIVAR-MODULOS-STUDIO.sql` já tenha sido aplicado; para usar colunas personalizadas, a migração `ATIVAR-COLUNAS-PERSONALIZADAS-v16.sql` também deve estar aplicada. **A v17 não exige novo SQL.**
5. Acesse o Planner, faça login e clique em **Assistente de pedidos**. No iPhone, o atalho aparece na barra inferior e no menu superior.
6. Se a versão antiga persistir, atualize a página ou reabra o PWA. O cache do service worker foi atualizado para v17.

## Testes realizados

- `node TESTAR-ASSISTENTE-V17.mjs`: extração de cliente, telefone, quantidade, preços, medidas e divergências.
- Teste em navegador com dados de Supabase **simulados** em desktop (1360 px) e mobile (390 px): identificação de três produtos, custo de estoque, cálculo e gravação de um pedido.
- Casos críticos em navegador: custo faltante bloqueia salvar, valor divergente exige confirmação.
- Testes anteriores de integração, filtros, acesso, calculadora e financeiro passaram.

**Observação:** os testes de navegador usaram banco simulado e não modificaram seu Supabase real. A implantação no GitHub e a conexão com o banco do usuário devem ser verificadas após a instalação.

## Sobre versões anteriores

Este ZIP parte da versão **v16 Mobile, Colunas e Categorias** e inclui suas funções, mas **não mescla o fechamento mensal da v13**, que era uma ramificação anterior.
