/* NailHub — Multi-tenant manicura: SuperAdmin / Owner / Worker / Client + kv persist */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const app=$("#app"), modalRoot=$("#modalRoot"), toastRoot=$("#toastRoot");
const LS_T="nailhub_theme", LS_S="nailhub_session";
let DB=null, S=loadSess(), THEME=localStorage.getItem(LS_T)||"light";
document.documentElement.dataset.theme=THEME;
function loadSess(){try{const s=JSON.parse(localStorage.getItem(LS_S))||{};return Object.assign({role:null,businessId:null,staffId:null,userId:null,token:null},s)}catch(e){return{role:null,businessId:null,staffId:null,userId:null,token:null}}}
function saveSess(){localStorage.setItem(LS_S,JSON.stringify(S))}
const uid=p=>(p||"id")+"_"+Math.random().toString(36).slice(2,9);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayStr=()=>new Date().toISOString().slice(0,10);
const fmtD=iso=>{try{const[d,Y,M]=[iso.slice(8,10),iso.slice(0,4),iso.slice(5,7)];return `${d}/${M}/${Y}`}catch(e){return iso}};
const cup=n=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Math.round(Number(n||0)))+" CUP";
const usdOf=c=>FX.usd>0?(c/FX.usd).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}):null;
function money(c){const u=usdOf(c);return cup(c)+(u!=null?` (≈ $${u} USD)`:"")}
const eur=money; // compat: todo el dinero ya es CUP
let FX={usd:0,eur:0,at:0,src:""};
async function fetchFxRate(){
  try{
    const now=new Date(),ago=new Date(now.getTime()-6*864e5);
    const url=`https://api.cambiocuba.money/api/v1/x-rates-wnu?msg=false&date_from=${ago.toISOString().slice(0,10)}&date_to=${now.toISOString().slice(0,10)}`;
    const r=await root.superFetch(url).then(r=>r.json());
    const S=r.statistics||{};
    const U=S["USD.CUP"]||{},E=S["ECU.CUP"]||S["EUR.CUP"]||{};
    const usd=U.median||U.avg,eur=(E.median||E.avg);
    if(usd>0)return{usd,eur:eur||0,at:Date.now(),date:r.date||now.toISOString().slice(0,10),src:"elToque"};
  }catch(e){}
  return null;
}
async function loadFx(force){
  if(DB.fxManual&&DB.fxManual.usd>0&&!force){FX=Object.assign({src:"manual"},DB.fxManual);return FX}
  const c=DB.fx;
  if(c&&c.usd>0&&Date.now()-(c.at||0)<3600e3&&!force){FX=c;return FX}
  const fresh=await fetchFxRate();
  if(fresh&&fresh.usd>0){FX=fresh;DB.fx=fresh;await save();return FX}
  if(c&&c.usd>0){FX=c;return FX}
  return FX;
}
function fxAgo(){if(!FX.at)return"sin tasa aún";const m=Math.round((Date.now()-FX.at)/60000);return m<1?"ahora mismo":m<60?`hace ${m} min`:`hace ${Math.round(m/60)} h`}
const normPhone=p=>String(p||"").replace(/\D/g,"");
function waLink(bObj,msg){const d=normPhone(bObj&&bObj.phone);return "https://wa.me/"+d+"?text="+encodeURIComponent(msg||("Hola "+(bObj?bObj.name:"")+", quiero una cuenta para reservar"))}
const currentUser=()=>DB&&DB.users?DB.users.find(u=>u.id===S.userId&&u.active!==false)||null:null;
const INACT_DAYS=90;
function daysSince(ts){return Math.floor((Date.now()-(ts||0))/86400000)}
function userLastActive(u){return Math.max(u.lastBookingAt||0,u.createdAt||0)}
function purgeInactiveUsers(){if(!DB||!DB.users)return 0;const cut=Date.now()-INACT_DAYS*86400000;const b4=DB.users.length;DB.users=DB.users.filter(u=>userLastActive(u)>=cut);return b4-DB.users.length}
function toast(m){const t=document.createElement("div");t.className="toast";t.textContent=m;toastRoot.appendChild(t);setTimeout(()=>t.remove(),3200)}
function ripple(e,b){b=b||e.currentTarget;const r=document.createElement("span");r.className="ripple";const rc=b.getBoundingClientRect();const s=Math.max(rc.width,rc.height);r.style.width=r.style.height=s+"px";r.style.left=(e.clientX-rc.left-s/2)+"px";r.style.top=(e.clientY-rc.top-s/2)+"px";b.appendChild(r);setTimeout(()=>r.remove(),650)}
document.addEventListener("click",e=>{const b=e.target.closest?.(".btn");if(!b)return;try{ripple(e,b)}catch(_){}});
function closeModal(){modalRoot.innerHTML=""}
function modal(html){modalRoot.innerHTML=`<div class="mback" onclick="if(event.target===this)window.__nhClose()"><div class="modal">${html}</div></div>`}
window.__nhClose=closeModal;

/* ---------- servidor (base de datos) ---------- */
const NH_API="https://script.google.com/macros/s/AKfycbzQg1DrpIa3NDqlW2bVCd-5CWEs5O2wNcOKu-kK4TMIOVXKQhOncY5oHEv9BTpOiNC_ZQ/exec";
let NH_ONLINE=false, NH_SYNC_T=null;
function nhConn(){document.querySelectorAll(".nh-conn").forEach(el=>{el.classList.toggle("ok",NH_ONLINE);el.classList.toggle("bad",!NH_ONLINE);el.innerHTML=`<i></i>${NH_ONLINE?"Conectado":"Sin conexión"}`})}
async function nhApi(payload){
  const r=await fetch(NH_API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});
  const j=await r.json();
  NH_ONLINE=true;nhConn();
  return j;
}
async function nhPing(){try{const r=await nhApi({action:"ping"});if(r&&r.superUser){SUPER.user=r.superUser;try{localStorage.setItem("nh_super_user",r.superUser)}catch(e){}}}catch(e){NH_ONLINE=false;nhConn()}}
function nhScrub(){if(!DB)return;for(const b of DB.businesses||[])delete b._newPass;for(const s of DB.staff||[])delete s._newPass;for(const u of DB.users||[])delete u._newPass}
async function nhSubirFoto(dataUrl){
  if(!S.token)return null;
  try{const r=await nhApi({action:"img_upload",token:S.token,dataUrl});if(r&&r.ok)return r}catch(e){}
  return null;
}

/* ---------- DB ---------- */
function seed(){
  return {businesses:[],services:[],staff:[],bookings:[],gallery:[],notes:[],users:[]};
}
async function kvGet(){try{if(root?.kv?.nailhub) return await root.kv.nailhub.get("db")}catch(e){} return null}
async function kvSet(db){try{if(root?.kv?.nailhub) await root.kv.nailhub.set("db",db)}catch(e){} try{localStorage.setItem("nailhub_db",JSON.stringify(db).slice(0,4500000))}catch(e){}}
async function loadDB(){
  let db=null;
  try{
    let r=S.token?await nhApi({action:"db_get",token:S.token}):await nhApi({action:"boot"});
    if(r&&r.ok===false&&S.token){S.token=null;saveSess();r=await nhApi({action:"boot"})}
    if(r&&r.ok&&r.db)db=r.db;
  }catch(e){NH_ONLINE=false}
  if(!db)db=await kvGet();
  if(!db){try{db=JSON.parse(localStorage.getItem("nailhub_db")||"null")}catch(e){db=null}}
  if(!db||!db.businesses){db=seed();await kvSet(db)}
  if(!db.users)db.users=[];
  // migración: reservas antiguas sin userId -> crear usuario si hace falta
  for(const bk of db.bookings){
    if(!bk.userId&&bk.clientPhone){
      let u=db.users.find(x=>normPhone(x.phone)===normPhone(bk.clientPhone));
      if(!u){u={id:uid("u"),name:bk.clientName||"Clienta",phone:bk.clientPhone,_newPass:"1234",approvedBy:bk.businessId,active:true,createdAt:bk.createdAt||Date.now(),lastBookingAt:bk.createdAt||Date.now()};db.users.push(u)}
      bk.userId=u.id;
    }
  }
  DB=db;
  // dedup por teléfono (misma cuenta universal) quedándonos la más reciente
  const seen={};
  for(const u of DB.users){const k=normPhone(u.phone);if(!seen[k]||userLastActive(u)>userLastActive(seen[k]))seen[k]=u}
  DB.users=Object.values(seen);
  for(const bk of DB.bookings){if(bk.clientPhone){const u=DB.users.find(x=>normPhone(x.phone)===normPhone(bk.clientPhone));if(u)bk.userId=u.id}}
  // credenciales de equipo: slug único por defecto
  const slug=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").slice(0,14)||"user";
  const usedLogin=new Set(["admin"]);
  for(const b of DB.businesses){if(!b.ownerUser)b.ownerUser=slug(String(b.name||"").split(/[\s·&]+/)[0])||"duena";while(usedLogin.has(b.ownerUser.toLowerCase()))b.ownerUser+="_1";usedLogin.add(b.ownerUser.toLowerCase());}
  for(const s of DB.staff){if(!s.user)s.user=slug(String(s.name||"").split(/\s+/)[0]);while(usedLogin.has(s.user.toLowerCase()))s.user+="_1";usedLogin.add(s.user.toLowerCase());}
  // migración EUR -> CUP (una sola vez): valores <1000 se asumen en EUR y se convierten
  if(!db.currency){
    const fx=await fetchFxRate();
    if(fx&&fx.usd>0){
      const R=fx.usd,cv=v=>Math.round(Number(v||0)*R);
      for(const s of db.services||[]){if(Number(s.price||0)<1000)s.price=cv(s.price);for(const i of s.includes||[])if(Number(i.price||0)>0&&Number(i.price)<1000)i.price=cv(i.price)}
      for(const bk of db.bookings||[])if(Number(bk.total||0)<1000)bk.total=cv(bk.total);
      db.currency="CUP";db.fx=fx;
      console.log("precios migrados EUR->CUP a tasa",R);
    }
  }
  const purged=purgeInactiveUsers();
  await kvSet(DB);
  if(purged>0)console.log("usuarios inactivos purgados:",purged)
}
async function save(){
  await kvSet(DB);
  if(!S.token||!DB)return;
  clearTimeout(NH_SYNC_T);
  NH_SYNC_T=setTimeout(async()=>{
    try{
      const r=await nhApi({action:"db_set",token:S.token,baseVersion:DB.version||0,db:JSON.parse(JSON.stringify(DB))});
      if(r&&r.ok){DB.version=r.version;nhScrub();await kvSet(DB)}
      else if(r&&r.conflict){const g=await nhApi({action:"db_get",token:S.token});if(g&&g.ok){DB=g.db;await kvSet(DB);try{render()}catch(e){}toast("Datos actualizados desde el servidor ↻")}}
    }catch(e){NH_ONLINE=false;nhConn()}
  },700);
}

/* ---------- helpers dominio ---------- */
const biz=id=>DB.businesses.find(b=>b.id===id);
const bizSvcs=id=>DB.services.filter(s=>s.businessId===id&&s.active);
const bizStaff=id=>DB.staff.filter(s=>s.businessId===id&&s.active);
const dayBookings=(bid,date)=>DB.bookings.filter(b=>b.businessId===bid&&b.date===date&&b.status!=="cancelled");
function isOpen(b,dateStr){const d=new Date(dateStr+"T12:00:00");const h=b.hours[d.getDay()];if(!h||!h.on)return false;const ov=b.overrides?.[dateStr];if(ov?.closed)return false;return true}
function maxFor(b,dateStr){return b.overrides?.[dateStr]?.max??b.maxPerDay}
function genSlots(b,dateStr){
  if(!isOpen(b,dateStr))return[];
  const d=new Date(dateStr+"T12:00:00");const h=b.hours[d.getDay()];
  const [oh,om]=h.o.split(":").map(Number),[ch,cm]=h.c.split(":").map(Number);
  let t=oh*60+om,end=ch*60+cm;const out=[];
  while(t+ b.slotMin<=end){const hh=String(Math.floor(t/60)).padStart(2,"0"),mm=String(t%60).padStart(2,"0");out.push(`${hh}:${mm}`);t+=b.slotMin}
  return out;
}
function freeSlots(b,dateStr){
  const all=genSlots(b,dateStr);
  const taken=new Set(dayBookings(b.id,dateStr).map(x=>x.time));
  const cap=maxFor(b,dateStr),used=dayBookings(b.id,dateStr).length;
  return all.map(t=>({t,free:!taken.has(t)&&used<cap}));
}
function svcTotal(s,extras){return s.price+(s.includes||[]).filter(i=>!i.included&&extras.includes(i.name)).reduce((a,i)=>a+i.price,0)}

/* ---------- shell render ---------- */
let UI={view:"home",calMonth:todayStr().slice(0,7),calDate:todayStr(),pickBiz:null,pickSvc:null,pickTime:null,pickStaff:null,pickExtras:[],monthAdm:todayStr().slice(0,7)};
function setTheme(t){THEME=t;document.documentElement.dataset.theme=t;localStorage.setItem(LS_T,t);render()}
function enter(role,patch){S=Object.assign({role,businessId:null,staffId:null,userId:null},(patch||{}));saveSess();UI.view="home";render()}
function logout(){S={role:null,businessId:null,staffId:null,userId:null,token:null};saveSess();UI.view="home";render()}

async function render(){
  const bCount=DB.businesses.filter(b=>b.active).length;
  const bkCount=DB.bookings.filter(b=>b.status!=="cancelled").length;
  const roleName={super:"Super Admin",owner:"Propietaria",worker:"Trabajadora",client:"Cliente"}[S.role]||"Invitada";
  const me=currentUser();
  let bizCtx=S.businessId?biz(S.businessId):null;
  const who=S.role==="client"&&me?` · ${esc(me.name)}`:"";
function fxPillHTML(){return FX.usd>0?`💱 1 USD = ${cup(FX.usd)} <small>· ${fxAgo()} · elToque</small>`:`💱 tasa…`}
  const bodyOnly=!S.role;
  app.innerHTML=`
  ${bodyOnly?"":`<header class="hdr">
    <div class="logo"><div class="logo-mark">💅</div><div>NAILHUB<small>multi-local · 2026</small></div></div>
    <nav>
      <button class="navbtn ${UI.view==="home"?"on":""}" data-v="home">Inicio</button>
      ${S.role==="client"?`<button class="navbtn ${UI.view==="book"?"on":""}" data-v="book">Reservar</button><button class="navbtn ${UI.view==="mine"?"on":""}" data-v="mine">Mis citas</button>`:``}
      ${S.role==="owner"?`<button class="navbtn ${UI.view==="dash"?"on":""}" data-v="dash">Panel</button>`:``}
      ${S.role==="worker"?`<button class="navbtn ${UI.view==="work"?"on":""}" data-v="work">Mi día</button>`:``}
      ${S.role==="super"?`<button class="navbtn ${UI.view==="global"?"on":""}" data-v="global">Global</button><button class="navbtn ${UI.view==="gal"?"on":""}" data-v="gal">Galería</button>`:``}
    </nav>
    <div class="sp"></div>
    <span class="pill"><span class="dot"></span>${esc(roleName)}${bizCtx?` · ${esc(bizCtx.name.split("·")[0])}`:""}${who}</span>
    <span class="pill" id="fxPill">${fxPillHTML()}</span>
    <span class="mini ok nh-conn"><i></i>Conectado</span>
    <button class="iconbtn" id="themeBtn" title="Tema">${THEME==="dark"?"☀️":"🌙"}</button>
    ${S.role?`<button class="btn sm ghost" id="outBtn">Salir</button>`:""}
  </header>`}
  <div id="body"></div>
  ${bodyOnly?"":`<div class="footer">NailHub · catálogos + calendario inteligente · datos en la base de datos de NailHub · ${bCount} locales activos · ${bkCount} reservas</div>`}`;
  try{nhConn()}catch(e){}
  if(!bodyOnly){
  app.querySelectorAll("[data-v]").forEach(x=>x.onclick=()=>{UI.view=x.dataset.v;render()});
  $("#themeBtn").onclick=()=>setTheme(THEME==="dark"?"light":"dark");
  const ob=$("#outBtn");if(ob)ob.onclick=logout;
  }
  const body=app.querySelector("#body");
  if(!S.role){body.innerHTML=homeHTML();bindHome(body);return}
  if(S.role==="client"&&!currentUser()){S={role:null,businessId:null,staffId:null,userId:null,token:null};saveSess();body.innerHTML=homeHTML();bindHome(body);toast("Tu usuario ya no existe (inactividad 3 meses o desactivado)");return}
  if(S.role==="client"){ if(UI.view==="mine")body.innerHTML=mineHTML(),bindMine(body); else if(UI.view==="book"||UI.pickBiz)body.innerHTML=bookHTML(),bindBook(body); else body.innerHTML=exploreHTML(),bindExplore(body); return}
  if(S.role==="super"){ if(UI.view==="gal"){body.innerHTML=galHTML(null);bindGal(body,null);return} body.innerHTML=superHTML();bindSuper(body);return}
  if(S.role==="owner"){body.innerHTML=ownerHTML();bindOwner(body);return}
  if(S.role==="worker"){body.innerHTML=workerHTML();bindWorker(body);return}
}

/* ---------- LOGIN (única pantalla pública) ---------- */
const ADMIN_WA="5353704722";
function homeHTML(){
  return `
  <div class="login-screen">
    <div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>
    <div class="login-card card">
      <div class="login-top"><span></span><div class="login-opts"><button class="mini" id="loginTheme">◐ ${THEME==="dark"?"Claro":"Oscuro"}</button><span class="mini ok nh-conn"><i></i>Conectado</span></div></div>
      <div class="login-logo">💅</div>
      <h2>NailHub</h2>
      <p class="sub">Tu agenda de belleza, clara y al día</p>
      <label class="fld"><span>👤</span><input id="liId" placeholder="Usuario o teléfono" autocomplete="username"></label>
      <label class="fld"><span>🔒</span><input id="liPass" type="password" placeholder="Contraseña" autocomplete="current-password"></label>
      <button class="go" id="liGo">Ingresar →</button>
      <button class="linklike" id="regOpen">¿Sin cuenta? <b>Registrar usuario</b></button>
      <p class="fine">ⓘ Acceso solo para usuarios registrados</p>
      <a class="linklike" target="_blank" href="https://wa.me/${ADMIN_WA}?text=${encodeURIComponent("Hola, necesito cambiar la contraseña de un usuario de NailHub")}">¿Olvidaste tu contraseña? Contacta al administrador</a>
    </div>
  </div>`;
}
function bizCard(b){
  const sv=bizSvcs(b.id).length;
  return `<div class="card biz" data-biz="${b.id}">
    <div class="cover" style="background:linear-gradient(135deg,${b.cover[0]},${b.cover[1]})">
      <span class="st">${b.active?"● ACTIVO":"⏸ SUSPENDIDO"}</span><span style="font-size:20px">⭐ ${b.rating} · ${esc(b.name)}</span>
    </div><div class="bizbody"><p>${esc(b.desc)}</p>
    <div class="meta"><span class="tag">📍 ${esc(b.addr)}</span><span class="tag">💅 ${sv} servicios</span><span class="tag">⏱ huecos de ${b.slotMin}′</span><span class="tag">🎟 ${b.maxPerDay}/día</span></div>
    <div class="row"><button class="btn sm" data-book="${b.id}">Reservar 💅</button><a class="btn sm ok" style="text-decoration:none;text-align:center" target="_blank" href="${waLink(b)}">💬 WhatsApp</a></div>
    <small style="color:var(--muted)">📞 ${esc(b.phone)} · cuenta creada por la dueña</small></div></div>`;
}
const SUPER={user:(function(){try{return localStorage.getItem("nh_super_user")||"admin"}catch(e){return "admin"}})(),pass:"adminred"};
function bindHome(body){
  const lt=document.querySelector("#loginTheme");
  if(lt)lt.onclick=()=>setTheme(THEME==="dark"?"light":"dark");
  const bad=()=>toast("Contraseña incorrecta. Si la olvidaste, contacta al administrador");
  const doLogin=async()=>{
    const id=(document.querySelector("#liId").value||"").trim();
    const pw=(document.querySelector("#liPass").value||"").trim();
    if(!id||!pw){toast("Escribe tu usuario y contraseña");return}
    const low=id.toLowerCase(),digits=normPhone(id);
    const localLogin=()=>{
      if(low===SUPER.user){if(pw!==SUPER.pass){bad();return}enter("super",{});UI.view="global";render();toast("Hola Admin 🛡️");return}
      const bo=DB.businesses.find(b=>(b.ownerUser||"").toLowerCase()===low);
      if(bo){if((bo.ownerPass||"")!==pw){bad();return}enter("owner",{businessId:bo.id});ownerTab="dash";UI.view="dash";render();toast("Hola 👑 "+bo.name.split("·")[0]);return}
      const st=DB.staff.find(s=>s.active!==false&&(s.user||"").toLowerCase()===low);
      if(st){if((st.pass||"")!==pw){bad();return}enter("worker",{businessId:st.businessId,staffId:st.id});workTab="hoy";UI.view="work";render();toast("Hola "+st.name+" 💅");return}
      const u=DB.users.find(x=>x.active!==false&&(digits&&normPhone(x.phone)===digits||(x.name||"").toLowerCase()===low||(x.user||"").toLowerCase()===low));
      if(!u){toast("Usuario no encontrado. Usa Registrar usuario 💅");return}
      if((u.pass||"")!==pw){bad();return}
      enter("client",{userId:u.id});UI.view="home";render();toast("Hola "+u.name+" 💅");
    };
    const kinds=low===SUPER.user?["super"]:["owner","staff","client"];
    for(const kind of kinds){
      let r=null;try{r=await nhApi({action:"login",kind,user:id,pass:pw})}catch(e){}
      if(r&&r.ok){
        DB=r.db;nhScrub();await kvSet(DB);
        if(kind==="super"){enter("super",{token:r.token});UI.view="global";render();toast("Hola Admin 🛡️");return}
        if(kind==="owner"){enter("owner",{businessId:r.businessId,token:r.token});ownerTab="dash";UI.view="dash";render();const b=biz(r.businessId);toast("Hola 👑 "+(b?b.name.split("·")[0]:""));return}
        if(kind==="worker"){enter("worker",{businessId:r.businessId,staffId:r.staffId,token:r.token});workTab="hoy";UI.view="work";render();toast("Hola 💅");return}
        enter("client",{userId:r.userId,token:r.token});UI.view="home";render();toast("Hola 💅");return;
      }
    }
    if(!NH_ONLINE){localLogin();return}
    bad();
  };
  document.querySelector("#liGo").onclick=doLogin;
  document.querySelector("#liPass").onkeydown=e=>{if(e.key==="Enter")doLogin()};
  document.querySelector("#liId").onkeydown=e=>{if(e.key==="Enter")doLogin()};
  document.querySelector("#regOpen").onclick=registerModal;
}
function registerModal(){
  const opts=DB.businesses.filter(b=>b.active).map((b,i)=>`<label class="pick"><input type="radio" name="rbBiz" value="${b.id}" ${i===0?"checked":""}><span><b>⭐ ${esc(b.name)}</b><small>📍 ${esc(b.addr)} · 📞 ${esc(b.phone)}</small></span></label>`).join("");
  modal(`<h3 style="margin-top:0">📝 Registrar usuario</h3>
  <p class="sub">Elige tu local, escribe tu usuario y tu contraseña <b>dos veces</b>. Se abrirá WhatsApp con tu solicitud y la dueña activará tu cuenta universal.</p>
  <label>Local donde quieres registrarte</label><div class="picklist">${opts||"No hay locales activos"}</div>
  <div class="row"><div><label>Usuario</label><input id="rgName" placeholder="Ej. Ana López"></div><div><label>Tu teléfono (WhatsApp)</label><input id="rgPhone" inputmode="tel" placeholder="600…"></div></div>
  <div class="row"><div><label>Contraseña</label><input id="rgP1" type="password" placeholder="Mínimo 4 caracteres"></div><div><label>Repetir contraseña</label><input id="rgP2" type="password" placeholder="Escríbela otra vez"></div></div>
  <div class="row" style="margin-top:12px"><button class="btn ghost" onclick="window.__nhClose()">Cancelar</button><button class="btn" id="rgGo">💬 Enviar solicitud</button></div>`);
  document.querySelector("#rgGo").onclick=()=>{
    const name=(document.querySelector("#rgName").value||"").trim();
    const phone=(document.querySelector("#rgPhone").value||"").trim();
    const p1=document.querySelector("#rgP1").value||"",p2=document.querySelector("#rgP2").value||"";
    const chk=modalRoot.querySelector('input[name="rbBiz"]:checked');
    if(!chk){toast("Elige un local");return}
    if(name.length<2){toast("Escribe tu nombre de usuario");return}
    if(normPhone(phone).length<6){toast("Escribe un teléfono válido");return}
    if(p1.length<4){toast("La contraseña debe tener al menos 4 caracteres");return}
    if(p1!==p2){toast("Las contraseñas no coinciden, repítelas");return}
    if(DB.users.some(u=>u.active!==false&&(normPhone(u.phone)===normPhone(phone)||(u.name||"").toLowerCase()===name.toLowerCase()))){toast("Ese usuario o teléfono ya tiene cuenta. Entra directamente");return}
    const b=biz(chk.value);
    closeModal();
    window.open(waLink(b,`Hola ${b.name}, quiero registrarme en NailHub. Usuario: ${name}. Teléfono: ${phone}. Mi contraseña elegida: ${p1}. Activen mi cuenta universal por favor`),"_blank");
    toast("Solicitud lista en WhatsApp 💬");
  };
}
/* ---------- CLIENT: explorar + reservar ---------- */
function exploreHTML(){
  const me=currentUser();
  return `<div class="card pad" style="margin-top:16px"><div class="row" style="align-items:end">
    <div><h2 style="margin:0">Explora locales 💅</h2><p class="sub">Hola <b>${esc(me?me.name:"clienta")}</b> · tu cuenta vale en <b>todos los locales</b>. Sin reserva en 3 meses se borra sola.</p></div>
    <div style="max-width:280px"><label>Buscar</label><input id="q" placeholder="nail art, rusa, express…"></div></div>
    <div class="bizgrid" id="bizGrid" style="margin-top:12px">${DB.businesses.filter(b=>b.active).map(bizCard).join("")}</div></div>`;
}
function bindExplore(body){
  const q=body.querySelector("#q"),grid=body.querySelector("#bizGrid");
  const paint=()=>{const t=(q.value||"").toLowerCase();grid.innerHTML=DB.businesses.filter(b=>b.active&&(!t||b.name.toLowerCase().includes(t)||b.desc.toLowerCase().includes(t)||bizSvcs(b.id).some(s=>s.name.toLowerCase().includes(t)))).map(bizCard).join("")||`<div class="empty">Sin resultados 🔍</div>`;
    grid.querySelectorAll("[data-book]").forEach(x=>x.onclick=()=>{UI.pickBiz=x.dataset.book;UI.view="book";UI.calDate=todayStr();UI.pickSvc=null;render()});
    grid.querySelectorAll("[data-biz]").forEach(c=>c.onclick=e=>{if(e.target.closest("[data-book]")||e.target.closest("a"))return;UI.pickBiz=c.dataset.biz;UI.view="book";UI.calDate=todayStr();UI.pickSvc=null;render()});};
  q.oninput=paint;paint();
}
function bookHTML(){
  const b=biz(UI.pickBiz)||DB.businesses.find(x=>x.active);
  if(!b)return `<div class="card pad empty">Local no disponible</div>`;
  UI.pickBiz=b.id;
  const svcs=bizSvcs(b.id), staff=bizStaff(b.id);
  const svc=svcs.find(s=>s.id===UI.pickSvc)||null;
  return `<div class="card pad" style="margin-top:16px">
    <button class="btn sm ghost" id="backBtn">← locales</button>
    <div class="cover" style="border-radius:16px;margin:12px 0;background:linear-gradient(135deg,${b.cover[0]},${b.cover[1]})"><span style="font-size:22px">⭐ ${b.rating} · ${esc(b.name)}</span><span class="st">${esc(b.addr)} · ${esc(b.phone)}</span></div>
    ${(()=>{const _g=DB.gallery.filter(g=>g.businessId===b.id).slice().reverse().slice(0,8);return `<div class="card pad" style="margin:0 0 12px;background:rgba(139,92,246,.05)"><h3 style="margin:0">📸 Trabajos de este local</h3><p class="sub">Fotos subidas por el equipo de ${esc(b.name.split("·")[0])}.</p><div class="gal">${_g.map(g=>`<div class="gitem">${g.img?`<img src="${g.img}" loading="lazy">`:`<div class="nailart" style="background:${g.bg}">${g.art}</div>`}<div class="gbody"><b>${esc(g.title)}</b><br><small style="color:var(--muted)">👩‍🎨 ${esc(g.staffName)} · <span class="like" data-like="${g.id}">🤍 ${g.likes}</span></small></div></div>`).join("")||`<div class="empty">Este local aún no sube fotos.</div>`}</div></div>`})()}
    <div class="grid2">
      <div><h3 style="margin:4px 0">1 · Elige servicio</h3><div style="display:flex;flex-direction:column;gap:10px">
        ${svcs.map(s=>`<div class="card svc ${svc?.id===s.id?"sel":""}" style="${svc?.id===s.id?"outline:2px solid var(--brand2)":""}" data-svc="${s.id}">
          <div class="row" style="align-items:center"><h3>${s.includedIcon||"💅"} ${esc(s.name)}</h3><div style="text-align:right;flex:none"><div class="price">${eur(s.price)}</div><small style="color:var(--muted);font-weight:700">⏱ ${s.durationMin}′</small></div></div>
          <p class="sub" style="font-size:13px;margin:6px 0">${esc(s.desc)}</p>
          <ul class="inc">${(s.includes||[]).map(i=>`<li><span>${i.included?"✅":"➕"}</span><span style="flex:1">${esc(i.name)}</span><span class="badge ${i.included?"b-in":"b-ex"}">${i.included?"INCLUIDO":"+"+eur(i.price)}</span></li>`).join("")}</ul>
        </div>`).join("")||`<div class="empty">Sin servicios aún</div>`}</div></div>
      <div><h3 style="margin:4px 0">2 · Fecha y hora</h3>
        ${calWidgetHTML(b,UI.calDate)}
        <div id="slotBox">${slotBoxHTML(b,svc)}</div>
        ${svc?`<h3>3 · Extras y profesional</h3>
        <label>Extras de pago</label>
        ${(svc.includes||[]).filter(i=>!i.included).map(i=>`<label style="display:flex;gap:8px;align-items:center;text-transform:none;font-size:14px;color:var(--ink)"><input type="checkbox" style="width:auto" data-ex="${esc(i.name)}" ${UI.pickExtras.includes(i.name)?"checked":""}> ${esc(i.name)} <b>+${eur(i.price)}</b></label>`).join("")||`<p class="sub">Todo incluido en este servicio ✅</p>`}
        <div class="row"><div><label>Profesional</label><select id="bkStaff"><option value="">Sin preferencia</option>${staff.map(s=>`<option value="${s.id}" ${UI.pickStaff===s.id?"selected":""}>${esc(s.name)} · ${esc(s.spec)}</option>`).join("")}</select></div>
        <div><label>Total estimado</label><div class="price" style="font-size:26px">${eur(svcTotal(svc,UI.pickExtras))}</div></div></div>
        <button class="btn" id="confirmBk" ${UI.pickTime?"":"disabled"} style="width:100%;margin-top:12px">${UI.pickTime?`Confirmar reserva · ${fmtD(UI.calDate)} ${UI.pickTime} · ${eur(svcTotal(svc,UI.pickExtras))}`:"Elige un hueco libre arriba 👆"}</button>`:"<p class='sub'>Selecciona un servicio a la izquierda 👈</p>"}
      </div>
    </div></div>`;
}
function calWidgetHTML(b,sel){
  const [Y,M]=UI.calMonth.split("-").map(Number);
  const first=new Date(Y,M-1,1);let startDay=(first.getDay()+6)%7;
  const dim=new Date(Y,M,0).getDate();
  let cells="";
  ["L","M","X","J","V","S","D"].forEach(d=>cells+=`<div class="dow">${d}</div>`);
  for(let i=0;i<startDay;i++)cells+=`<div></div>`;
  for(let d=1;d<=dim;d++){
    const iso=`${Y}-${String(M).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const open=isOpen(b,iso),used=dayBookings(b.id,iso).length,cap=maxFor(b,iso);
    const cls=!open?"c-off":used>=cap?"c-full":"c-ok";
    const lbl=!open?"cerrado":used>=cap?"lleno":`${cap-used} libres`;
    const pct=open?Math.min(100,used/cap*100):0;
    cells+=`<div class="day ${iso===sel?"sel":""} ${iso<todayStr()?"dim":""}" data-day="${iso}"><div class="n">${d}</div><span class="c ${cls}">${lbl}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }
  const mName=new Date(Y,M-1,1).toLocaleDateString("es-ES",{month:"long",year:"numeric"});
  return `<div class="cal-head"><button class="iconbtn" id="mPrev">‹</button><b style="text-transform:capitalize">${mName}</b><button class="iconbtn" id="mNext">›</button><span class="pill">🎟 cupo ${b.maxPerDay}/día · huecos ${b.slotMin}′</span></div><div class="cal-grid">${cells}</div>`;
}
function slotBoxHTML(b,svc){
  const slots=freeSlots(b,UI.calDate);
  if(!isOpen(b,UI.calDate))return `<div class="empty">⛔ Cerrado este día. Elige otro en verde 🟢</div>`;
  if(UI.calDate<todayStr())return `<div class="empty">Fecha pasada — elige hoy o futuro.</div>`;
  return `<label>Huecos del ${fmtD(UI.calDate)} (${dayBookings(b.id,UI.calDate).length}/${maxFor(b,UI.calDate)} ocupados)</label><div class="slots">${slots.map(s=>`<button class="slot ${UI.pickTime===s.t?"sel":""}" data-t="${s.t}" ${s.free?"":"disabled"}>${s.t}</button>`).join("")}</div>`;
}
function bindBook(body){
  $("#backBtn").onclick=()=>{UI.view="home";UI.pickBiz=null;render()};
  body.querySelectorAll("[data-svc]").forEach(c=>c.onclick=()=>{UI.pickSvc=c.dataset.svc;UI.pickExtras=[];UI.pickTime=null;render()});
  const pm=$("#mPrev"),nx=$("#mNext");
  if(pm)pm.onclick=()=>{let[Y,M]=UI.calMonth.split("-").map(Number);M--;if(M<1){M=12;Y--}UI.calMonth=`${Y}-${String(M).padStart(2,"0")}`;render()};
  if(nx)nx.onclick=()=>{let[Y,M]=UI.calMonth.split("-").map(Number);M++;if(M>12){M=1;Y++}UI.calMonth=`${Y}-${String(M).padStart(2,"0")}`;render()};
  body.querySelectorAll("[data-day]").forEach(d=>d.onclick=()=>{UI.calDate=d.dataset.day;UI.calMonth=UI.calDate.slice(0,7);UI.pickTime=null;render()});
  body.querySelectorAll("[data-t]").forEach(s=>s.onclick=()=>{UI.pickTime=s.dataset.t;render()});
  body.querySelectorAll("[data-ex]").forEach(c=>c.onchange=()=>{const v=c.dataset.ex;UI.pickExtras=c.checked?[...UI.pickExtras,v]:UI.pickExtras.filter(x=>x!==v);render()});
  const st=$("#bkStaff");if(st)st.onchange=()=>UI.pickStaff=st.value||null;
  const cf=$("#confirmBk");if(cf)cf.onclick=confirmBooking;
  body.querySelectorAll("[data-like]").forEach(l=>l.onclick=async()=>{const g=DB.gallery.find(x=>x.id===l.dataset.like);if(!g)return;g.likes++;await save();l.textContent=`🤍 ${g.likes}`});
}
async function confirmBooking(){
  const me=currentUser();if(!me){toast("Vuelve a entrar con tu cuenta");logout();return}
  const b=biz(UI.pickBiz),svc=DB.services.find(s=>s.id===UI.pickSvc);
  if(!svc||!UI.pickTime)return;
  const used=dayBookings(b.id,UI.calDate).length;
  if(used>=maxFor(b,UI.calDate)){toast("Ese día ya se llenó 😢");return}
  if(dayBookings(b.id,UI.calDate).some(x=>x.time===UI.pickTime)){toast("Hueco ocupado, elige otro");return}
  DB.bookings.push({id:uid("bk"),businessId:b.id,serviceId:svc.id,staffId:UI.pickStaff||null,date:UI.calDate,time:UI.pickTime,userId:me.id,clientName:me.name,clientPhone:me.phone,extras:[...UI.pickExtras],total:svcTotal(svc,UI.pickExtras),status:"pending",createdAt:Date.now()});
  me.lastBookingAt=Date.now();
  await save();UI.pickTime=null;UI.pickExtras=[];UI.view="mine";render();toast("¡Reserva creada! Te espera confirmación ✅");
}
function mineHTML(){
  const me=currentUser();
  const mine=DB.bookings.filter(b=>me&&b.userId===me.id).sort((a,b2)=>(a.date+a.time).localeCompare(b2.date+b2.time));
  return `<div class="card pad" style="margin-top:16px"><h2 style="margin:0">Mis citas · ${esc(me?me.name:"")}</h2>
  <p class="sub">Cuenta universal · cancela con un toque. Última actividad hace ${daysSince(userLastActive(me))} días (a los ${INACT_DAYS} sin reservar se borra).</p>
  ${mine.map(b=>{const s=DB.services.find(x=>x.id===b.serviceId),bb=biz(b.businessId);return `<div class="staffrow"><div class="avatar" style="background:linear-gradient(135deg,${bb?.cover[0]||"#888"},${bb?.cover[1]||"#555"})">💅</div>
    <div style="flex:1"><b>${esc(s?.name||"Servicio")} · ${eur(b.total)}</b><br><small style="color:var(--muted)">📍 ${esc(bb?.name||"")} · 📅 ${fmtD(b.date)} ${b.time} · ${esc(b.extras.join(", ")||"sin extras")}</small><br><span class="stt ${b.status==="pending"?"s-pend":b.status==="confirmed"?"s-conf":b.status==="done"?"s-done":"s-canc"}">${b.status}</span></div>
    ${b.status!=="cancelled"&&b.status!=="done"?`<button class="btn sm bad" data-cx="${b.id}">Cancelar</button>`:""}</div>`}).join("")||`<div class="empty">Aún no tienes reservas. <button class="btn sm" onclick="window.__nhGo()">Reservar ahora</button></div>`}</div>`;
}
window.__nhGo=()=>{UI.view="book";render()};
function bindMine(body){body.querySelectorAll("[data-cx]").forEach(x=>x.onclick=async()=>{const b=DB.bookings.find(y=>y.id===x.dataset.cx);b.status="cancelled";await save();render();toast("Reserva cancelada")})}

/* ---------- GALERÍA ---------- */
function galHTML(fBiz){
  const list=DB.gallery.filter(g=>!fBiz||g.businessId===fBiz).slice().reverse();
  const b=fBiz?biz(fBiz):null;
  return `<div class="card pad" style="margin-top:16px"><div class="row" style="align-items:end"><div><h2 style="margin:0">Galería de trabajos 📸 ${b?"· "+esc(b.name):""}</h2><p class="sub">Portafolio subido por las trabajadoras. Toca 🤍 para apoyar.</p></div>
  <div style="max-width:260px"><label>Filtrar local</label><select id="gBiz"><option value="">Todos</option>${DB.businesses.map(x=>`<option value="${x.id}" ${fBiz===x.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div></div>
  <div class="gal" style="margin-top:12px">${list.map(g=>{const bb=biz(g.businessId);return `<div class="gitem">${g.img?`<img src="${g.img}">`:`<div class="nailart" style="background:${g.bg}">${g.art}</div>`}<div class="gbody"><b>${esc(g.title)}</b><small style="color:var(--muted)">👩‍🎨 ${esc(g.staffName)} · 📍 ${esc(bb?.name.split("·")[0]||"")}</small><div class="row" style="align-items:center;margin-top:6px"><span class="like" data-like="${g.id}">🤍 ${g.likes}</span><span style="flex:1"></span><small style="color:var(--muted)">${fmtD(new Date(g.createdAt).toISOString().slice(0,10))}</small></div></div></div>`}).join("")||`<div class="empty">Sin fotos aún</div>`}</div></div>`;
}
function bindGal(body,fBiz){
  const s=$("#gBiz");if(s)s.onchange=()=>{body.innerHTML=galHTML(s.value||null);bindGal(body,s.value||null)};
  body.querySelectorAll("[data-like]").forEach(l=>l.onclick=async()=>{const g=DB.gallery.find(x=>x.id===l.dataset.like);g.likes++;await save();l.textContent=`🤍 ${g.likes}`});
}

/* ---------- SUPER ADMIN ---------- */
function superHTML(){
  const rev=DB.bookings.filter(b=>b.status!=="cancelled").reduce((a,b)=>a+b.total,0);
  return `<div style="margin-top:16px"><div class="grid3">
    <div class="card kpi"><b>${DB.businesses.length}</b><br><span>locales (${DB.businesses.filter(b=>b.active).length} activos)</span></div>
    <div class="card kpi"><b>${eur(rev)}</b><br><span>volumen total reservas</span></div>
    <div class="card kpi"><b>${DB.bookings.filter(b=>b.status==="pending").length}</b><br><span>pendientes de confirmar</span></div>
    <div class="card kpi"><b>${(DB.users||[]).length}</b><br><span>usuarias universales</span></div></div>
  <div class="card pad" style="margin-top:14px"><div class="row" style="align-items:end"><div><h2 style="margin:0">🛡️ Alta de nuevo local</h2><p class="sub">Crea negocios independientes. Cada uno tendrá su catálogo, calendario y equipo.</p></div></div>
    <div class="row"><div><label>Nombre *</label><input id="nbName" placeholder="Ej. Glow Nails · Norte"></div><div><label>Dirección</label><input id="nbAddr" placeholder="Calle…"></div><div><label>Teléfono (WhatsApp) *</label><input id="nbPhone" inputmode="tel" placeholder="+53…"></div></div>
    <label>Descripción</label><input id="nbDesc" placeholder="Especialidad del local…">
    <div class="row"><div><label>Color 1</label><input id="nbC1" type="color" value="#8b5cf6"></div><div><label>Color 2</label><input id="nbC2" type="color" value="#ec4899"></div><div><label>Cupo/día</label><input id="nbMax" type="number" value="12" min="1" max="60"></div><div><label>&nbsp;</label><button class="btn" id="nbGo">＋ Crear negocio</button></div></div>
    <label style="margin-top:10px">Acceso de la administradora del negocio <span class="sub">(con esto entra a su panel, sin pasar por ti)</span></label>
    <div class="row"><div><label>Usuario administradora *</label><input id="nbUser" placeholder="Ej. lumina"></div><div><label>Contraseña administradora *</label><input id="nbPass" placeholder="Ej. 1234"></div></div>
    <div class="row" style="margin-top:8px"><button class="btn sm soft" id="purgeAll">🧹 Purgar usuarias inactivas (+90 días)</button><button class="btn sm bad" id="wipeAll">🗑 Borrar TODOS los negocios y datos</button></div>
    <div class="card" style="margin-top:10px;padding:12px 14px;background:rgba(16,185,129,.07)"><b>💱 Tasa CUP/USD (mercado informal, elToque)</b><br>
    <small class="sub">Actual: <b id="fxNow">${FX.usd>0?`1 USD = ${cup(FX.usd)} (${fxAgo()})`:"cargando…"}</b> · se actualiza sola cada hora. Si falla internet o quieres fijarla a mano, escribe el valor y guárdalo (se usa ese hasta que lo borres).</small>
    <div class="row" style="margin-top:8px"><div><label>1 USD = ? CUP (manual, vacío = auto)</label><input id="fxMan" type="number" min="1" placeholder="${FX.usd>0?FX.usd:"ej. 910"}" value="${DB.fxManual&&DB.fxManual.usd?DB.fxManual.usd:""}"></div><div><label>&nbsp;</label><div class="row"><button class="btn sm ok" id="fxGo">Guardar</button><button class="btn sm soft" id="fxAuto">↻ Actualizar del toque</button></div></div></div></div>
    <p class="sub">Cada negocio se administra solo desde adentro, entrando con su usuario de administradora. Borrado automático al cargar si llevan 90 días sin reservar.</p></div></div>
  <div class="bizgrid" style="margin-top:14px">${DB.businesses.map(b=>{const nBk=DB.bookings.filter(x=>x.businessId===b.id&&x.status!=="cancelled").length;const revB=DB.bookings.filter(x=>x.businessId===b.id&&x.status!=="cancelled").reduce((a,x)=>a+x.total,0);return `<div class="card biz"><div class="cover" style="background:linear-gradient(135deg,${b.cover[0]},${b.cover[1]})"><span class="st">${b.active?"● ACTIVO":"⏸ SUSPENDIDO"}</span><span>${esc(b.name)}</span></div>
    <div class="bizbody"><div class="meta"><span class="tag">📅 ${nBk} reservas</span><span class="tag">💰 ${eur(revB)}</span><span class="tag">💅 ${bizSvcs(b.id).length} svcs</span></div>
    <div class="meta"><span class="tag">👑 ${esc(b.ownerUser||"—")} · 🔑 ••••</span><button class="btn sm soft" data-ow="${b.id}">cambiar clave</button></div>
    <div class="row"><button class="btn sm ${b.active?"dark":"ok"}" data-tog="${b.id}">${b.active?"Suspender":"Activar"}</button><button class="btn sm bad" data-del="${b.id}">✕</button></div></div></div>`}).join("")||`<div class="card pad empty">Aun no hay negocios. Crea el primero arriba</div>`}</div>
  <div class="card pad" style="margin-top:14px"><h2 style="margin:0">🔑 Mi acceso de superadministrador</h2><p class="sub">Cambia tu usuario y tu contraseña aquí, sin tocar código. Se guardan en el servidor: a partir del cambio, el acceso antiguo deja de funcionar en línea.</p>
    <div class="row"><div><label>Usuario nuevo (vacío = mantener)</label><input id="supUser" type="text" autocomplete="username" placeholder="Tu usuario actual"></div><div><label>Contraseña actual</label><input id="supAct" type="password" autocomplete="current-password"></div></div>
    <div class="row"><div><label>Contraseña nueva (vacío = mantener)</label><input id="supNew" type="password" autocomplete="new-password" placeholder="Mínimo 6 si la cambias"></div><div><label>&nbsp;</label><button class="btn" id="supPassGo">Guardar cambios</button></div></div></div>
  <div class="card pad" style="margin-top:14px"><div class="row" style="align-items:center"><div><h2 style="margin:0">👩‍🦰 Usuarias universales · solo Super Admin</h2><p class="sub">Solo tú ves teléfonos, claves y última reserva. Las dueñas solo crean cuentas, no ven esta lista. Sin reservar en ${INACT_DAYS} días se borran solas.</p></div><span style="flex:1"></span><button class="btn sm soft" id="purgeUsers">🧹 Purgar inactivas +${INACT_DAYS}d</button></div>
  <table style="margin-top:10px"><tr><th>Clienta</th><th>Teléfono / clave</th><th>Alta por</th><th>Última reserva</th><th></th></tr>
  ${(DB.users||[]).slice().sort((a,c)=>userLastActive(c)-userLastActive(a)).map(u=>{const ab=biz(u.approvedBy);const ina=daysSince(userLastActive(u));const nBk=DB.bookings.filter(x=>x.userId===u.id&&x.status!=="cancelled").length;return `<tr><td><b>${esc(u.name)}</b> ${u.active===false?'<span class="stt s-canc">off</span>':""}<br><small>${nBk} reservas</small></td><td>${esc(u.phone)}<br><small>clave: <b>••••</b> · hace ${ina}d</small></td><td><small>${esc(ab?ab.name.split("·")[0]:"—")}</small></td><td><small>${u.lastBookingAt?fmtD(new Date(u.lastBookingAt).toISOString().slice(0,10)):"nunca"}</small></td><td><div class="row"><button class="btn sm soft" data-srp="${u.id}">clave</button><button class="btn sm ${u.active===false?"ok":"dark"}" data-stu="${u.id}">${u.active===false?"activar":"off"}</button><button class="btn sm bad" data-sdu="${u.id}">✕</button></div></td></tr>`}).join("")||`<tr><td colspan="5">Sin usuarias aún</td></tr>`}</table></div></div>`;
}
function bindSuper(body){
  $("#nbGo").onclick=async()=>{
    const name=$("#nbName").value.trim();if(!name){toast("Ponle nombre al negocio");return}
    const ph=($("#nbPhone").value||"").trim();
    if(normPhone(ph).length<6){toast("El teléfono del negocio es obligatorio (ahí te escriben por WhatsApp)");return}
    const ou=($("#nbUser").value||"").trim().toLowerCase().replace(/\s+/g,"");
    const op=$("#nbPass").value||"";
    if(!ou){toast("Pon el usuario de la administradora");return}
    if(op.length<4){toast("La contraseña de la administradora: mínimo 4 caracteres");return}
    if(ou==="admin"||DB.businesses.some(y=>(y.ownerUser||"").toLowerCase()===ou)||DB.staff.some(y=>(y.user||"").toLowerCase()===ou)){toast("Ese usuario ya existe, usa otro");return}
    DB.businesses.push({id:uid("biz"),name,addr:$("#nbAddr").value.trim()||"—",phone:ph,desc:$("#nbDesc").value.trim()||"Nuevo negocio de manicura.",cover:[$("#nbC1").value,$("#nbC2").value],rating:5.0,active:true,ownerUser:ou,_newPass:op,slotMin:30,maxPerDay:Math.max(1,+$("#nbMax").value||12),hours:{1:{o:"10:00",c:"19:00",on:true},2:{o:"10:00",c:"19:00",on:true},3:{o:"10:00",c:"19:00",on:true},4:{o:"10:00",c:"19:00",on:true},5:{o:"10:00",c:"20:00",on:true},6:{o:"09:00",c:"15:00",on:true},0:{o:"",c:"",on:false}},overrides:{},createdAt:Date.now()});
    await save();render();toast("Negocio creado ✅ · dueña: "+ou);
  };
  const pa=document.querySelector("#purgeAll");
  if(pa)pa.onclick=async()=>{const n=purgeInactiveUsers();await save();render();toast(n?`🧹 ${n} borrada(s)`:"Nada que purgar ✅")};
  const wa=document.querySelector("#wipeAll");
  if(wa)wa.onclick=async()=>{if(!confirm("¿Borrar TODOS los negocios y TODOS los datos de prueba? No se puede deshacer."))return;DB={businesses:[],services:[],staff:[],bookings:[],gallery:[],notes:[],users:[]};await save();render();toast("Todo borrado 🗑")}
  const fg=document.querySelector("#fxGo");
  if(fg)fg.onclick=async()=>{const v=parseFloat(document.querySelector("#fxMan").value);if(!v||v<=0){DB.fxManual=null;await save();await loadFx(true);render();toast("Tasa en automático 🔄");return}DB.fxManual={usd:v,eur:0,at:Date.now(),src:"manual"};await save();await loadFx();render();toast("Tasa manual guardada 💱")};
  const fa=document.querySelector("#fxAuto");
  if(fa)fa.onclick=async()=>{toast("Actualizando del toque…");const f=await loadFx(true);await save();render();toast(f&&f.usd>0?`1 USD = ${cup(f.usd)} ✅`:"No se pudo actualizar, revisa internet")};
  body.querySelectorAll("[data-tog]").forEach(x=>x.onclick=async()=>{const b=biz(x.dataset.tog);b.active=!b.active;await save();render()});
  body.querySelectorAll("[data-del]").forEach(x=>x.onclick=async()=>{if(!confirm("¿Eliminar local y TODOS sus datos?"))return;const id=x.dataset.del;["businesses","services","staff","bookings","gallery","notes"].forEach(k=>DB[k]=DB[k].filter(y=>y.businessId!==id&&y.id!==id));await save();render();toast("Local eliminado")});
  body.querySelectorAll("[data-ow]").forEach(x=>x.onclick=()=>{const b=biz(x.dataset.ow);modal(`<h3>👑 Clave de dueña · ${esc(b.name)}</h3><label>Usuario</label><input id="owU" value="${esc(b.ownerUser||"")}"> <label>Contraseña</label><input id="owP" value="" placeholder="Nueva clave (vacío = sin cambios)"> <div class="row" style="margin-top:10px"><button class="btn ghost" onclick="window.__nhClose()">Cancelar</button><button class="btn" id="owGo">Guardar</button></div>`);document.querySelector("#owGo").onclick=async()=>{const uu=document.querySelector("#owU").value.trim().toLowerCase().replace(/\s+/g,"");if(!uu){toast("Usuario vacío");return}if(uu==="admin"||DB.businesses.some(y=>y.id!==b.id&&(y.ownerUser||"").toLowerCase()===uu)||DB.staff.some(y=>(y.user||"").toLowerCase()===uu)){toast("Ese usuario ya existe");return}b.ownerUser=uu;const np=document.querySelector("#owP").value.trim();if(np)b._newPass=np;await save();closeModal();render();toast("Clave de dueña actualizada")}});
  const sp=document.querySelector("#supPassGo");
  if(sp)sp.onclick=async()=>{const act=(document.querySelector("#supAct").value||""),nv=(document.querySelector("#supNew").value||""),nu=((document.querySelector("#supUser").value||"").trim().toLowerCase());if(!act){toast("Escribe tu contraseña actual para confirmar");return}if(!nv&&!nu){toast("Escribe el usuario nuevo o la contraseña nueva");return}if(nu&&!/^[a-z0-9._-]{3,20}$/.test(nu)){toast("Usuario no válido (3-20: letras, números, . _ -)");return}if(nv&&nv.length<6){toast("La contraseña nueva debe tener al menos 6 caracteres");return}if(!S.token){toast("Entra en línea para cambiar tu acceso");return}const r=await nhApi({action:"super_cambiar_clave",token:S.token,actual:act,nueva:nv,nuevo_usuario:nu});if(r&&r.ok){if(nv)SUPER.pass=nv;if(r.superUser){SUPER.user=r.superUser;try{localStorage.setItem("nh_super_user",r.superUser)}catch(e){}}document.querySelector("#supAct").value="";document.querySelector("#supNew").value="";document.querySelector("#supUser").value="";toast("Acceso actualizado 🔑")}else toast((r&&r.error)||"No se pudo cambiar")};
  const pu=document.querySelector("#purgeUsers");
  if(pu)pu.onclick=async()=>{const n=purgeInactiveUsers();await save();render();toast(n?`🧹 ${n} borrada(s)`:"Nada que purgar ✅")};
  body.querySelectorAll("[data-srp]").forEach(x=>x.onclick=async()=>{const u=DB.users.find(y=>y.id===x.dataset.srp);if(!u)return;const np=prompt("Nueva contraseña para "+u.name+":","");if(!np)return;u._newPass=np.trim();await save();render();toast("Clave actualizada")});
  body.querySelectorAll("[data-stu]").forEach(x=>x.onclick=async()=>{const u=DB.users.find(y=>y.id===x.dataset.stu);if(!u)return;u.active=u.active===false?true:false;await save();render()});
  body.querySelectorAll("[data-sdu]").forEach(x=>x.onclick=async()=>{if(!confirm("¿Borrar esta cuenta? Sus reservas pasadas se conservan con su nombre."))return;DB.users=DB.users.filter(y=>y.id!==x.dataset.sdu);await save();render()});
}

/* ---------- OWNER ---------- */
const OWNER_TABS=[["dash","📊 Resumen"],["agenda","📅 Agenda"],["clientas","👩‍🦰 Clientas"],["servicios","💅 Servicios"],["equipo","👩‍🎨 Equipo"],["galeria","📸 Galería"],["horarios","⏰ Horarios y cupos"],["finanzas","💰 Finanzas"],["notas","📝 Notas"]];
let ownerTab="dash";
function ownerHTML(){
  let b=S.businessId?biz(S.businessId):DB.businesses[0];if(S.businessId&&!biz(S.businessId))b=DB.businesses[0];if(b&&!S.businessId){S.businessId=b.id;saveSess()}
  if(!b)return `<div class="card pad empty">Sin local. <button class="btn" onclick="window.__nhBack()">Volver</button></div>`;
  window.__nhBack=logout;
  const tabs=OWNER_TABS.map(([k,l])=>`<button class="${ownerTab===k?"on":""}" data-ot="${k}">${l}</button>`).join("");
  let inner="";
  if(ownerTab==="dash")inner=ownDash(b);
  if(ownerTab==="agenda")inner=ownAgenda(b);
  if(ownerTab==="clientas")inner=ownUsers(b);
  if(ownerTab==="servicios")inner=ownSvcs(b);
  if(ownerTab==="equipo")inner=ownStaff(b);
  if(ownerTab==="galeria")inner=ownGal(b);
  if(ownerTab==="horarios")inner=ownHours(b);
  if(ownerTab==="finanzas")inner=ownFin(b);
  if(ownerTab==="notas")inner=ownNotes(b);
  return `<div class="layout"><aside class="card side"><h3 style="margin:6px 8px">👑 ${esc(b.name)}</h3><p class="sub" style="margin:0 8px 8px;font-size:12px">${b.active?"● Activo":"⏸ Suspendido"}</p>${tabs}<hr style="border:0;border-top:1px solid var(--line)"><button data-ot="preview">👁️ Vista clienta</button></aside><div><div id="ownBody">${inner}</div></div></div>`;
}
window.__nhBack=logout;
function ownDash(b){
  const all=DB.bookings.filter(x=>x.businessId===b.id&&x.status!=="cancelled");
  const rev=all.reduce((a,x)=>a+x.total,0),pend=all.filter(x=>x.status==="pending").length;
  const t=todayStr(),tod=dayBookings(b.id,t);
  return `<div class="grid3"><div class="card kpi"><b>${eur(rev)}</b><br><span>ingresos estimados</span></div><div class="card kpi"><b>${tod.length}/${maxFor(b,t)}</b><br><span>ocupación hoy</span></div><div class="card kpi"><b>${pend}</b><br><span>pendientes</span></div></div>
  <div class="card pad" style="margin-top:14px"><h3 style="margin:0">Hoy · ${fmtD(t)} (${tod.length})</h3><div class="timeline">${tod.sort((a,c)=>a.time.localeCompare(c.time)).map(x=>{const s=DB.services.find(y=>y.id===x.serviceId);return `<div class="titem"><b>${x.time}</b> · ${esc(x.clientName)} · ${esc(s?.name||"")} · ${eur(x.total)} <span class="stt ${x.status==="pending"?"s-pend":"s-conf"}">${x.status}</span></div>`}).join("")||"Sin citas hoy. ¡A por ellas! 💪"}</div></div>`;
}
function ownAgenda(b){
  return `<div class="card pad"><h3 style="margin:0">📅 Agenda · configura cupos por día</h3><p class="sub">Toca un día para editar su cupo, cerrarlo o ver sus reservas. Las clientas solo ven huecos libres.</p>${calWidgetHTML(b,UI.calDate)}<div id="admDay">${admDayHTML(b)}</div></div>`;
}
function admDayHTML(b){
  const d=UI.calDate,ov=b.overrides?.[d]||{},list=dayBookings(b.id,d).sort((a,c)=>a.time.localeCompare(c.time));
  return `<div class="card pad" style="margin-top:12px;background:rgba(139,92,246,.06)"><b>⚙️ ${fmtD(d)}</b> · ${isOpen(b,d)?dayBookings(b.id,d).length+"/"+maxFor(b,d)+" ocupados":"cerrado"}
  <div class="row" style="margin-top:8px"><div><label>Cupo del día (vacío = ${b.maxPerDay})</label><input id="ovMax" type="number" min="0" max="80" value="${ov.max??""}" placeholder="${b.maxPerDay}"></div><div><label>&nbsp;</label><div class="row"><button class="btn sm ok" id="ovSave">Guardar</button><button class="btn sm ${ov.closed?"ok":"dark"}" id="ovClose">${ov.closed?"Reabrir":"Cerrar día"}</button></div></div></div>
  <table style="margin-top:10px"><tr><th>Hora</th><th>Clienta</th><th>Servicio</th><th>Total</th><th>Estado</th><th></th></tr>
  ${list.map(x=>{const s=DB.services.find(y=>y.id===x.serviceId);return `<tr><td><b>${x.time}</b></td><td>${esc(x.clientName)}<br><small>${esc(x.clientPhone)}</small></td><td>${esc(s?.name||"—")}<br><small>${esc(x.extras.join(", "))}</small></td><td><b>${eur(x.total)}</b></td><td><span class="stt ${x.status==="pending"?"s-pend":x.status==="confirmed"?"s-conf":"s-done"}">${x.status}</span></td><td><div class="row"><button class="btn sm ok" data-ok="${x.id}">✓</button><button class="btn sm dark" data-done="${x.id}">★</button><button class="btn sm bad" data-no="${x.id}">✕</button></div></td></tr>`}).join("")||`<tr><td colspan="6" style="color:var(--muted)">Sin reservas este día</td></tr>`}</table></div>`;
}
function ownUsers(b){
  return `<div class="card pad"><h3 style="margin:0">👩‍🦰 Clientas · alta por la dueña</h3>
  <p class="sub">Las clientas <b>no se auto-registran</b>: te escriben por WhatsApp al <b>📞 ${esc(b.phone)}</b> (el teléfono de ESTE negocio) y tú les creas aquí su usuario universal (vale en todos los locales). Sin reservar en ${INACT_DAYS} días se borra solo.</p>
  <div class="row" style="margin-bottom:8px"><a class="btn sm ok" style="text-decoration:none;text-align:center" target="_blank" href="${waLink(b,"Hola "+b.name+", quiero una cuenta para reservar")}">💬 Abrir mi WhatsApp ${esc(b.phone)}</a><span class="sub">Este es el número que ven las clientas para pedirte cuenta.</span></div>
  <div class="row"><div><label>Nombre</label><input id="nuName" placeholder="Ej. Ana López"></div><div><label>Teléfono</label><input id="nuPhone" inputmode="tel" placeholder="600…"></div><div><label>Contraseña inicial</label><input id="nuPass" placeholder="Ej. 1234"></div><div><label>&nbsp;</label><button class="btn" id="nuGo">＋ Crear cuenta</button></div></div>
  <div class="row" style="margin-top:8px"><a class="btn sm ok" style="text-decoration:none;text-align:center" target="_blank" href="${waLink(b,"Hola, ¿me pasas el enlace para pedir cita?")}">💬 Mi WhatsApp del local</a></div>
  <p class="sub" style="margin-top:10px">🔒 Por privacidad, la lista de clientas, sus teléfonos, claves y reservas <b>solo la ve el Super Admin</b>. Aquí solo creas cuentas nuevas y recibes la confirmación.</p></div>`;
}
function ownSvcs(b){
  const list=DB.services.filter(s=>s.businessId===b.id);
  return `<div class="card pad"><div class="row" style="align-items:center"><h3 style="margin:0">💅 Catálogo (${list.length})</h3><span style="flex:1"></span><button class="btn sm" id="newSvc">＋ Nuevo servicio</button></div>
  ${list.map(s=>`<div class="card svc" style="margin-top:10px"><div class="row" style="align-items:center"><div><h3>${esc(s.name)} ${s.active?"":"(oculto)"}</h3><small style="color:var(--muted)">⏱ ${s.durationMin}′ · ${esc(s.desc)}</small></div><div style="text-align:right"><div class="price">${eur(s.price)}</div><div class="row" style="justify-content:end;margin-top:6px"><button class="btn sm soft" data-es="${s.id}">Editar</button><button class="btn sm ${s.active?"dark":"ok"}" data-ts="${s.id}">${s.active?"Ocultar":"Mostrar"}</button><button class="btn sm bad" data-ds="${s.id}">✕</button></div></div></div>
  <ul class="inc">${(s.includes||[]).map((i,ix)=>`<li><span>${i.included?"✅":"➕"}</span><span style="flex:1">${esc(i.name)}</span><span class="badge ${i.included?"b-in":"b-ex"}">${i.included?"INCLUIDO":"+"+eur(i.price)}</span><button class="btn sm ghost" data-ri="${s.id}:${ix}">✕</button></li>`).join("")}</ul>
  <div class="row"><input placeholder="Añadir incluido: ej. Cromo (+500 CUP) o Retirada (incl)" id="ni-${s.id}"><button class="btn sm soft" data-ai="${s.id}">Añadir</button></div></div>`).join("")||`<div class="empty">Crea tu primer servicio ✨</div>`}</div>`;
}
function ownStaff(b){
  const list=DB.staff.filter(s=>s.businessId===b.id);
  return `<div class="card pad"><div class="row" style="align-items:center"><h3 style="margin:0">👩‍🎨 Equipo (${list.length})</h3><span style="flex:1"></span><button class="btn sm" id="newSt">＋ Fichar</button></div>
  ${list.map(s=>`<div class="staffrow"><div class="avatar" style="background:${s.color}">${esc(s.name[0]||"✂")}</div><div style="flex:1"><b>${esc(s.name)}</b> ${s.active?"":"(inactiva)"}<br><small style="color:var(--muted)">${esc(s.spec)} · 👤 <b>${esc(s.user||"—")}</b> · 🔑 <b>${esc(s.pass||"—")}</b></small></div><button class="btn sm soft" data-est="${s.id}">Editar</button><button class="btn sm bad" data-dst="${s.id}">✕</button></div>`).join("")}</div>`;
}
function ownGal(b){
  const list=DB.gallery.filter(g=>g.businessId===b.id).slice().reverse();
  return `<div class="card pad"><div class="row" style="align-items:center"><h3 style="margin:0">📸 Galería del local (${list.length})</h3><span style="flex:1"></span><button class="btn sm" id="ownUpBtn">＋ Subir foto</button><input type="file" id="ownUpFile" accept="image/*" hidden></div>
  <p class="sub">Las clientas ven estas fotos <b>dentro de la reserva</b> cuando eligen este negocio. Aquí las subes y las borras.</p>
  <div class="gal">${list.map(g=>`<div class="gitem">${g.img?`<img src="${g.img}" loading="lazy">`:`<div class="nailart" style="background:${g.bg}">${g.art}</div>`}<div class="gbody"><b>${esc(g.title)}</b><br><small>👩‍🎨 ${esc(g.staffName)} · 🤍 ${g.likes}</small><div class="row" style="margin-top:6px"><button class="btn sm bad" data-dg="${g.id}">✕ Borrar</button></div></div></div>`).join("")||`<div class="empty">Sin fotos. Sube la primera ✨</div>`}</div></div>`;
}
function ownHours(b){
  const days=["DO","LU","MA","MI","JU","VI","SA"];
  const order=[1,2,3,4,5,6,0];
  return `<div class="card pad"><h3 style="margin:0">⏰ Horarios, duración y cupo base</h3><p class="sub">El calendario genera huecos automáticamente. El cupo diario limita cuántas citas se otorgan aunque haya huecos libres.</p>
  <div class="row"><div><label>Duración de hueco (min)</label><input id="hSlot" type="number" min="15" max="180" step="15" value="${b.slotMin}"></div><div><label>Cupo máximo por día</label><input id="hMax" type="number" min="1" max="80" value="${b.maxPerDay}"></div><div><label>&nbsp;</label><button class="btn" id="hSave">Guardar</button></div></div>
  <div class="hours" style="margin-top:12px">${order.map(d=>{const h=b.hours[d];return `<div class="hday"><b>${days[d===0?0:d]}</b><br><label style="display:flex;gap:6px;align-items:center;text-transform:none"><input type="checkbox" style="width:auto" data-hd="${d}" ${h.on?"checked":""}> Abierto</label><input type="time" data-ho="${d}" value="${h.o||"10:00"}"><input type="time" data-hc="${d}" value="${h.c||"19:00"}" style="margin-top:6px"></div>`}).join("")}</div></div>`;
}
function ownFin(b){
  const all=DB.bookings.filter(x=>x.businessId===b.id&&x.status!=="cancelled");
  const byM={};all.forEach(x=>{const k=x.date.slice(0,7);byM[k]=(byM[k]||0)+x.total});
  const keys=Object.keys(byM).sort().slice(-8);
  const max=Math.max(1,...keys.map(k=>byM[k]));
  const perSvc={};all.forEach(x=>{const s=DB.services.find(y=>y.id===x.serviceId);const n=s?.name||"?";perSvc[n]=(perSvc[n]||0)+x.total});
  const tot=all.reduce((a,x)=>a+x.total,0),done=all.filter(x=>x.status==="done").length;
  const occ=keys.map(k=>k).join(" · ");
  return `<div class="grid2"><div class="card pad"><h3 style="margin:0">💰 Ingresos por mes</h3><div class="bars">${keys.map(k=>`<div class="barcol"><i style="height:${Math.round(byM[k]/max*120)+6}px"></i><span>${k.slice(5)}</span><b style="font-size:11px">${eur(byM[k])}</b></div>`).join("")||"Sin datos"}</div><p class="sub">${occ}</p></div>
  <div class="card pad"><h3 style="margin:0">Resumen</h3><div class="donut" style="background:conic-gradient(var(--brand1) 0 ${all.length?done/all.length*100:0}%,rgba(0,0,0,.08) 0)"><b>${all.length?Math.round(done/all.length*100):0}%</b></div><p class="sub" style="text-align:center">finalizadas vs resto</p><table><tr><th>Servicio</th><th style="text-align:right">Ingresos</th></tr>${Object.entries(perSvc).sort((a,c)=>c[1]-a[1]).map(([n,v])=>`<tr><td>${esc(n)}</td><td style="text-align:right"><b>${eur(v)}</b></td></tr>`).join("")||`<tr><td colspan="2">Sin datos</td></tr>`}<tr><td><b>Total</b></td><td style="text-align:right"><b>${eur(tot)}</b></td></tr></table></div></div>`;
}
function ownNotes(b){
  const t=todayStr();
  const notes=DB.notes.filter(n=>n.businessId===b.id).slice().reverse().slice(0,30);
  return `<div class="card pad"><h3 style="margin:0">📝 Notas operativas del calendario</h3><p class="sub">Las ve el equipo. Ej: pedidos, avisos, cambios de turno.</p>
  <div class="row"><div><label>Fecha</label><input id="ntDate" type="date" value="${t}"></div><div style="flex:2"><label>Nota</label><input id="ntText" placeholder="Hoy llega el pedido de…"></div><div><label>&nbsp;</label><button class="btn" id="ntGo">Añadir</button></div></div>
  <div class="timeline">${notes.map(n=>`<div class="titem"><b>${fmtD(n.date)}</b> · 👩 ${esc(n.author)}<br>${esc(n.text)} <button class="btn sm ghost" data-dn="${n.id}" style="margin-left:8px">✕</button></div>`).join("")||"Sin notas"}</div></div>`;
}
function bindOwner(body){
  body.querySelectorAll("[data-ot]").forEach(t=>t.onclick=()=>{if(t.dataset.ot==="preview"){const keepBiz=S.businessId;UI.pickBiz=keepBiz;const b=biz(keepBiz);modal(`<h3>👁️ Vista de clienta</h3><p class="sub">Así ve tu local una clienta con cuenta universal.</p><div class="meta"><span class="tag">📍 ${esc(b.addr)}</span><span class="tag">💅 ${bizSvcs(b.id).length} servicios</span><span class="tag">📞 ${esc(b.phone)}</span></div><div class="row" style="margin:8px 0"><a class="btn sm ok" target="_blank" style="text-decoration:none;text-align:center" href="${waLink(b)}">💬 Contacto WhatsApp que ven ellas</a></div>${bizSvcs(b.id).map(s=>`<div class="card svc" style="margin:8px 0"><div class="row"><b>${esc(s.name)}</b><span class="price">${eur(s.price)}</span></div><small>${esc(s.desc)}</small></div>`).join("")}<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="window.__nhClose()">Cerrar</button></div>`);return}ownerTab=t.dataset.ot;render()});
  if(ownerTab==="agenda"){
    body.querySelectorAll("[data-day]").forEach(d=>d.onclick=()=>{UI.calDate=d.dataset.day;UI.calMonth=UI.calDate.slice(0,7);render()});
    const p=$("#mPrev"),n=$("#mNext");if(p)p.onclick=()=>{let[Y,M]=UI.calMonth.split("-").map(Number);M--;if(M<1){M=12;Y--}UI.calMonth=`${Y}-${String(M).padStart(2,"0")}`;render()};if(n)n.onclick=()=>{let[Y,M]=UI.calMonth.split("-").map(Number);M++;if(M>12){M=1;Y++}UI.calMonth=`${Y}-${String(M).padStart(2,"0")}`;render()};
    const sv=$("#ovSave");if(sv)sv.onclick=async()=>{const b=biz(S.businessId);b.overrides=b.overrides||{};const v=$("#ovMax").value;const o=b.overrides[UI.calDate]||{};if(v===""||v==null)o.max=undefined;else o.max=Math.max(0,+v);b.overrides[UI.calDate]=o;await save();render();toast("Cupo actualizado 🎟")};
    const cl=$("#ovClose");if(cl)cl.onclick=async()=>{const b=biz(S.businessId);b.overrides=b.overrides||{};const o=b.overrides[UI.calDate]||{};o.closed=!o.closed;b.overrides[UI.calDate]=o;await save();render()};
    body.querySelectorAll("[data-ok]").forEach(x=>x.onclick=async()=>{DB.bookings.find(y=>y.id===x.dataset.ok).status="confirmed";await save();render()});
    body.querySelectorAll("[data-done]").forEach(x=>x.onclick=async()=>{DB.bookings.find(y=>y.id===x.dataset.done).status="done";await save();render()});
    body.querySelectorAll("[data-no]").forEach(x=>x.onclick=async()=>{DB.bookings.find(y=>y.id===x.dataset.no).status="cancelled";await save();render()});
  }
  if(ownerTab==="servicios"){
    $("#newSvc").onclick=()=>svcModal(biz(S.businessId),null);
    body.querySelectorAll("[data-es]").forEach(x=>x.onclick=()=>svcModal(biz(S.businessId),DB.services.find(s=>s.id===x.dataset.es)));
    body.querySelectorAll("[data-ts]").forEach(x=>x.onclick=async()=>{const s=DB.services.find(y=>y.id===x.dataset.ts);s.active=!s.active;await save();render()});
    body.querySelectorAll("[data-ds]").forEach(x=>x.onclick=async()=>{if(!confirm("¿Eliminar servicio?"))return;DB.services=DB.services.filter(y=>y.id!==x.dataset.ds);await save();render()});
    body.querySelectorAll("[data-ri]").forEach(x=>x.onclick=async()=>{const[sid,ix]=x.dataset.ri.split(":");const s=DB.services.find(y=>y.id===sid);s.includes.splice(+ix,1);await save();render()});
    body.querySelectorAll("[data-ai]").forEach(x=>x.onclick=async()=>{const inp=body.querySelector("#ni-"+CSS.escape(x.dataset.ai));const v=(inp.value||"").trim();if(!v)return;const s=DB.services.find(y=>y.id===x.dataset.ai);const m=v.match(/\(\+?\s*([\d.,]+)\s*€?\)/);let price=0,included=true,name=v;if(m){price=parseFloat(m[1].replace(",","."))||0;included=false;name=v.replace(m[0],"").trim()}else if(/incl/i.test(v)){included=true;name=v.replace(/\(.*incl.*\)/i,"").trim()||v}const nm=name||v;s.includes.push({name:nm,included,price});await save();render();toast(included?"Incluido añadido ✅":"Extra añadido ➕")});
  }
  if(ownerTab==="equipo"){
    $("#newSt").onclick=()=>staffModal(biz(S.businessId),null);
    body.querySelectorAll("[data-est]").forEach(x=>x.onclick=()=>staffModal(biz(S.businessId),DB.staff.find(s=>s.id===x.dataset.est)));
    body.querySelectorAll("[data-dst]").forEach(x=>x.onclick=async()=>{if(!confirm("¿Eliminar empleada?"))return;DB.staff=DB.staff.filter(y=>y.id!==x.dataset.dst);await save();render()});
  }
  if(ownerTab==="horarios"){
    $("#hSave").onclick=async()=>{const b=biz(S.businessId);b.slotMin=Math.max(15,+$("#hSlot").value||30);b.maxPerDay=Math.max(1,+$("#hMax").value||10);body.querySelectorAll("[data-hd]").forEach(c=>{const d=c.dataset.hd;b.hours[d].on=c.checked});body.querySelectorAll("[data-ho]").forEach(c=>b.hours[c.dataset.ho].o=c.value);body.querySelectorAll("[data-hc]").forEach(c=>b.hours[c.dataset.hc].c=c.value);await save();render();toast("Horarios guardados ⏰")};
  }
  if(ownerTab==="clientas"){
    const cg=document.querySelector("#nuGo");
    if(cg)cg.onclick=async()=>{
      const name=document.querySelector("#nuName").value.trim(),ph=normPhone(document.querySelector("#nuPhone").value),pw=(document.querySelector("#nuPass").value||"").trim()||String(Math.floor(1000+Math.random()*9000));
      if(!name||!ph){toast("Nombre y teléfono obligatorios");return}
      if(DB.users.some(u=>normPhone(u.phone)===ph&&u.active!==false)){toast("Ese teléfono ya tiene cuenta universal");return}
      const u={id:uid("u"),name,phone:document.querySelector("#nuPhone").value.trim(),_newPass:pw,user:name.toLowerCase(),approvedBy:S.businessId,active:true,createdAt:Date.now(),lastBookingAt:0};
      DB.users.push(u);await save();render();toast("Cuenta creada ✅");
      modal(`<h3>✅ Cuenta universal creada</h3><p>Pásale esto por WhatsApp a <b>${esc(name)}</b>:</p><div class="card pad" style="background:rgba(16,185,129,.08)">Teléfono: <b>${esc(u.phone)}</b><br>Contraseña: <b>${esc(pw)}</b><br><small>Vale en todos los locales. Sin reserva en ${INACT_DAYS} días se borra.</small></div><div class="row" style="margin-top:10px"><a class="btn ok" target="_blank" style="text-decoration:none;text-align:center" href="https://wa.me/${ph}?text=${encodeURIComponent("Hola "+name+", tu cuenta NailHub: teléfono "+u.phone+" + clave "+pw)}">💬 Enviar por WhatsApp</a><button class="btn ghost" onclick="window.__nhClose()">Cerrar</button></div>`);
    };
  }
  if(ownerTab==="galeria"){
    const up=$("#ownUpBtn"),fi=$("#ownUpFile");
    if(up)up.onclick=()=>fi.click();
    if(fi)fi.onchange=()=>{
      const f=fi.files[0];if(!f)return;
      const rd=new FileReader();rd.onload=async()=>{
        const img=new Image();img.onload=async()=>{
          const cv=document.createElement("canvas");const sc=Math.min(1,800/img.width);cv.width=img.width*sc;cv.height=img.height*sc;cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
          const url=cv.toDataURL("image/jpeg",.82);
          const title=prompt("Título del trabajo (ej. Francesa con cromo):")||"Nuevo trabajo 💅";
          const sub=await nhSubirFoto(url);DB.gallery.push({id:uid("g"),businessId:S.businessId,staffName:"Dueña",title,img:sub?sub.url:url,driveId:sub?sub.fileId:undefined,likes:0,createdAt:Date.now()});
          await save();render();toast("¡Foto publicada! 📸");
        };img.src=rd.result;
      };rd.readAsDataURL(f);
    };
    body.querySelectorAll("[data-dg]").forEach(x=>x.onclick=async()=>{if(!confirm("¿Borrar esta foto de la galería?"))return;const dg=DB.gallery.find(g=>g.id===x.dataset.dg);if(dg&&dg.driveId&&S.token)nhApi({action:"img_delete",token:S.token,fileId:dg.driveId}).catch(()=>{});DB.gallery=DB.gallery.filter(g=>g.id!==x.dataset.dg);await save();render()});
  }
  if(ownerTab==="notas"){
    $("#ntGo").onclick=async()=>{const t=$("#ntText").value.trim();if(!t)return;DB.notes.push({id:uid("n"),businessId:S.businessId,date:$("#ntDate").value||todayStr(),author:"Dueña",text:t,createdAt:Date.now()});await save();render()};
    body.querySelectorAll("[data-dn]").forEach(x=>x.onclick=async()=>{DB.notes=DB.notes.filter(n=>n.id!==x.dataset.dn);await save();render()});
  }
}
function svcModal(b,s){
  const isNew=!s;s=s||{name:"",price:28,durationMin:60,desc:"",includes:[{name:"Retirada anterior",included:true,price:0}]};
  modal(`<h3 style="margin-top:0">${isNew?"＋ Nuevo":"Editar"} servicio · ${esc(b.name)}</h3>
  <label>Nombre</label><input id="sName" value="${esc(s.name)}">
  <div class="row"><div><label>Precio base (CUP)</label><input id="sPrice" type="number" min="0" step="50" value="${s.price}"></div><div><label>Duración (min)</label><input id="sDur" type="number" min="15" step="5" value="${s.durationMin}"></div></div>
  <label>Descripción</label><textarea id="sDesc">${esc(s.desc)}</textarea>
  <label>Lo que incluye (una línea por ítem · ej. "Cromo (+500)" para extras en CUP)</label><textarea id="sInc" style="min-height:110px">${esc((s.includes||[]).map(i=>i.name+(i.included?" (incluido)":` (+${i.price} CUP)`)).join("\n"))}</textarea>
  <div class="row" style="margin-top:12px"><button class="btn ghost" onclick="window.__nhClose()">Cancelar</button><button class="btn" id="sGo">Guardar</button></div>`);
  $("#sGo").onclick=async()=>{
    const name=$("#sName").value.trim();if(!name){toast("Falta el nombre");return}
    const lines=$("#sDesc").value.trim();
    const incLines=$("#sInc").value.split("\n").map(x=>x.trim()).filter(Boolean).map(line=>{const m=line.match(/\(\+?\s*([\d.,]+)\s*€?\)/);if(m){return{name:line.replace(m[0],"").trim(),included:false,price:parseFloat(m[1].replace(",","."))||0}}return{name:line.replace(/\(.*incl.*\)/i,"").trim()||line,included:true,price:0}});
    if(isNew)DB.services.push({id:uid("svc"),businessId:b.id,name,price:+$("#sPrice").value||0,durationMin:+$("#sDur").value||60,desc:lines,active:true,includes:incLines});
    else Object.assign(s,{name,price:+$("#sPrice").value||0,durationMin:+$("#sDur").value||60,desc:lines,includes:incLines});
    await save();closeModal();render();toast("Servicio guardado 💅");
  };
}
function staffModal(b,s){
  const isNew=!s;s=s||{name:"",spec:"Manicura",color:"#ec4899",user:"",pass:"1234"};
  modal(`<h3 style="margin-top:0">${isNew?"＋ Fichar":"Editar"} profesional</h3><label>Nombre</label><input id="wName" value="${esc(s.name)}"><label>Especialidad</label><input id="wSpec" value="${esc(s.spec)}"><div class="row"><div><label>Usuario (login)</label><input id="wUser" value="${esc(s.user||"")}"></div><div><label>Contraseña</label><input id="wPass" value="${s.id?"":esc(s.pass||"1234")}" placeholder="Vacío = sin cambios"></div></div><label>Color avatar</label><input id="wCol" type="color" value="${s.color}"><div class="row" style="margin-top:12px"><button class="btn ghost" onclick="window.__nhClose()">Cancelar</button><button class="btn" id="wGo">Guardar</button></div>`);
  $("#wGo").onclick=async()=>{const n=$("#wName").value.trim();if(!n){toast("Falta el nombre");return}const uu=($("#wUser").value||"").trim().toLowerCase().replace(/\s+/g,"")||"staff";const pp=$("#wPass").value.trim();const clash=DB.staff.some(x=>x.id!==(s.id||"")&&(x.user||"").toLowerCase()===uu)||DB.businesses.some(x=>(x.ownerUser||"").toLowerCase()===uu)||uu==="admin"||DB.users.some(x=>(x.name||"").toLowerCase()===uu);if(clash){toast("Ese usuario ya existe, usa otro");return}if(isNew)DB.staff.push({id:uid("st"),businessId:b.id,name:n,spec:$("#wSpec").value.trim()||"Manicura",color:$("#wCol").value,user:uu,_newPass:pp||"1234",active:true});else Object.assign(s,{name:n,spec:$("#wSpec").value.trim(),color:$("#wCol").value,user:uu,...(pp?{_newPass:pp}:{})});await save();closeModal();render();toast("Equipo guardado 👩‍🎨")};
}

/* ---------- WORKER ---------- */
let workTab="hoy";
function workerHTML(){
  let b=S.businessId?biz(S.businessId):DB.businesses[0];if(b&&!S.businessId){S.businessId=b.id;const st=DB.staff.find(s=>s.businessId===b.id);if(st&&!S.staffId)S.staffId=st.id;saveSess()}
  const me=DB.staff.find(s=>s.id===S.staffId)||DB.staff.find(s=>s.businessId===b?.id);
  if(!b)return `<div class="card pad empty">Sin local asignado</div>`;
  const t=UI.calDate||todayStr();
  const tod=dayBookings(b.id,t).sort((a,c)=>a.time.localeCompare(c.time));
  const notes=DB.notes.filter(n=>n.businessId===b.id&&(n.date===t)).slice().reverse();
  const myGal=DB.gallery.filter(g=>g.businessId===b.id).slice().reverse();
  return `<div class="layout"><aside class="card side"><div class="staffrow" style="margin:4px"><div class="avatar" style="background:${me?.color||"#888"}">${esc((me?.name||"T")[0])}</div><div><b>${esc(me?.name||"Equipo")}</b><br><small style="color:var(--muted)">📍 ${esc(b.name)}</small></div></div>
  <button class="${workTab==="hoy"?"on":""}" data-wt="hoy">📅 Mi día</button><button class="${workTab==="notas"?"on":""}" data-wt="notas">📝 Notas del día</button><button class="${workTab==="gal"?"on":""}" data-wt="gal">📸 Portafolio</button></aside>
  <div>${workTab==="hoy"?`<div class="card pad"><div class="row" style="align-items:end"><div><h2 style="margin:0">Agenda del ${fmtD(t)}</h2><p class="sub">${tod.length}/${maxFor(b,t)} citas · no puedes editar cupos (solo la dueña).</p></div><div style="max-width:200px"><label>Día</label><input type="date" id="wDate" value="${t}"></div></div>
    <div class="timeline">${tod.map(x=>{const s=DB.services.find(y=>y.id===x.serviceId);return `<div class="titem"><b>${x.time}</b> · ${esc(x.clientName)} (${esc(x.clientPhone||"—")})<br>💅 ${esc(s?.name||"")} · extras: ${esc(x.extras.join(", ")||"—")} · <b>${eur(x.total)}</b> <span class="stt ${x.status==="pending"?"s-pend":"s-conf"}">${x.status}</span></div>`}).join("")||"Día libre 🎉"}</div></div>`:workTab==="notas"?`<div class="card pad"><h2 style="margin:0">📝 Notas del ${fmtD(t)}</h2><p class="sub">Aporta info operativa visible para dueña y equipo.</p><div class="row"><div style="flex:2"><input id="wNote" placeholder="Ej. Faltan limas 180, avisar a…"></div><div><button class="btn" id="wAdd">Añadir nota</button></div></div><div class="timeline">${notes.map(n=>`<div class="titem"><b>${esc(n.author)}</b><br>${esc(n.text)}</div>`).join("")||"Sin notas hoy"}</div></div>`:`<div class="card pad"><div class="row" style="align-items:center"><h2 style="margin:0">📸 Mi portafolio</h2><span style="flex:1"></span><button class="btn sm" id="upBtn">＋ Subir foto</button><input type="file" id="upFile" accept="image/*" hidden></div><p class="sub">Las fotos aparecen en la galería pública del local.</p><div class="gal">${myGal.map(g=>`<div class="gitem">${g.img?`<img src="${g.img}">`:`<div class="nailart" style="background:${g.bg}">${g.art}</div>`}<div class="gbody"><b>${esc(g.title)}</b><br><small>🤍 ${g.likes}</small></div></div>`).join("")||"Sin fotos"}</div></div>`}</div></div>`;
}
function bindWorker(body){
  body.querySelectorAll("[data-wt]").forEach(x=>x.onclick=()=>{workTab=x.dataset.wt;render()});
  const d=$("#wDate");if(d)d.onchange=()=>{UI.calDate=d.value;render()};
  const add=$("#wAdd");if(add)add.onclick=async()=>{const v=$("#wNote").value.trim();if(!v)return;const me=DB.staff.find(s=>s.id===S.staffId);DB.notes.push({id:uid("n"),businessId:S.businessId,date:UI.calDate||todayStr(),author:me?.name||"Equipo",text:v,createdAt:Date.now()});await save();render();toast("Nota añadida 📝")};
  const up=$("#upBtn"),fi=$("#upFile");
  if(up)up.onclick=()=>fi.click();
  if(fi)fi.onchange=()=>{
    const f=fi.files[0];if(!f)return;
    const rd=new FileReader();rd.onload=async()=>{
      const img=new Image();img.onload=async()=>{
        const cv=document.createElement("canvas");const sc=Math.min(1,800/img.width);cv.width=img.width*sc;cv.height=img.height*sc;cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
        const url=cv.toDataURL("image/jpeg",.82);
        const me=DB.staff.find(s=>s.id===S.staffId);
        const title=prompt("Título del trabajo (ej. Francesa con cromo):")||"Nuevo trabajo 💅";
        const sub=await nhSubirFoto(url);DB.gallery.push({id:uid("g"),businessId:S.businessId,staffName:me?.name||"Equipo",title,img:sub?sub.url:url,driveId:sub?sub.fileId:undefined,likes:0,createdAt:Date.now()});
        await save();render();toast("¡Foto publicada! 📸");
      };img.src=rd.result;
    };rd.readAsDataURL(f);
  };
}

/* ---------- boot ---------- */
(async function boot(){
  app.innerHTML=`<div class="loading"><div class="spin"></div> Cargando NailHub…</div>`;
  await loadDB();
  nhPing();setInterval(nhPing,60000);
  loadFx().then(()=>{try{render()}catch(e){}}); // pinta tasa en cuanto llega
  setInterval(async()=>{const f=await loadFx(true);if(f&&f.usd>0){try{const el=document.querySelector("#fxPill");if(el)el.innerHTML=fxPillHTML()}catch(e){}}},3600e3);
  if(!UI.calDate)UI.calDate=todayStr();
  UI.calMonth=UI.calDate.slice(0,7);
  render();
})();
})();
