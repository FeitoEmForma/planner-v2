/* Feito em Forma — Catálogo único de produtos frequentes e do Planner.
   Compartilha studio_products com o módulo Estoque/Catálogo, sem alterar orçamentos.
   Segurança: Supabase Auth + Row Level Security por owner_id. */
(() => {
  'use strict';
  // Visitante nunca carrega o catálogo, o SDK de autenticação nem faz consultas à nuvem.
  if(new URLSearchParams(location.search).get('guest')==='1')return;
  const FIELDS=[
    'prod_nome','prod_material','prod_categoria','prod_custo_filamento','prod_quantidade','prod_peso',
    'prod_temp_imp','prod_temp_prep','prod_emb','prod_extras','prod_descricao',
    'prod_canal','prod_margem_pct','prod_taxa_pct','prod_taxa_fixa',
    'prod_preco_manual','vendas_qtd'
  ];
  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fromFormattedPrice = value => {
    const str=String(value||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.');
    const amount=Number(str);
    return Number.isFinite(amount)&&amount>=0?amount:0;
  };
  const keyPart = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
  const productKey = (name,material) => `${keyPart(name)}|${keyPart(material||'PLA')}`;
  let db=null,userId=null,products=[],busy=false,editingId=null,channel=null,reloadTimer=null;
  const STARTER_CATEGORIES=['Natal','Gamer','Utensílio','Personalizado','Decoração','Lembrancinha','Educativo','Outro'];
  const categoryStorage=()=>`feitoemforma_categorias_v16_${userId}`;
  let categories=STARTER_CATEGORIES.slice(),editingCategory=null,deleteTarget=null;
  const categoryKey=value=>keyPart(value||'');
  function sanitizeCategories(values){
    if(!Array.isArray(values))return STARTER_CATEGORIES.slice();
    const seen=new Set();return values.map(c=>String(c||'').trim().slice(0,50)).filter(c=>{const k=categoryKey(c);if(!k||seen.has(k))return false;seen.add(k);return true;}).slice(0,80);
  }
  function loadCategoryPreferences(user){
    const cloud=user?.user_metadata?.fef_product_categories_v16;
    if(Array.isArray(cloud)){categories=sanitizeCategories(cloud);return;}
    try{const stored=JSON.parse(localStorage.getItem(categoryStorage())||'null');categories=stored===null?STARTER_CATEGORIES.slice():sanitizeCategories(stored);}catch{categories=STARTER_CATEGORIES.slice();}
  }
  function categoryOptions(){
    const more=products.map(p=>p.category||'').filter(Boolean);
    return sanitizeCategories([...categories,...more]);
  }
  function updateCategorySelectors(){
    const values=categoryOptions();
    const filter=$('catalogCategory'),input=$('prod_categoria');
    if(filter){const old=filter.value;filter.innerHTML='<option value="">Todas as categorias</option>'+values.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');filter.value=values.includes(old)?old:'';}
    if(input){const old=input.value;input.innerHTML='<option value="">Sem categoria</option>'+values.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');input.value=values.includes(old)?old:'';}
  }
  async function persistCategories(values){
    if(!db||!userId)throw new Error('Entre na sua conta para salvar categorias.');
    const next=sanitizeCategories(values);
    const {error}=await db.auth.updateUser({data:{fef_product_categories_v16:next}});
    if(error)throw error;
    categories=next;
    try{localStorage.setItem(categoryStorage(),JSON.stringify(categories));}catch(e){console.warn(e);}
    updateCategorySelectors();renderCategoryManager();
  }
  function toggleCategoryManager(open){
    const region=$('categoryManager');if(!region)return;
    region.hidden=!open;
    if(open){editingCategory=null;deleteTarget=null;resetCategoryForm();renderCategoryManager();region.scrollIntoView({block:'nearest',behavior:'smooth'});}
    reportHeight();
  }
  function resetCategoryForm(){
    editingCategory=null;
    if(!$('categoryForm'))return;
    $('categoryForm').reset();
    $('categoryFormHeading').textContent='Adicionar categoria';
    $('categoryFormSave').textContent='+ Criar categoria';
    $('categoryCancelEdit').hidden=true;
    $('categoryFeedback').textContent='';
  }
  function renderCategoryManager(){
    const host=$('categoryRows');if(!host)return;
    host.innerHTML=categories.map((name,index)=>{
      const used=products.filter(p=>categoryKey(p.category)===categoryKey(name)).length;
      const deleting=deleteTarget===name;
      return `<article class="category-row"><div class="category-row-label"><strong>${escapeHtml(name)}</strong><small>${used} produto(s)</small></div><div class="category-row-actions">${deleting?`<span class="category-delete-question">Desvincular ${used} produto(s)?</span><button type="button" class="cat-action danger" data-cat-action="confirm-delete" data-cat-index="${index}">Confirmar</button><button type="button" class="cat-action" data-cat-action="cancel-delete">Cancelar</button>`:`<button type="button" class="cat-action" data-cat-action="edit" data-cat-index="${index}">Editar</button><button type="button" class="cat-action danger" data-cat-action="delete" data-cat-index="${index}">Excluir</button>`}</div></article>`;
    }).join('')||'<div class="catalog-empty">Crie sua primeira categoria para organizar os produtos.</div>';
    reportHeight();
  }
  async function applyCategoryToProducts(before,after){
    const affected=products.filter(p=>categoryKey(p.category)===categoryKey(before));
    for(const item of affected){
      const nextData={...item.data,prod_categoria:after};
      const {data,error}=await db.from('studio_products').update({product_data:nextData,updated_at:new Date().toISOString()}).eq('owner_id',userId).eq('id',item.id).eq('updated_at',item.updatedAt).select('id').maybeSingle();
      if(error)throw error;
      if(!data)throw new Error(`O produto “${item.name}” foi alterado em outro aparelho. Recarregue e tente novamente.`);
    }
  }
  async function submitCategory(event){
    event.preventDefault();if(busy)return;
    const name=String($('categoryName').value||'').trim().slice(0,50);
    const feedback=$('categoryFeedback');feedback.textContent='';
    if(!name){feedback.textContent='Informe um nome para a categoria.';return;}
    if(categories.some(c=>c!==editingCategory && categoryKey(c)===categoryKey(name))){feedback.textContent='Já existe uma categoria com esse nome.';return;}
    if(!editingCategory && categories.length>=80){feedback.textContent='Limite de 80 categorias.';return;}
    busy=true;$('categoryFormSave').disabled=true;
    try{
      if(editingCategory){
        if(categoryKey(editingCategory)!==categoryKey(name) || editingCategory!==name)await applyCategoryToProducts(editingCategory,name);
        await persistCategories(categories.map(c=>c===editingCategory?name:c));
      }else await persistCategories([...categories,name]);
      const wasEdit=Boolean(editingCategory);
      resetCategoryForm();
      status(wasEdit?'Categoria atualizada.':'Nova categoria criada e sincronizada.');
    }catch(error){feedback.textContent='Não foi possível salvar: '+(error.message||'erro de comunicação');}
    finally{busy=false;$('categoryFormSave').disabled=false;await refresh();}
  }
  async function confirmCategoryDelete(index){
    const name=categories[index];if(!name||busy)return;
    busy=true;
    $('categoryFeedback').textContent='Excluindo categoria sem apagar produtos...';
    try{
      await applyCategoryToProducts(name,'');
      await persistCategories(categories.filter(c=>c!==name));
      if(editingCategory===name)resetCategoryForm();
      deleteTarget=null;
      status(`Categoria “${name}” excluída. Os produtos foram preservados.`);
      $('categoryFeedback').textContent='';
    }catch(error){$('categoryFeedback').textContent='Não foi possível concluir: '+(error.message||'erro na nuvem');}
    finally{busy=false;await refresh();renderCategoryManager();}
  }

  const VALID_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function status(message,error=false){
    const el=$('catalogStatus');if(!el)return;
    el.textContent=message;el.classList.toggle('catalog-error',error);
  }
  function getFields(){
    const data={};
    for(const id of FIELDS){const input=$(id);if(input)data[id]=String(input.value??'').slice(0,180);}
    return data;
  }
  function validFields(data){
    const name=String(data.prod_nome||'').trim();
    if(!name)return 'Informe o nome da peça na calculadora antes de salvar.';
    if(name.length>120)return 'O nome do produto deve ter no máximo 120 caracteres.';
    if(!['PLA','PETG','ABS','TPU','Outro'].includes(data.prod_material))return 'Selecione um tipo de filamento válido.';
    const qty=Number(data.prod_quantidade);
    if(!Number.isInteger(qty)||qty<1||qty>100000)return 'Informe uma quantidade válida.';
    for(const id of FIELDS){
      if(['prod_nome','prod_material','prod_categoria','prod_descricao','prod_canal'].includes(id))continue;
      const str=String(data[id]??'').trim();if(!str)continue;
      if(!Number.isFinite(Number(str))||Number(str)<0)return 'Confira os campos numéricos da calculadora.';
    }
    return '';
  }
  function applyFields(fields){
    if(!fields||typeof fields!=='object')return;
    for(const id of FIELDS){
      const input=$(id);
      if(input && Object.hasOwn(fields,id) && typeof fields[id]!=='object'){
        input.value=String(fields[id]).slice(0,180);
        input.dispatchEvent(new Event('input',{bubbles:true}));
        if(input.tagName==='SELECT')input.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }
  }
  function showTab(){
    document.querySelectorAll('.panel').forEach(el=>el.classList.toggle('active',el.id==='panel-catalogo'));
    document.querySelectorAll('.nav-link,.embedded-nav [data-tab]').forEach(el=>{
      const active=el.dataset.tab==='catalogo';el.classList.toggle('active',active);
      if(el.classList.contains('nav-link')){
        if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
      }
    });
    if($('breadcrumbSection'))$('breadcrumbSection').textContent='PRODUTOS CADASTRADOS';
    window.scrollTo({top:0,behavior:'auto'});
    reportHeight();
    refresh();
  }
  function reportHeight(){
    if(window.parent!==window){
      try{window.parent.postMessage({type:'FEF_CALCULATOR_RESIZE',height:document.body.scrollHeight},location.origin)}catch(e){}
    }
  }
  function noticeEditing(){
    const area=$('catalogEditBanner');if(!area)return;
    const product=products.find(p=>p.id===editingId);
    area.hidden=!product;
    if(product)$('catalogEditingName').textContent=product.name;
    reportHeight();
  }
  function navigateCalculator(){
    // O menu existente é a única autoridade para calcular e mudar de aba.
    const btn=document.querySelector('[data-tab="calculadora"]');
    btn?.click();
  }
  function render(){
    const area=$('catalogList');if(!area)return;
    area.replaceChildren();
    const query=String($('catalogSearch').value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const category=String($('catalogCategory')?.value||'');
    const matches=products.filter(p=>[p.name,p.material,p.description,p.category||''].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query) && (!category || (p.category||'')===category));
    $('catalogCount').textContent=String(products.length);
    if(!matches.length){
      const empty=document.createElement('div');empty.className='catalog-empty';
      empty.textContent=products.length?'Nenhum produto corresponde à pesquisa.':'Nenhuma peça cadastrada ainda. Configure uma peça na Calculadora e clique em “Salvar no catálogo”.';
      area.append(empty);reportHeight();return;
    }
    for(const item of matches){
      const card=document.createElement('article');card.className='catalog-card';
      const header=document.createElement('div');header.className='catalog-card-head';
      const info=document.createElement('div');
      const name=document.createElement('h3');name.textContent=item.name;
      const desc=document.createElement('p');desc.textContent=item.description || 'Peça personalizada para impressão 3D';
      info.append(name,desc);
      const tag=document.createElement('span');tag.className='catalog-tag';tag.textContent=item.material;
      const categoryTag=document.createElement('span');categoryTag.className='catalog-tag secondary';categoryTag.textContent=item.category||'Sem categoria';
      const tagWrap=document.createElement('div');tagWrap.className='catalog-tag-wrap';tagWrap.append(tag,categoryTag); header.append(info,tagWrap);
      const attrs=document.createElement('div');attrs.className='catalog-attrs';
      const data=item.data||{};
      const attrItems=[['Peso',`${data.prod_peso||'0'} g`],['Impressão',`${data.prod_temp_imp||'0'} h`],['Preço',data.prod_preco_manual?money(data.prod_preco_manual):item.price?money(item.price):'Calculado na hora']];
      for(const [label,value] of attrItems){const block=document.createElement('div');const caption=document.createElement('small');caption.textContent=label;const amount=document.createElement('strong');amount.textContent=value;block.append(caption,amount);attrs.append(block);}
      const actions=document.createElement('div');actions.className='catalog-actions';
      const action=(text,cls,handler)=>{const button=document.createElement('button');button.type='button';button.className=cls;button.textContent=text;button.addEventListener('click',handler);actions.append(button);};
      action('+ Adicionar ao orçamento','catalog-btn primary',()=>useItem(item,true));
      action('Carregar / editar','catalog-btn subtle',()=>useItem(item,false));
      action('Excluir','catalog-btn delete',()=>removeItem(item));
      card.append(header,attrs,actions);area.append(card);
    }
    reportHeight();
  }
  function makeRow(row){
    if(!row||!VALID_ID.test(row.id))return null;
    const raw=row.product_data&&typeof row.product_data==='object'?row.product_data:{};
    const data=Object.keys(raw).length?raw:{
      prod_nome:String(row.name||''),prod_material:String(row.material||'PLA'),
      prod_quantidade:'1',prod_preco_manual:String(row.price||0),prod_descricao:String(row.description||'')
    };
    return {
      id:row.id,name:String(row.name||''),material:String(row.material||'PLA'),price:Number(row.price)||0,
      description:String(row.description||''),category:String(data.prod_categoria||row.category||''),data,
      updatedAt:row.updated_at,sourceKey:row.source_key||productKey(row.name,row.material)
    };
  }
  function friendlyError(error){
    const message=String(error?.message||error||'Falha de comunicação');
    if(error?.code==='42P01'||error?.code==='PGRST205'||error?.code==='42703'||error?.code==='PGRST204')return 'Execute novamente ATIVAR-MODULOS-STUDIO.sql no Supabase para conectar os produtos da calculadora ao catálogo e ao estoque.';
    if(error?.code==='42501')return 'Acesso negado: confira as políticas RLS no banco do catálogo.';
    if(/failed to fetch|network|offline/i.test(message))return 'Não foi possível comunicar com o Supabase. Verifique a conexão.';
    return message;
  }
  async function refresh(){
    if(!db||!userId||busy)return;
    const current=userId;
    try{
      const {data,error}=await db.from('studio_products')
.select('id,name,material,price,description,product_data,updated_at,source_key')
        .eq('owner_id',current).order('updated_at',{ascending:false}).limit(500);
      if(error)throw error;
      if(current!==userId)return;
      products=(data||[]).map(makeRow).filter(Boolean);
      updateCategorySelectors();renderCategoryManager();
      status(`${products.length} produto(s) sincronizado(s) na sua conta.`);render();noticeEditing();
    }catch(error){status(friendlyError(error),true);}
  }
  function scheduleRefresh(){clearTimeout(reloadTimer);reloadTimer=setTimeout(refresh,350);}
  async function saveCurrent(){
    if(!db||!userId){status('Conecte sua conta do Planner para salvar produtos.',true);return;}
    if(busy)return;
    const fields=getFields(),problem=validFields(fields);
    if(problem){status(problem,true);return;}
    const row={owner_id:userId,name:fields.prod_nome.trim(),material:fields.prod_material,
      description:String(fields.prod_descricao||'').slice(0,180),product_data:fields,
      price:Number(fields.prod_preco_manual)||fromFormattedPrice($('priceUnit')?.textContent),
      source_key:productKey(fields.prod_nome,fields.prod_material),updated_at:new Date().toISOString()};
    busy=true;status(editingId?'Atualizando produto na nuvem...':'Salvando produto na nuvem...');
    try{
      if(editingId){
        const existing=products.find(p=>p.id===editingId);
        if(!existing)throw new Error('Produto não encontrado. Atualize a lista antes de editar.');
        const {data,error}=await db.from('studio_products').update(row).eq('owner_id',userId)
          .eq('id',editingId).eq('updated_at',existing.updatedAt).select('id').maybeSingle();
        if(error)throw error;
        if(!data)throw new Error('Este produto foi alterado em outro dispositivo. Atualize e revise antes de salvar.');
      }else{
        // Upsert pelo mesmo nome/material: evita cópias do produto já importado do Quadro.
        const {error}=await db.from('studio_products').upsert(row,{onConflict:'owner_id,source_key'});
        if(error)throw error;
      }
      const wasEdit=!!editingId;editingId=null;
      status(wasEdit?'Produto atualizado na nuvem!':'Produto cadastrado na nuvem!');
      $('catalogSaveCalc').textContent='☆ Salvar produto no catálogo';
      noticeEditing();
    }catch(error){status(friendlyError(error),true);}
    finally{busy=false;await refresh();}
  }
  function useItem(item,addToQuote){
    if(!item?.data)return;
    applyFields(item.data);
    editingId=addToQuote?null:item.id;
    $('catalogSaveCalc').textContent=editingId?'✓ Atualizar produto no catálogo':'☆ Salvar produto no catálogo';
    noticeEditing();
    navigateCalculator();
    if(addToQuote){
      const button=$('addItemBtn');
      if(!button||button.disabled){showTab();status(`Revise o preço da peça “${item.name}” na calculadora.`,true);return;}
      const previous=Number($('itemCount')?.textContent||0);
      button.click();
      const current=Number($('itemCount')?.textContent||0);
      status(current>previous?`“${item.name}” adicionado ao orçamento.`:'Não foi possível adicionar a peça. Confira o limite de itens da proposta.',current<=previous);
    }else{
      status(`“${item.name}” carregado. Edite os dados na calculadora e clique em “Atualizar produto no catálogo”.`);
    }
  }
  async function removeItem(item){
    if(!db||!userId||busy||!window.confirm(`Excluir “${item.name}” do catálogo? Os orçamentos existentes não serão apagados.`))return;
    busy=true;status('Excluindo produto...');
    try{
      const {data,error}=await db.from('studio_products').delete().eq('owner_id',userId)
        .eq('id',item.id).select('id').maybeSingle();
      if(error)throw error;
      if(!data)throw new Error('Produto não encontrado; ele pode ter sido excluído em outro aparelho.');
      if(editingId===item.id)editingId=null;
      status('Produto excluído do catálogo.');
    }catch(error){status(friendlyError(error),true);}
    finally{busy=false;await refresh();}
  }
  function createUI(){
    const side=document.querySelector('.sidebar .nav');
    const top=document.querySelector('.embedded-nav');
    const calculator=$('panel-calculadora');
    const settings=$('panel-configuracoes');
    if(!side||!calculator||!settings||$('panel-catalogo'))return false;
    const sideBtn=document.createElement('button');sideBtn.type='button';sideBtn.className='nav-link';sideBtn.dataset.tab='catalogo';sideBtn.innerHTML='<span class="nav-ico">▦</span> Produtos cadastrados';
    const before=side.querySelector('[data-tab="configuracoes"]');side.insertBefore(sideBtn,before||null);
    sideBtn.addEventListener('click',showTab);
    if(top){
      const mini=document.createElement('button');mini.type='button';mini.dataset.tab='catalogo';mini.textContent='▦ Produtos cadastrados';
      top.insertBefore(mini,top.querySelector('[data-tab="configuracoes"]')||null);
      mini.addEventListener('click',showTab);
    }
    const saveBtn=document.createElement('button');saveBtn.type='button';saveBtn.id='catalogSaveCalc';saveBtn.className='catalog-save-calc';
    saveBtn.textContent='☆ Salvar produto no catálogo';saveBtn.addEventListener('click',saveCurrent);
    $('addItemBtn')?.insertAdjacentElement('afterend',saveBtn);
    const editBanner=document.createElement('div');editBanner.id='catalogEditBanner';editBanner.className='catalog-edit-banner';editBanner.hidden=true;
    editBanner.innerHTML='<span>Você está editando: <strong id="catalogEditingName"></strong></span><button type="button" id="catalogCancelEdit">Cancelar edição</button>';
    calculator.querySelector('.page-head')?.insertAdjacentElement('afterend',editBanner);
    $('catalogCancelEdit').addEventListener('click',()=>{editingId=null;saveBtn.textContent='☆ Salvar produto no catálogo';noticeEditing();status('Edição cancelada.');});
    const panel=document.createElement('section');panel.id='panel-catalogo';panel.className='panel catalog-panel';panel.setAttribute('aria-label','Produtos cadastrados');
    panel.innerHTML=`<div class="page-head"><div><div class="eyebrow">CATÁLOGO DE PRODUTOS</div><h1>Suas peças mais <em>vendidas.</em></h1><p>Cadastre uma vez, reutilize nos orçamentos e sincronize entre seus dispositivos.</p></div><button class="btn btn-dark" type="button" id="catalogGoCalc">+ Cadastrar nova peça</button></div>
      <section class="surface catalog-surface">
        <div class="surface-header"><div><div class="section-counter">PRODUTOS FREQUENTES</div><h2>Peças salvas <span id="catalogCount" class="mini-count">0</span></h2></div><div class="catalog-header-actions"><button type="button" id="catalogManageCategories" class="btn btn-small btn-dark">⚙ Gerenciar categorias</button><button type="button" id="catalogRefresh" class="btn btn-small btn-outline">↻ Atualizar</button></div></div>
        <div class="catalog-toolbar"><label class="field"><span>Buscar produto</span><input type="search" id="catalogSearch" placeholder="Nome, material ou descrição..."></label><label class="field"><span>Categoria</span><select id="catalogCategory"><option value="">Todas as categorias</option></select></label><p>Para cadastrar: configure a peça na aba Calculadora, escolha uma categoria e clique em <b>Salvar produto no catálogo</b>.</p></div>
        <section id="categoryManager" class="catalog-category-manager" aria-label="Gerenciar categorias" hidden>
          <div class="category-manager-head"><div><h3>Organizar categorias</h3><p>Crie, edite ou exclua categorias. Seus produtos não são apagados.</p></div><button type="button" class="catalog-manager-close" id="catalogManagerClose" aria-label="Fechar categorias">×</button></div>
          <div class="category-manager-grid"><div id="categoryRows" class="category-rows"></div><form id="categoryForm" class="category-form"><h4 id="categoryFormHeading">Adicionar categoria</h4><label for="categoryName">Nome da categoria<input id="categoryName" type="text" maxlength="50" placeholder="Ex.: Brindes corporativos" required></label><p id="categoryFeedback" class="category-feedback" role="alert"></p><button id="categoryFormSave" class="btn btn-dark" type="submit">+ Criar categoria</button><button id="categoryCancelEdit" class="btn btn-outline" type="button" hidden>Cancelar edição</button></form></div>
        </section>
        <div id="catalogStatus" class="catalog-status" role="status">Conectando ao Supabase...</div>
        <div id="catalogList" class="catalog-list"></div>
      </section>`;
    settings.insertAdjacentElement('beforebegin',panel);
    $('catalogGoCalc').addEventListener('click',()=>{editingId=null;saveBtn.textContent='☆ Salvar produto no catálogo';noticeEditing();navigateCalculator();$('prod_nome')?.focus();});
    $('catalogRefresh').addEventListener('click',refresh);
    $('catalogSearch').addEventListener('input',render);
    $('catalogCategory').addEventListener('change',render);
    $('catalogManageCategories').addEventListener('click',()=>toggleCategoryManager($('categoryManager').hidden));
    $('catalogManagerClose').addEventListener('click',()=>toggleCategoryManager(false));
    $('categoryForm').addEventListener('submit',submitCategory);
    $('categoryCancelEdit').addEventListener('click',resetCategoryForm);
    $('categoryRows').addEventListener('click',event=>{
      const button=event.target.closest('[data-cat-action]');if(!button||busy)return;
      const action=button.dataset.catAction,index=Number(button.dataset.catIndex),name=categories[index];
      if(action==='cancel-delete'){deleteTarget=null;renderCategoryManager();return;}
      if(!name)return;
      if(action==='edit'){
        deleteTarget=null;editingCategory=name;
        $('categoryName').value=name;
        $('categoryFormHeading').textContent='Editar categoria';
        $('categoryFormSave').textContent='Salvar alterações';
        $('categoryCancelEdit').hidden=false;
        $('categoryFeedback').textContent='';
        renderCategoryManager();$('categoryName').focus();
      }else if(action==='delete'){deleteTarget=name;renderCategoryManager();}
      else if(action==='confirm-delete')confirmCategoryDelete(index);
    });
    return true;
  }
  function loadScript(url){return new Promise((resolve,reject)=>{
    const el=document.createElement('script');el.src=url;el.onload=resolve;el.onerror=()=>reject(new Error('Não foi possível carregar '+url));document.head.append(el);
  });}
  async function cloudStart(){
    try{
      let cfg=window.FEITO_SUPABASE;
      if(!cfg && window.parent!==window){try{cfg=window.parent.FEITO_SUPABASE}catch(e){}}
      if(!cfg) {await loadScript('../config.js');cfg=window.FEITO_SUPABASE;}
      if(!cfg?.url||!cfg?.publishableKey||!String(cfg.url).startsWith('https://'))throw new Error('Não foi possível ler a conexão do Planner. Abra a calculadora pelo menu Envio de orçamento.');
      let sdk=window.supabase;
      if(!sdk?.createClient && window.parent!==window){try{sdk=window.parent.supabase}catch(e){}}
      if(!sdk?.createClient){await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');sdk=window.supabase;}
      if(!sdk?.createClient)throw new Error('Biblioteca Supabase indisponível.');
      db=sdk.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      const {data,error}=await db.auth.getUser();if(error)throw error;
      if(!data?.user?.id)throw new Error('É necessário entrar na mesma conta no Planner para acessar o catálogo.');
      userId=data.user.id;
      loadCategoryPreferences(data.user);updateCategorySelectors();
      await refresh();
      channel=db.channel(`catalogo-${userId}`).on('postgres_changes',
        {event:'*',schema:'public',table:'studio_products',filter:`owner_id=eq.${userId}`},scheduleRefresh).subscribe();
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
      setInterval(()=>{if(!document.hidden && $('panel-catalogo')?.classList.contains('active'))refresh();},45000);
    }catch(error){status(friendlyError(error),true);}
  }
  function init(){
    if(!createUI())return;
    cloudStart();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
