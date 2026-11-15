# Feito em Forma — Planner v16

## Instalar
1. Faça backup de seus arquivos e de seus dados atuais.
2. Publique o **conteúdo** da pasta `Planner-main/` na mesma raiz do repositório GitHub Pages (não publique a pasta inteira como subpasta).
3. No Supabase já utilizado pelo Planner, abra SQL Editor e execute `ATIVAR-COLUNAS-PERSONALIZADAS-v16.sql` **antes** de movimentar pedidos para colunas personalizadas. Ele apenas altera a validação das etapas, preservando os registros.
4. No iPhone, abra o Planner e atualize a página ou reabra o ícone PWA. Se necessário, feche e reabra o aplicativo para atualizar o cache.

## Alterações
- Botão **⚙ Colunas** abre uma janela para criar/renomear colunas, editar cores ou excluir colunas personalizadas. Ao excluir uma coluna com pedidos, a confirmação move esses pedidos para «Orçamentos a fazer», mantendo as informações dos pedidos.
- O nome, a cor e as colunas personalizadas são salvos como preferências da conta no Supabase Auth (sem tabela nova).
- **Pagamentos** com cores e detalhes de recebido, restante e total em cards e modal de pedido.
- **Mobile** com menu suspenso a partir do cabeçalho, mais contraste, controles de toque e deslize horizontal do quadro. O zoom global forçado foi substituído por um layout responsivo.
- Na **Calculadora → Produtos cadastrados → Gerenciar categorias**, é possível adicionar, renomear ou excluir categorias. Renomear modifica a categoria dos produtos vinculados; excluir desvincula a categoria sem apagar produtos. Categorias personalizadas são armazenadas nas preferências da conta.
- A categoria de cada produto é guardada em `studio_products.product_data.prod_categoria` para manter compatibilidade com o banco existente. Não é necessário adicionar coluna `category`.

## Cuidados
- A v16 foi criada sobre a **v15**, não inclui automaticamente a função de «Fechar mês» da v13.
- As funções de pedido e produtos exigem acesso à internet e uma sessão Supabase autenticada.
- Se uma edição em massa de categorias falhar por conflito de atualização, recarregue os produtos e tente novamente.
- Guarde backups regulares antes de excluir registros ou realizar alterações grandes.
