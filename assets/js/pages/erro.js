window.addEventListener('DOMContentLoaded',()=>{
  const params=new URLSearchParams(window.location.search);
  const code=params.get('code');
  const title=params.get('title');
  const msg=params.get('msg');
  if(code)document.getElementById('error-code').textContent=`Erro ${code}`;
  if(title)document.getElementById('error-title').textContent=title;
  if(msg)document.getElementById('error-message').textContent=msg;
});