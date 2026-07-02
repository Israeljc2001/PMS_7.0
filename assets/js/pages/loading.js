function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function setStep(text){const el=document.getElementById('loading-step');if(el)el.textContent=text}

async function tryPreload(to){
  try{
    setStep('Pré-carregando recursos...');
    await fetch(to,{credentials:'same-origin',cache:'force-cache'}).catch(()=>null);
  }catch(e){console.warn('preload ignorado',e)}
}

window.addEventListener('DOMContentLoaded',async()=>{
  const params=new URLSearchParams(window.location.search);
  const to=params.get('to')||'index.html';
  const delay=Number(params.get('delay')||1000);
  const msg=params.get('msg');
  const messageEl=document.getElementById('loading-message');
  if(msg&&messageEl)messageEl.textContent=msg;

  await Promise.allSettled([
    wait(Number.isFinite(delay)?delay:1000),
    tryPreload(to)
  ]);

  setStep('Abrindo área de trabalho...');
  setTimeout(()=>{window.location.href=to},220);
});
