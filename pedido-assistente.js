/* Feito em Forma | Assistente de Pedidos v17.
 * Analisa mensagens padronizadas sem enviar os dados para qualquer serviço de IA.
 * O pedido só é gravado após revisão humana e clique explícito em Salvar.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.FeitoPedidoParser, bridge = window.FeitoPlannerBridge;
  if(!P || !bridge || !$('assistantWorkspace'))return;
  const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
  const format=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):'';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const round=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
  const number=v=>v===''||v==null?null:(Number.isFinite(Number(v))?Number(v):null);
  const example=`Olá, Feito em Forma! Gostaria de solicitar um orçamento.\n\nCliente: Kethyleen\nTelefone: 11958108697\n\nProdutos selecionados:\n1. Calendário do Advento de Natal\nQuantidade: 1\nValor unitário: R$ 120,00\nSubtotal: R$ 120,00\nMedidas: 5cm x 10cm\n\n2. Placa Welcome Grinch\nQuantidade: 1\nValor unitário: R$ 30,00\nSubtotal: R$ 30,00\nMedidas: 20 × 15 cm\n\n3. Enfeite Ho Ho Ho\nQuantidade: 1\nValor unitário: R$ 15,00\nSubtotal: R$ 15,00\nMedidas: 20 × 13 cm\n\nTotal estimado: R$ 165,00\nObservações: Nenhuma\n\nPodem confirmar disponibilidade, valor final e prazo?`;
  const state={parsed:null,items:[],products:[],inventory:[],saving:false,loading:false,lastOwner:'',lastCode:'',stage:'a_fazer',notes:'',client:'',phone:'',mismatchChecked:false};
  function message(text,who='bot'){
    const bubble=document.createElement('div');bubble.className='assistant-bubble assistant-'+who;
    bubble.textContent=String(text).slice(0,15000);
    $('assistantMessages').append(bubble);
    const bubbles=$('assistantMessages').querySelectorAll('.assistant-bubble');
    if(bubbles.length>7)bubbles[1].remove();
    $('assistantMessages').scrollTop=$('assistantMessages').scrollHeight;
  }
  function status(text){$('assistantGuidance').textContent=text;}
  function user(){return bridge.user?.();}
  function productPrice(product){return number(product?.price);}
  function productCost(product){
    if(!product)return {cost:null,detail:'Selecione um produto ou informe um custo unitário.'};
    const linked=state.inventory.find(item=>item.catalog_product_id===product.id && Number.isFinite(Number(item.cost)) && Number(item.cost)>0);
    if(linked)return {cost:round(linked.cost),detail:'Custo do Estoque (unitário)'};
    const history=bridge.quotes?.()||[];
    const ref=history.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).flatMap(q=>Array.isArray(q.calculatorData?.items)?q.calculatorData.items:[]).find(item=>P.norm(item.name)===P.norm(product.name) && (P.norm(item.materialType||'')===P.norm(product.material||'') || !item.materialType));
    if(ref&&Number.isFinite(Number(ref.production))&&Number(ref.production)>0)return {cost:round(ref.production),detail:'Custo registrado em orçamento anterior (conferir se está atualizado)'};
    const data=product.product_data||{};
    const owner=user()?.id||'';
    let settings=null;
    try{settings=JSON.parse(localStorage.getItem(`fef_settings_v1_user_${owner}`)||'null');}catch(_){}
    // Sem todos os parâmetros de custo, não é seguro estimar lucro.
    const required=['prod_peso','prod_temp_imp','prod_temp_prep','prod_emb','prod_extras'];
    const costKg=data.prod_custo_filamento!==''&&data.prod_custo_filamento!=null?number(data.prod_custo_filamento):number(settings?.p_filamento);
    if(required.every(k=>data[k]!==''&&data[k]!=null&&Number.isFinite(Number(data[k]))) && costKg!==null && settings && ['p_perdas','p_consumo','p_energia','p_depreciacao','p_maodeobra'].every(k=>settings[k]!==''&&settings[k]!=null&&Number.isFinite(Number(settings[k])))){
      const material=(Number(data.prod_peso)/1000)*costKg*(1+Number(settings.p_perdas)/100);
      const energy=Number(data.prod_temp_imp)*(Number(settings.p_consumo)/1000)*Number(settings.p_energia);
      const cost=material+energy+Number(data.prod_temp_imp)*Number(settings.p_depreciacao)+Number(data.prod_temp_prep)*Number(settings.p_maodeobra)+Number(data.prod_emb)+Number(data.prod_extras);
      return {cost:cost>0?round(cost):null,detail:'Estimado pelos dados da Calculadora neste aparelho (sem taxas de marketplace)'};
    }
    return {cost:null,detail:'Custo não disponível na base: informe manualmente o custo de fabricação por unidade.'};
  }
  function historyProducts(){
    const arr=[];
    for(const q of bridge.quotes?.()||[]){
      const parts=q.calculatorData?.items?.length?q.calculatorData.items:[];
      for(const item of parts){
        const name=String(item.name||'').trim();
        if(!name)continue;
        const material=item.materialType||'PLA';
        if(arr.some(p=>P.norm(p.name)===P.norm(name)&&P.norm(p.material)===P.norm(material)))continue;
        arr.push({id:`historico:${q.id}:${arr.length}`,name,material,price:item.unitPrice,description:item.description||'',product_data:item.productFields||{},historicalProduction:item.production,origin:'historico'});
      }
    }
    return arr.slice(0,800);
  }
  async function loadProducts(force=false){
    const account=user();if(!account||!bridge.client?.())throw new Error('Entre no Planner para localizar seus produtos cadastrados.');
    if(state.loading)return;
    if(!force&&state.lastOwner===account.id&&state.products.length)return;
    if(state.lastOwner && state.lastOwner!==account.id){
      state.parsed=null;state.items=[];state.products=[];state.inventory=[];state.lastCode='';state.client='';state.phone='';state.notes='';
      $('assistantText').value='';$('assistantPreview').className='assistant-preview-empty';$('assistantPreview').textContent='Cole a mensagem do cliente para começar.';
      $('assistantMessages').replaceChildren();message('Nova conta conectada. Cole a mensagem para criar um pedido.');
    }
    state.loading=true;
    try{
      const client=bridge.client(),id=account.id;
      const {data:catalog,error}=await client.from('studio_products').select('id,name,material,price,description,product_data,category,stock').eq('owner_id',id).order('name',{ascending:true}).limit(1000);
      if(error)throw error;
      const {data:inventory,error:invError}=await client.from('studio_inventory').select('catalog_product_id,cost,name').eq('owner_id',id).limit(1000);
      if(invError)throw invError;
      if(user()?.id!==id)return;
      const saved=(catalog||[]).map(p=>({...p,origin:'cadastro'}));
      const seen=new Set(saved.map(p=>P.norm(p.name)+'|'+P.norm(p.material)));
      const historical=historyProducts().filter(p=>!seen.has(P.norm(p.name)+'|'+P.norm(p.material)));
      state.products=[...saved,...historical];
      state.inventory=inventory||[];state.lastOwner=id;
      return state.products;
    }finally{state.loading=false;}
  }
  function candidates(item){
    return state.products.map(p=>({...p,score:P.similarity(item.originalName,p.name)})).filter(p=>p.score>=25).sort((a,b)=>b.score-a.score||String(a.name).localeCompare(String(b.name),'pt-BR')).slice(0,10);
  }
  function suggestMatch(item){
    const list=candidates(item);
    if(list.length===1&&list[0].score===100)return list[0];
    if(list.length>1&&list[0].score===100&&list[1].score<100)return list[0];
    return null;
  }
  function selectItem(item,product,wasAuto=false){
    item.productId=product?.id||'';item.costSource='';
    if(!product){item.cost='';item.costSource='Custo manual obrigatório';return;}
    if(item.price==null||item.price==='')item.price=productPrice(product)??'';
    const info=product.origin==='historico'&&Number.isFinite(Number(product.historicalProduction)) && Number(product.historicalProduction)>0?{cost:round(product.historicalProduction),detail:'Custo do último orçamento salvo (conferir se atualizado)'}:productCost(product);
    item.cost=info.cost===null?'':String(info.cost);item.costSource=info.detail;
    item.auto=wasAuto;
  }
  function showPreview(){
    const parsed=state.parsed;if(!parsed)return;
    const stages=bridge.assistantStages?.()||[{id:'a_fazer',label:'Orçamentos a fazer'}];
    const rows=state.items.map((item,i)=>{
      const optionList=candidates(item);
      const found=state.products.find(p=>p.id===item.productId);
      if(found&&!optionList.some(p=>p.id===found.id))optionList.unshift(found);
      const extra=state.products.filter(p=>!optionList.some(x=>x.id===p.id));
      const options=['<option value="">Sem vínculo — custo manual</option>', '<optgroup label="Sugestões para este item">',...optionList.map(p=>`<option value="${esc(p.id)}" ${p.id===item.productId?'selected':''}>${esc(p.name)} (${esc(p.material||'—')})${p.origin==='historico'?' · histórico':''}</option>`),'</optgroup>', '<optgroup label="Outros produtos cadastrados">',...extra.map(p=>`<option value="${esc(p.id)}" ${p.id===item.productId?'selected':''}>${esc(p.name)} (${esc(p.material||'—')})</option>`),'</optgroup>'].join('');
      const flag=item.productId?(item.auto?'Identificado automaticamente':'Vinculado após revisão'):'Revisar vínculo do produto';
      return `<article class="assistant-item" data-index="${i}"><div class="assistant-item-title"><span class="assistant-number">${i+1}</span><div><strong>${esc(item.originalName)}</strong><small>${esc(item.measures?`Medidas: ${item.measures}`:'Sem medidas informadas')}</small></div><span class="assistant-match ${item.productId?'ok':'warn'}">${flag}</span></div><label class="assistant-field wide"><span>Produto da base</span><select data-attr="productId" data-index="${i}">${options}</select></label><div class="assistant-item-fields"><label class="assistant-field"><span>Quantidade</span><input type="number" min="1" max="100000" step="1" data-index="${i}" data-attr="quantity" value="${esc(item.quantity??'')}"></label><label class="assistant-field"><span>Venda por unidade (R$)</span><input type="number" min="0.01" step="0.01" data-index="${i}" data-attr="price" value="${esc(item.price??'')}"></label><label class="assistant-field"><span>Custo por unidade (R$)</span><input type="number" min="0" step="0.01" data-index="${i}" data-attr="cost" value="${esc(item.cost)}" placeholder="Informar"></label></div><p class="assistant-item-cost">${esc(item.costSource||'Informe o custo para calcular o lucro.')}</p></article>`;
    }).join('');
    $('assistantPreview').className='assistant-preview';
    $('assistantPreview').innerHTML=`<div class="assistant-identity"><label class="assistant-field"><span>Cliente</span><input id="assistantClient" maxlength="100" value="${esc(state.client)}" autocomplete="name"></label><label class="assistant-field"><span>WhatsApp / telefone</span><input id="assistantPhone" maxlength="25" value="${esc(state.phone)}" inputmode="tel"></label><label class="assistant-field"><span>Etapa inicial</span><select id="assistantStage">${stages.map(s=>`<option value="${esc(s.id)}" ${s.id===state.stage?'selected':''}>${esc(s.label)}</option>`).join('')}</select></label></div><div class="assistant-item-list">${rows}</div><label class="assistant-field assistant-notes"><span>Observações do pedido</span><textarea id="assistantNotes" rows="2" maxlength="600">${esc(state.notes)}</textarea></label><div class="assistant-totals" id="assistantTotals"></div><div class="assistant-notices" id="assistantNotices"></div><label id="assistantMismatchBox" class="assistant-confirm" hidden><input id="assistantMismatch" type="checkbox"><span>Conferi os valores: o total calculado não corresponde ao total informado na mensagem.</span></label><button type="button" class="button primary assistant-save" id="assistantSave">✓ Salvar pedido no Quadro</button><p class="assistant-save-status" id="assistantSaveStatus" aria-live="polite"></p>`;
    refreshTotals();
    if($('assistantMismatch'))$('assistantMismatch').checked=state.mismatchChecked;
  }
  function totals(){
    const values=state.items.map(item=>({qty:number(item.quantity),price:number(item.price),cost:number(item.cost)}));
    return {gross:round(values.reduce((sum,i)=>sum+(i.qty||0)*(i.price||0),0)),cost:round(values.reduce((sum,i)=>sum+(i.qty||0)*(i.cost||0),0)),missing:values.some(i=>i.qty===null||!Number.isInteger(i.qty)||i.qty<1||i.qty>100000||i.price===null||i.price<=0||i.cost===null||i.cost<0),totalQty:values.reduce((sum,i)=>sum+(i.qty||0),0)};
  }
  function refreshTotals(){
    if(!$('assistantTotals'))return;
    const t=totals();
    $('assistantTotals').innerHTML=`<div><small>Venda bruta</small><strong>${money(t.gross)}</strong></div><div><small>Custos estimados</small><strong>${t.missing?'A conferir':money(t.cost)}</strong></div><div class="assistant-profit"><small>Lucro estimado</small><strong>${t.missing?'A conferir':money(round(t.gross-t.cost))}</strong></div><div><small>Margem estimada</small><strong>${t.missing||!t.gross?'A conferir':((t.gross-t.cost)/t.gross*100).toFixed(1).replace('.',',')+'%'}</strong></div>`;
    const alerts=[];
    if(t.missing)alerts.push('Preencha quantidade, valor de venda e custo de fabricação para cada item.');
    if(state.items.some(i=>!i.productId))alerts.push('Há produtos sem vínculo com a base. Selecione o produto correto ou mantenha sem vínculo e informe o custo.');
    if(state.parsed?.estimated!==null && Math.abs(t.gross-state.parsed.estimated)>0.015)alerts.push(`A mensagem indica ${money(state.parsed.estimated)}, mas a soma atual é ${money(t.gross)}.`);
    $('assistantNotices').innerHTML=(alerts.map(text=>`<div class="assistant-alert">${esc(text)}</div>`).join('')||'<div class="assistant-success">✓ Valores e quantidades prontos para revisão final.</div>')+'<p class="assistant-item-cost">Lucro estimado = venda bruta − custo de fabricação. Frete, impostos e taxas não cadastrados não são descontados.</p>';
    $('assistantMismatchBox').hidden=!(state.parsed?.estimated!==null && Math.abs(t.gross-state.parsed.estimated)>0.015);
    const btn=$('assistantSave');if(btn)btn.disabled=state.saving||t.missing||!state.items.length;
  }
  async function analyze(){
    if(state.saving)return;
    const text=$('assistantText').value.trim();
    if(!text){message('Cole primeiro a mensagem completa do cliente.');return;}
    if(text.length>15000){message('A mensagem ultrapassa 15 mil caracteres.');return;}
    message(text.length>360?text.slice(0,350)+'…':text,'human');
    try{
      status('Lendo a mensagem e procurando produtos cadastrados…');
      const parsed=P.parse(text);
      if(!parsed.items.length){message('Não encontrei uma lista de produtos numerada. Use “Produtos selecionados:” e itens como “1. Nome”, “Quantidade:” e “Valor unitário:”.');status('Nenhum pedido foi criado.');return;}
      await loadProducts(true);
      state.parsed=parsed;
      state.notes=parsed.notes||'';state.client=parsed.client||'';state.phone=parsed.phone||'';state.mismatchChecked=false;
      state.stage='a_fazer';
      state.items=parsed.items.map(item=>({originalName:item.name,quantity:item.quantity,price:item.unitPrice,cost:'',costSource:'',productId:'',measures:item.measures,errors:item.errors,auto:false}));
      let auto=0;
      for(const item of state.items){const match=suggestMatch(item);if(match){selectItem(item,match,true);auto++;}}
      showPreview();
      const total=money(parsed.computedTotal),summary=`Encontrei ${parsed.items.length} item(ns) para ${parsed.client||'cliente não identificado'}; venda bruta de ${total}. ${auto} produto(s) identificado(s) na base. ${parsed.estimated!==null&&parsed.discrepancy?'Há divergência no total informado.':''} Confira os custos e clique em Salvar pedido no Quadro.`;
      message(summary);status(`${parsed.items.length} produto(s) reconhecido(s). Revise nomes, valores e custo de cada peça.`);
    }catch(error){console.error('Assistente de Pedidos:',error);message('Não consegui processar: '+(error.message||'erro ao consultar a base')+'. Nenhum pedido foi criado.');status('Não foi possível montar o pedido.');}
  }
  async function saveOrder(){
    if(state.saving)return;
    const t=totals();
    if(t.missing){message('Preencha todos os preços e custos antes de salvar.');return;}
    const client=String($('assistantClient')?.value||'').trim();
    if(!client){$('assistantClient').focus();message('Falta o nome do cliente.');return;}
    const mismatch=state.parsed?.estimated!==null&&Math.abs(t.gross-state.parsed.estimated)>0.015;
    if(mismatch&&!$('assistantMismatch')?.checked){message('Existe divergência em relação ao total da mensagem. Marque a confirmação após conferir.');return;}
    const prepared=state.items.map(item=>{
      const matched=state.products.find(p=>p.id===item.productId);
      return {name:matched?.name||item.originalName,quantity:Number(item.quantity),unitPrice:Number(item.price),production:Number(item.cost),materialType:matched?.material||'PLA',description:item.measures?`Medidas: ${item.measures}`:'',sourceProductId:matched?.id||''};
    });
    state.saving=true;refreshTotals();
    $('assistantSave').textContent='Salvando na nuvem...';
    try{
      const result=await bridge.assistantSave({client,phone:$('assistantPhone')?.value||'',status:$('assistantStage')?.value||'a_fazer',notes:$('assistantNotes')?.value||'',items:prepared});
      state.lastCode=result.code;
      message(`✓ Pedido ${result.code} salvo no Quadro. Bruto: ${money(result.total)} | Custo: ${money(result.cost)} | Lucro estimado: ${money(result.profit)}.`);
      $('assistantSaveStatus').textContent=`Pedido ${result.code} salvo na nuvem!`;
      $('assistantSave').outerHTML='<button type="button" class="button secondary assistant-save" id="assistantOpenSaved">Ver pedido salvo →</button>';
      status('Pedido criado com sucesso! Você pode abrir os detalhes ou colar outra mensagem.');
    }catch(error){message('Falha ao salvar: '+(error.message||'verifique a conexão')+'. O pedido não foi confirmado.');$('assistantSaveStatus').textContent='Não foi possível confirmar o salvamento.';}
    finally{state.saving=false;if($('assistantSave')){$('assistantSave').textContent='✓ Salvar pedido no Quadro';refreshTotals();}}
  }
  const exampleBtn=$('assistantExample');
  exampleBtn?.addEventListener('click',()=>{$('assistantText').value=example;$('assistantText').focus();});
  $('assistantMessageForm')?.addEventListener('submit',event=>{event.preventDefault();analyze();});
  $('assistantPreview')?.addEventListener('change',event=>{
    const target=event.target;
    if(target.dataset.attr==='productId'){
      state.client=$('assistantClient')?.value||'';state.phone=$('assistantPhone')?.value||'';state.notes=$('assistantNotes')?.value||'';state.mismatchChecked=Boolean($('assistantMismatch')?.checked);
      const item=state.items[Number(target.dataset.index)];
      if(!item)return;
      const product=state.products.find(p=>p.id===target.value);
      selectItem(item,product);showPreview();
    }else if(target.id==='assistantStage')state.stage=target.value;
  });
  $('assistantPreview')?.addEventListener('input',event=>{
    const input=event.target;
    if(input.id==='assistantNotes')state.notes=input.value;
    if(input.id==='assistantClient')state.client=input.value;
    if(input.id==='assistantPhone')state.phone=input.value;
    if(input.id==='assistantMismatch')state.mismatchChecked=input.checked;
    if(input.dataset.attr&&input.dataset.attr!=='productId'){
      const item=state.items[Number(input.dataset.index)];
      if(item){item[input.dataset.attr]=input.value;if(input.dataset.attr==='cost')item.costSource='Custo revisado manualmente';refreshTotals();}
    }
  });
  $('assistantPreview')?.addEventListener('click',event=>{
    if(event.target.closest('#assistantSave'))saveOrder();
    if(event.target.closest('#assistantOpenSaved'))bridge.assistantOpenSaved?.(state.lastCode);
  });
  window.addEventListener('feito:assistant-open',()=>{
    if(!user())return;
    if(state.lastOwner!==user().id)loadProducts(true).catch(error=>status('Faça login e verifique os produtos: '+(error.message||'')));
  });
})();
