/* Feito em Forma v17. Extrator determinístico: não faz chamadas externas. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FeitoPedidoParser=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const clean=value=>String(value||'').replace(/\uFFFD/g,' ').replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g,' ').replace(/\s+/g,' ').trim();
  const norm=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
  function price(value){
    if(value==null)return null;
    let str=String(value).replace(/R\$|\s/gi,'').replace(/[^\d.,-]/g,'');
    if(!str||str.startsWith('-'))return null;
    if(str.includes(',')&&str.includes('.')){
      if(str.lastIndexOf(',')>str.lastIndexOf('.'))str=str.replace(/\./g,'').replace(',','.');
      else str=str.replace(/,/g,'');
    }else if(str.includes(','))str=str.replace(',','.');
    else if(/^\d{1,3}(?:\.\d{3})+$/.test(str))str=str.replace(/\./g,'');
    const amount=Number(str);
    return Number.isFinite(amount)&&amount>=0&&amount<=1e9?Math.round((amount+Number.EPSILON)*100)/100:null;
  }
  function lineValue(text,label){
    const lines=String(text).split(/\r?\n/);
    const normalizedLabel=norm(label);
    const line=lines.find(v=>norm(v.split(':')[0])===normalizedLabel && v.includes(':'));
    return line?clean(line.slice(line.indexOf(':')+1)):'';
  }
  function parse(text){
    const raw=String(text||'').replace(/\r\n/g,'\n');
    if(raw.length>15000)throw new Error('A mensagem é muito grande. Limite de 15.000 caracteres.');
    const client=lineValue(raw,'Cliente');
    const phoneDigits=lineValue(raw,'Telefone').replace(/\D/g,'');
    const phone=phoneDigits.length>=10&&phoneDigits.length<=13?phoneDigits:lineValue(raw,'Telefone');
    const estimated=price(lineValue(raw,'Total estimado'));
    const notes=lineValue(raw,'Observações');
    const lines=raw.split('\n');
    const items=[];
    const start=lines.findIndex(line=>/^\s*produtos\s+selecionados\s*:/i.test(norm(line).replace(/\s+:/g,':')) || /^\s*produtos\s+selecionados\s*:/i.test(line));
    const slice=start>=0?lines.slice(start+1):lines;
    const blocks=[];
    let current=null;
    for(const line of slice){
      if(/^\s*(?:total\s+estimado|observa[cç][oõ]es|podem\s+confirmar)\s*:/i.test(line))break;
      const match=line.match(/^\s*(\d{1,2})\s*[.)-]\s+(.+)$/u);
      if(match){
        if(current)blocks.push(current);
        current={index:Number(match[1]),name:clean(match[2]),lines:[]};
      }else if(current)current.lines.push(line);
    }
    if(current)blocks.push(current);
    for(const block of blocks.slice(0,60)){
      const body=block.lines.join('\n');
      const quantityRaw=lineValue(body,'Quantidade');
      const quantity=quantityRaw?Number(quantityRaw.replace(/\D/g,'')):null;
      const unitPrice=price(lineValue(body,'Valor unitário'));
      const subtotal=price(lineValue(body,'Subtotal'));
      const measures=lineValue(body,'Medidas');
      const errors=[];
      if(!Number.isInteger(quantity)||quantity<1||quantity>100000)errors.push('Quantidade ausente ou inválida');
      if(unitPrice===null&&subtotal===null)errors.push('Preço ausente');
      if(unitPrice!==null && quantity>0 && subtotal!==null && Math.abs(quantity*unitPrice-subtotal)>0.015)errors.push('Subtotal informado não confere');
      const resolvedPrice=unitPrice!==null?unitPrice:quantity>0&&subtotal!==null?Math.round(subtotal/quantity*100)/100:null;
      items.push({name:block.name,quantity,unitPrice:resolvedPrice,subtotal,measures,errors});
    }
    const sum=items.reduce((n,item)=>n+((item.quantity||0)*(item.unitPrice||0)),0);
    const computedTotal=Math.round((sum+Number.EPSILON)*100)/100;
    return {client,phone,notes:notes==='Nenhuma'?'':notes,items,estimated,computedTotal,discrepancy:estimated!==null&&Math.abs(computedTotal-estimated)>0.015,
      warnings:[...(!client?['Nome do cliente não identificado']:[]),...(!items.length?['Nenhum produto reconhecido']:[]),...(phoneDigits&&!(phoneDigits.length>=10&&phoneDigits.length<=13)?['Telefone fora do padrão; confira']:[])]};
  }
  function similarity(a,b){
    const x=norm(a),y=norm(b);
    if(!x||!y)return 0;
    if(x===y)return 100;
    const xt=x.split(' '),yt=y.split(' ');
    const intersection=new Set(xt.filter(word=>word.length>1&&yt.includes(word)));
    let score=intersection.size/Math.max(xt.length,yt.length)*74;
    if(x.includes(y)||y.includes(x))score+=19;
    if(xt[0]===yt[0])score+=9;
    return Math.min(98,Math.round(score));
  }
  return Object.freeze({parse,norm,price,similarity});
});
