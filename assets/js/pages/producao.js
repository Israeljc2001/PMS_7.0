
        const sessaoString = localStorage.getItem('sinaliza_sessao');
        let currentUser = null; let currentRole = null;

        if (!sessaoString) {
            window.location.href = 'index.html';
        } else {
            try {
                const sessaoData = JSON.parse(sessaoString);
                currentUser = sessaoData.username; currentRole = sessaoData.role;
                if (currentRole !== 'producao' && currentRole !== 'admin') {
                    window.location.href = 'index.html';
                }
            } catch(e) { window.location.href = 'index.html'; }
        }


        const API_URL = '/api';
        const MY_ROLE = 'producao';

        let ordersData = [];
        let configData = { workflow: [], movementReasons: {} };
        let producaoTeam = [];
        let currentFilter = 'all';
        let currentTab = 'dash';
        let lastScrollActivity = 0;

        function markScrollActivity() {
            lastScrollActivity = Date.now();
        }

        function isPageScrolled() {
            const mainContent = document.getElementById('main-content');
            const internalScroll = mainContent ? mainContent.scrollTop : 0;
            const pageScroll = window.scrollY || document.documentElement.scrollTop || 0;
            return internalScroll > 20 || pageScroll > 20;
        }

        function toggleClearBtn() {
            const input = document.getElementById('search-input');
            const btn = document.getElementById('clear-search-btn');
            if (input && btn) btn.style.display = input.value.length > 0 ? 'block' : 'none';
        }

        function clearSearch() {
            const input = document.getElementById('search-input');
            if (input) { input.value = ''; toggleClearBtn(); renderOrders(); }
        }

        window.onload = async () => {
            loadTheme();
            if(currentUser) document.getElementById('user-name').innerText = currentUser.toUpperCase();
            await loadConfig();
            await loadTeam();
            await loadData();
            setInterval(backgroundSync, 60000); 

            const mainContent = document.getElementById('main-content');
            const scrollBtn = document.getElementById('scrollTopBtn');
            const updateScrollButton = () => {
                markScrollActivity();
                if (!scrollBtn) return;
                const internalScroll = mainContent ? mainContent.scrollTop : 0;
                const pageScroll = window.scrollY || document.documentElement.scrollTop || 0;
                if (internalScroll > 260 || pageScroll > 260) scrollBtn.classList.add('visible');
                else scrollBtn.classList.remove('visible');
            };

            if (mainContent) mainContent.addEventListener('scroll', updateScrollButton, { passive: true });
            window.addEventListener('scroll', updateScrollButton, { passive: true });
            updateScrollButton();
        };

        function scrollToTop() {
            const mainContent = document.getElementById('main-content');
            if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function logout() { localStorage.removeItem('sinaliza_sessao'); window.location.href = 'index.html'; }

        async function apiFetch(endpoint, method = 'GET', body = null) {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            const res = await fetch(`${API_URL}${endpoint}`, options);
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || err.message || `Erro HTTP: ${res.status}`); }
            return res.json();
        }

        function safeParse(val) { if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return val; } } return val; }
        function getSafeStatus(val) { return String(val || '').trim().toLowerCase(); }

        function getStatusRealPedido(o) {
            let status = getSafeStatus(o.status);
            if (o.history && o.history.length > 0) {
                const ultimo = o.history[o.history.length - 1];
                if (ultimo && ultimo.to) status = getSafeStatus(ultimo.to);
            }
            return status;
        }

        function mapOrder(dbOrder) {
            return {
                id: dbOrder.ID || dbOrder.id,
                client: dbOrder.CLIENTE || dbOrder.client,
                sales: dbOrder.VENDEDOR || dbOrder.sales,
                delivery: dbOrder.DATA_ENTREGA || dbOrder.delivery,
                status: dbOrder.STATUS || dbOrder.status,
                contact: dbOrder.CONTATO || dbOrder.contact,
                email: dbOrder.EMAIL || dbOrder.email,
                obs: dbOrder.OBS || dbOrder.obs,
                itemCount: dbOrder.ITEM_COUNT || dbOrder.item_count || '?',
                issue_date: dbOrder.DATA_EMISSAO || dbOrder.issue_date,
                history: safeParse(dbOrder.HISTORY || dbOrder.history) || [],
                layoutData: safeParse(dbOrder.LAYOUT_DATA || dbOrder.layout_data) || null,
                prodData: safeParse(dbOrder.PROD_DATA || dbOrder.prod_data) || null,
                created_at: dbOrder.DATA_EMISSAO || dbOrder.created_at, 
                tipo_pedido: dbOrder.TIPO_PEDIDO || dbOrder.tipo_pedido
            };
        }

        function getOperadorStatus(o) {
            const prodStages = configData.workflow.filter(w => getSafeStatus(w.role).includes(MY_ROLE)).map(w => getSafeStatus(w.name));
            if (!prodStages.includes(getStatusRealPedido(o))) return { isAssumed: false };
            
            const logs = [...(o.history || [])].reverse();
            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                const fromStage = getSafeStatus(h.from);
                const toStage = getSafeStatus(h.to);
                
                if (act.includes('retorno') || act.includes('reprov')) return { isAssumed: false };

                if (act === 'início de produção' || ((prodStages.includes(fromStage) || prodStages.includes(toStage)) && (act.includes('iniciad') || act.includes('inicio')))) {
                    let user = h.user && String(h.user).toLowerCase() !== 'sistema' ? h.user : (producaoTeam[0] || 'Anderson');
                    return { isAssumed: true, user: user, time: h.date };
                }
            }
            return { isAssumed: false };
        }

        function isRetorno(o) {
            if (!o.history || o.history.length === 0) return false;
            const lastLog = [...o.history].reverse()[0];
            const act = String(lastLog.action || '').toLowerCase();
            return act.includes('retorno') || act.includes('reprov');
        }

        function getTipoPedido(o) {
            let tp = String(o.tipo_pedido || '').toLowerCase().trim();
            if (tp && tp !== 'undefined' && tp !== 'normal' && tp !== 'convencional') return tp;
            if (Array.isArray(o.history)) {
                for (let h of o.history) {
                    if (h.obs) {
                        const obsLower = String(h.obs).toLowerCase();
                        if (obsLower.includes('urgente')) return 'urgente';
                        if (obsLower.includes('homologado')) return 'homologado';
                        if (obsLower.includes('projeto')) return 'projeto';
                    }
                }
            }
            return 'normal';
        }

        async function loadConfig() { 
            try { 
                const wf = await apiFetch('/config/workflow');
                if(wf && wf.dados) { let wData = wf.dados; if(typeof wData === 'string') wData = JSON.parse(wData); configData.workflow = wData; } 
                const mr = await apiFetch('/config/motivos');
                if(mr && mr.dados) { let mData = mr.dados; if(typeof mData === 'string') mData = JSON.parse(mData); configData.movementReasons = mData; }
            } catch(e){} 
        }

        async function loadTeam() {
            try {
                const users = await apiFetch('/usuarios');
                let dbUsers = users.filter(u => getSafeStatus(u.ROLE || u.role) === MY_ROLE).map(u => String(u.USERNAME || u.username).trim());
                producaoTeam = [...new Set(dbUsers.filter(Boolean))];
                if(producaoTeam.length === 0) producaoTeam = ['Anderson']; 
            } catch(e) { producaoTeam = ['Anderson']; }
        }

        async function loadData() { 
            const statusBadge = document.getElementById('db-status-badge');
            const statusText = document.getElementById('db-status-text');

            try {
                statusBadge.className = 'status-badge-top syncing'; statusText.innerHTML = 'Sincronizando... <i class="ph-bold ph-spinner ph-spin"></i>';
                const rawData = await apiFetch('/pedidos'); 
                statusBadge.className = 'status-badge-top online'; statusText.innerHTML = 'Conectado';

                const now = new Date();
                document.getElementById('last-update-text').innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                if(rawData) { 
                    ordersData = rawData.map(mapOrder); 
                    if(currentTab !== 'reports') renderOrders();
                    else renderRanking();
                    
                    // CHAME O GATILHO AQUI Ã°Å¸â€˜â€¡
                    verificarLockdownAtrasos();
                }
            } catch(e){
                statusBadge.className = 'status-badge-top offline'; statusText.innerHTML = 'Falha de Conexão';
            }

        }

        async function sync() { 
            try { await SinalizaCore.triggerVPNSync(); Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Agente sincronizado!', showConfirmButton: false, timer: 2000 }); } catch(e){} 
            loadData(); 
        }

        function isUserInteracting() {
            if (Date.now() - lastScrollActivity < 1200 || isPageScrolled()) return true;
            const modals = document.querySelectorAll('.modal-overlay');
            for (let m of modals) { if (m.style.display === 'flex' || window.getComputedStyle(m).display === 'flex') return true; }
            if (document.querySelectorAll('.list-row.is-expanded').length > 0) return true;
            if (document.activeElement && document.activeElement.id === 'search-input' && document.activeElement.value !== '') return true;
            return false;
        }

        async function backgroundSync() {
            try {
                const rawData = await apiFetch('/pedidos'); 
                if(rawData) { 
                    ordersData = rawData.map(mapOrder); 
                    const now = new Date();
                    const statusTxt = document.getElementById('last-update-text');
                    if(statusTxt) statusTxt.innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    if (!isUserInteracting()) {
                        if(currentTab !== 'reports') renderOrders();
                        else renderRanking(); 
                    }
                } 
            } catch(e) {}
        }

        function switchTab(tab) { 
            currentTab = tab;
            const viewDash = document.getElementById('view-dash');
            const viewReports = document.getElementById('view-reports');
            
            if(viewDash) viewDash.classList.add('hidden'); 
            if(viewReports) viewReports.classList.add('hidden'); 
            
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active')); 
            const activeBtn = document.getElementById('btn-'+tab);
            if(activeBtn) activeBtn.classList.add('active'); 

            if(tab === 'reports') {
                if(viewReports) viewReports.classList.remove('hidden'); 
                document.getElementById('page-title').innerText = "Relatórios";
                document.getElementById('page-subtitle').innerText = "Métricas operacionais da fábrica.";
                if (typeof renderRanking === 'function') renderRanking();
            } else {
                if(viewDash) viewDash.classList.remove('hidden'); 
                if(tab === 'returns') {
                    document.getElementById('page-title').innerText = "Fila de Retornos";
                    document.getElementById('page-subtitle').innerText = "Pedidos devolvidos que precisam de correção na produção.";
                } else {
                    document.getElementById('page-title').innerText = "Fila de Produção";
                    document.getElementById('page-subtitle').innerText = "Execução de ordens de serviço liberadas.";
                }
                renderOrders();
            }
        }

        window.toggleCard = function(id) {
            const row = document.getElementById(`row-${id}`); if (!row) return;
            const wasExpanded = row.classList.contains('is-expanded');
            document.querySelectorAll('.list-row.is-expanded').forEach(c => c.classList.remove('is-expanded'));
            if (!wasExpanded) row.classList.add('is-expanded');
        };

        function renderOrders() {
            const container = document.getElementById('orders-container');
            const kpiContainer = document.getElementById('kpi-container');
            const searchTerm = document.getElementById('search-input') ? document.getElementById('search-input').value.toLowerCase() : '';
            const sortValue = document.getElementById('sort-select') ? document.getElementById('sort-select').value : 'oldest';
            const typeFilter = document.getElementById('filter-type') ? document.getElementById('filter-type').value : 'all'; 
            
            const myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE)).map(s => getSafeStatus(s.name));
            let myOrders = ordersData.filter(o => myStages.includes(getStatusRealPedido(o)));

            const returnedOrders = myOrders.filter(o => isRetorno(o));
            const normalOrders = myOrders.filter(o => !isRetorno(o));

            const badge = document.getElementById('badge-returns');
            if(badge) {
                if(returnedOrders.length > 0) { badge.innerText = returnedOrders.length; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
            }

            let activeOrders = currentTab === 'returns' ? returnedOrders : normalOrders;

            if (searchTerm) { activeOrders = activeOrders.filter(o => String(o.id).includes(searchTerm) || (o.client && o.client.toLowerCase().includes(searchTerm))); }

            if (typeFilter !== 'all') {
                activeOrders = activeOrders.filter(o => {
                    const tp = getTipoPedido(o);
                    if (typeFilter === 'normal') return tp === 'normal' || tp === 'convencional' || tp === '';
                    return tp === typeFilter;
                });
            }

            const waiting = activeOrders.filter(o => !getOperadorStatus(o).isAssumed).length;
            const inProgress = activeOrders.filter(o => getOperadorStatus(o).isAssumed).length;

            if(kpiContainer) {
                kpiContainer.innerHTML = `
                    <div class="kpi-card kpi-filter-card ${currentFilter==='all'?'is-selected':''}" data-filter="all" onclick="currentFilter='all'; renderOrders()"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:var(--cor-panel-bg); color:var(--cor-texto);"><i class="ph-fill ph-list-dashes"></i></div><div><span class="kpi-label">Fila Total (${currentTab==='returns'?'Retornos':'Novos'})</span><div class="kpi-val">${activeOrders.length}</div></div></div></div>
                    <div class="kpi-card kpi-filter-card ${currentFilter==='waiting'?'is-selected':''}" data-filter="waiting" onclick="currentFilter='waiting'; renderOrders()"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:var(--warning-bg); color:var(--cor-alerta);"><i class="ph-fill ph-clock"></i></div><div><span class="kpi-label">Aguardando Máquina</span><div class="kpi-val" style="color:var(--cor-alerta)">${waiting}</div></div></div></div>
                    <div class="kpi-card kpi-filter-card ${currentFilter==='progress'?'is-selected':''}" data-filter="progress" onclick="currentFilter='progress'; renderOrders()"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria);"><i class="ph-fill ph-hammer"></i></div><div><span class="kpi-label">Sendo Produzido</span><div class="kpi-val" style="color:var(--cor-primaria)">${inProgress}</div></div></div></div>
                `;
            }

            let filtered = activeOrders;
            if(currentFilter === 'waiting') filtered = activeOrders.filter(o => !getOperadorStatus(o).isAssumed);
            if(currentFilter === 'progress') filtered = activeOrders.filter(o => getOperadorStatus(o).isAssumed);

            if(filtered.length === 0) { 
                if (currentTab === 'returns') {
                    container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Sem Retornos Pendentes!</strong></div>';
                } else {
                    container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Fábrica Limpa!</strong></div>'; 
                }
                return; 
            }

            filtered.sort((a,b) => {
                const aStarted = getOperadorStatus(a).isAssumed ? 1 : 0; 
                const bStarted = getOperadorStatus(b).isAssumed ? 1 : 0;
                if (aStarted !== bStarted) return aStarted - bStarted; 

                let sA = { status: 'normal', dateStr: '9999-12-31' };
                let sB = { status: 'normal', dateStr: '9999-12-31' };
                
                try { sA = SinalizaCore.calculateSLA(a, (a.prodData && a.prodData.extensions) ? a.prodData.extensions : []) || sA; } catch(e){}
                try { sB = SinalizaCore.calculateSLA(b, (b.prodData && b.prodData.extensions) ? b.prodData.extensions : []) || sB; } catch(e){}

                if (sortValue === 'late') {
                    if (sA.status === 'late' && sB.status !== 'late') return -1;
                    if (sA.status !== 'late' && sB.status === 'late') return 1;
                    if (sA.status === 'warning' && sB.status !== 'warning') return -1;
                    if (sA.status !== 'warning' && sB.status === 'warning') return 1;
                    return new Date(sA.dateStr) - new Date(sB.dateStr); 
                }

                if (sortValue === 'recent') return new Date(b.created_at) - new Date(a.created_at);
                else return new Date(a.created_at) - new Date(b.created_at); 
            });

            container.innerHTML = filtered.map(o => createRowHTML(o, currentTab === 'returns')).join('');
        }

        function createRowHTML(o, ehRetorno = false) {
            const stepsSafe = configData.workflow.map(x => getSafeStatus(x.name)); 
            const oStatusSafe = getStatusRealPedido(o);
            let idx = stepsSafe.indexOf(oStatusSafe); if(idx === -1) idx = 0; 
            
            let slaInfo = { status: 'normal', displayDate: 'N/D', dateStr: '9999-12-31' };
            try { slaInfo = SinalizaCore.calculateSLA(o, (o.prodData && o.prodData.extensions) ? o.prodData.extensions : []) || slaInfo; } catch(e){}
            
            const isLate = slaInfo.status === 'late';
            const isWarning = slaInfo.status === 'warning';
            
            const prodInfo = getOperadorStatus(o);
            const isAssumed = prodInfo.isAssumed;

            const originalSteps = configData.workflow.map(x => x.name);
            let displaySteps = originalSteps;
            if(originalSteps.length > 5) {
                if(idx < 3) displaySteps = originalSteps.slice(0, 4);
                else if (idx >= originalSteps.length - 2) displaySteps = originalSteps.slice(originalSteps.length - 4);
                else displaySteps = originalSteps.slice(idx - 1, idx + 3);
            }

            const stepperHTML = displaySteps.map((stepName, i) => { 
                const realIdx = stepsSafe.indexOf(getSafeStatus(stepName));
                let cls = '', ico = ''; let stepDate = '';

                if (realIdx <= idx) {
                    const historyMoves = Array.isArray(o.history) ? o.history : [];
                    const move = [...historyMoves].reverse().find(h => getSafeStatus(h.to) === getSafeStatus(stepName));
                    if (move && move.date) { try { const d = new Date(move.date); if(!isNaN(d)) stepDate = String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); } catch(e){} } 
                    else if (realIdx === 0 && o.created_at) { try { const d = new Date(o.created_at); if(!isNaN(d)) stepDate = String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); } catch(e){} }
                }

                if (realIdx < idx) { cls = 'done'; ico = '<i class="ph-bold ph-check"></i>'; } 
                else if (realIdx === idx) { 
                    if (isLate) cls = 'active late';
                    else if (isWarning) cls = 'active warning';
                    else cls = 'active';
                    ico = '<i class="ph-bold ph-spinner-gap ph-spin"></i>'; 
                } 
                const hasLine = i < displaySteps.length - 1;
                
                return `<div class="stepper-item ${cls}"><span class="stepper-date">${stepDate}</span><div class="stepper-circle">${ico}</div><span class="stepper-label">${String(stepName).substring(0, 15)}</span>${hasLine ? '<div class="stepper-line"></div>' : ''}</div>`; 
            }).join('');

            let rowClass = "list-row";
            if(isLate) rowClass += " late";
            else if(isWarning) rowClass += " warning";

            if(ehRetorno) rowClass += " is-retorno";

            let btnExt = `<button class="btn btn-warning btn-icon-only" style="height:32px; width:32px; border-radius:6px;" onclick="event.stopPropagation(); openPrazoModal('${o.id}')" title="Pedir prazo extra"><i class="ph-bold ph-calendar-plus" style="font-size:1.1rem;"></i></button>`;
            
            let mainAction = '';
            let prevStep = null; let nextStep = null;
            const statusRealOriginal = (configData.workflow.find(s => getSafeStatus(s.name) === oStatusSafe) || {}).name || o.status;
            try { prevStep = SinalizaCore.getPrevStep(statusRealOriginal, configData.workflow); nextStep = SinalizaCore.getNextStep(statusRealOriginal, configData.workflow); } catch(e){}

            if (!isAssumed) {
                mainAction = `<button class="btn btn-primary" style="height:32px; border-radius:6px; padding:0 12px; font-size: 0.8rem;" onclick="event.stopPropagation(); confirmAssume('${o.id}')"><i class="ph-bold ph-play"></i> Iniciar Máquina</button>`;
            } else {
                mainAction = `<button class="btn btn-success" style="height:32px; border-radius:6px; padding:0 12px; font-size: 0.8rem;" onclick="event.stopPropagation(); openActionModal('${o.id}', '${nextStep}', 'next')"><i class="ph-bold ph-check-double"></i> Pronto p/ Faturar</button>`;
            }

            let btnReturn = prevStep && configData.workflow[idx] && configData.workflow[idx].canReturn ? `<button class="btn btn-danger btn-icon-only" style="height:32px; width:32px; border-radius:6px;" onclick="event.stopPropagation(); openActionModal('${o.id}', '${prevStep}', 'back')" title="Erro no material/Devolver ao PCP"><i class="ph-bold ph-arrow-u-up-left" style="font-size:1.1rem;"></i></button>` : '';

            let tipo = getTipoPedido(o);
            let tagPrioridade = '';
            if (tipo === 'urgente') tagPrioridade = `<div class="tag-urgente"><i class="ph-fill ph-fire"></i> URGENTE</div>`;
            else if (tipo === 'homologado') tagPrioridade = `<div class="tag-homologado"><i class="ph-fill ph-star"></i> HOMOL</div>`;
            else if (tipo === 'projeto') tagPrioridade = `<div class="tag-projeto"><i class="ph-fill ph-blueprint"></i> PROJ</div>`;
            else tagPrioridade = `<div class="tag-normal"><i class="ph-fill ph-package"></i> NORMAL</div>`;

            let tagRetornoBadge = ehRetorno ? `<div class="tag-retorno"><i class="ph-fill ph-warning-octagon"></i> RETORNO DA PRODUÇÃO</div>` : '';

            let obsComercial = ''; let obsLayout = ''; let obsPCP = ''; let obsRetorno = '';
            
            if(o.obs) { obsComercial = `<div class="obs-comercial"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-briefcase"></i> Briefing Comercial</div>${o.obs.replace(/\n/g, '<br>')}</div>`; }
            
            if(Array.isArray(o.history)) {
                const layoutHist = [...o.history].reverse().find(h => String(h.action || '').toLowerCase().includes('finalizad') || h.action.includes('Projeto Finalizado'));
                if(layoutHist && layoutHist.obs) { obsLayout = `<div class="obs-layout"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-paint-brush"></i> Notas do Layout (${layoutHist.user})</div>${layoutHist.obs.replace(/\n/g, '<br>')}</div>`; }

                const pcpHist = [...o.history].reverse().find(h => h.action.includes('Liberação PCP') || h.action.includes('Avanço'));
                if(pcpHist && pcpHist.obs) { obsPCP = `<div class="obs-pcp"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-check-square-offset"></i> Notas Técnicas PCP (${pcpHist.user})</div>${pcpHist.obs.replace(/\n/g, '<br>')}</div>`; }

                if (ehRetorno) {
                    const retHist = [...o.history].reverse().find(h => h.action.includes('Retorno') || h.action.includes('Reprov'));
                    if (retHist && retHist.obs) {
                        obsRetorno = `<div style="background:var(--danger-bg); border-left:4px solid var(--cor-erro); padding:15px; border-radius:var(--radius-padrao); margin-bottom:15px;">
                            <div style="font-size:0.8rem; font-weight:700; color:var(--cor-erro); margin-bottom:4px;"><i class="ph-fill ph-warning-octagon"></i> Motivo do Retorno (${retHist.user})</div>
                            <div style="font-size:0.9rem; color:var(--cor-texto); font-weight:500;">${retHist.obs.replace(/\n/g, '<br>')}</div>
                        </div>`;
                    }
                }
            }

            let blocoInteligenteObs = obsPCP + obsLayout + obsComercial;
            if(!blocoInteligenteObs) blocoInteligenteObs = '<div style="color:var(--cor-texto-mutado); font-style:italic; text-align:center; padding:20px;">Nenhuma observação técnica das etapas anteriores.</div>';

            let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : '';

            return `
            <div class="${rowClass}" id="row-${o.id}">
                <div class="row-header" onclick="toggleCard('${o.id}')">
                    <div class="col-id">
                        <div class="row-id" style="margin:0;">#${o.id}</div>
                        ${tagRetornoBadge} ${tagPrioridade}
                    </div>
                    <div class="col-client">
                        <div class="row-client" title="${safeClient}">${safeClient || 'N/D'}</div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <span class="info-praz"><i class="ph-bold ph-calendar-blank"></i> Praz: <strong>${slaInfo.displayDate}</strong></span>
                            <span class="info-praz"><i class="ph-bold ph-package"></i> Itens: <strong style="color:var(--cor-primaria)">${o.itemCount || '?'}</strong></span>
                        </div>
                    </div>
                    <div class="col-stepper">
                        ${isAssumed ? `<span class="info-status status-active"><i class="ph-fill ph-hammer"></i> ${prodInfo.user}</span>` : `<span class="info-status status-waiting"><i class="ph-fill ph-clock"></i> Fila da Máquina</span>`}
                        <div class="stepper-wrapper">${stepperHTML}</div>
                    </div>
                    <div class="col-actions">
                        <div class="action-buttons">${btnReturn} ${btnExt} ${mainAction}</div>
                        <div class="btn-detalhes">Instruções Técnicas <i class="ph-bold ph-caret-down"></i></div>
                    </div>
                </div>
                <div class="card-details" onclick="event.stopPropagation()">
                    ${obsRetorno}
                    <div style="display:grid; grid-template-columns: 1.5fr 1fr; gap:20px; margin-bottom:15px;">
                        <div class="obs-block">
                            <div style="font-size:0.8rem; font-weight:700; color:var(--cor-texto); text-transform:uppercase; margin-bottom:15px; border-bottom:1px solid var(--cor-borda); padding-bottom:8px;"><i class="ph-fill ph-list-checks"></i> Observações Técnicas das Etapas</div>
                            ${blocoInteligenteObs}
                        </div>
                        <div style="display: flex; flex-direction: column; justify-content: center; gap: 15px;">
                            <button class="btn btn-secondary" style="width: 100%; height: 60px; font-size: 0.95rem;" onclick="openFilesModal('${o.id}')">
                                <i class="ph-fill ph-folder-open" style="font-size:1.3rem; color:var(--cor-primaria);"></i> Ver Lote de Produção (VPN)
                            </button>
                            <button class="btn btn-secondary" style="width: 100%; height: 50px; font-size: 0.95rem;" onclick="openHistoryModal('${o.id}')">
                                <i class="ph-fill ph-clock-counter-clockwise" style="font-size:1.3rem; color:var(--cor-texto);"></i> Ver Auditoria Completa
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        async function confirmAssume(id) {
            const nomeOperador = currentUser || 'Produção';
            const o = ordersData.find(x => x.id == id);
            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry('Início de Produção', o.status, nomeOperador, '', 'Iniciado na máquina / bancada.')];
            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { history: newHistory, ...SinalizaCore.gerarTimestamps(o.status, o.status) });
                Swal.fire({toast:true, position:'top-end', icon:'success', title:`Iniciado por ${nomeOperador}!`, showConfirmButton:false, timer:2000});
                loadData();
            } catch(e) { Swal.fire('Erro', 'Falha ao iniciar: ' + e.message, 'error'); }
        }

        function openPrazoModal(id) {
            document.getElementById('prazo-id').value = id;
            document.getElementById('prazo-dias').value = '1';
            document.getElementById('prazo-motivo').selectedIndex = 0;
            document.getElementById('prazoModal').style.display = 'flex';
        }

        async function confirmPrazo() {
            const id = document.getElementById('prazo-id').value;
            const dias = parseInt(document.getElementById('prazo-dias').value);
            const motivo = document.getElementById('prazo-motivo').value;
            const o = ordersData.find(x => x.id == id); if(!o) return;

            const nomeOperador = currentUser || 'Produção';
            
            const newExt = { requestedAt: new Date().toISOString(), days: dias, reason: motivo, requestedBy: nomeOperador };
            
            let currentProdData = o.prodData || {};
            let currentExt = currentProdData.extensions || [];
            currentExt.push(newExt);
            
            const updatedProdData = { ...currentProdData, extensions: currentExt };

            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry('Prazo Estendido', o.status, nomeOperador, '', `Solicitado +${dias} dia(s). Motivo: ${motivo}`)];

            let baseDateStr = o.delivery || o.issue_date || o.created_at;
            let dateObj = new Date(); 

            if (baseDateStr) {
                let cleanDate = String(baseDateStr).trim().split('T')[0]; 
                if (cleanDate.includes('/')) {
                    let partes = cleanDate.split('/');
                    if(partes.length === 3) dateObj = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]), 12, 0, 0);
                } else if (cleanDate.includes('-')) {
                    let partes = cleanDate.split('-');
                    if(partes.length === 3) {
                        if (partes[0].length === 4) {
                            dateObj = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]), 12, 0, 0);
                        } else {
                            dateObj = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]), 12, 0, 0);
                        }
                    }
                }
            }

            if (isNaN(dateObj.getTime())) { dateObj = new Date(); }
            dateObj.setDate(dateObj.getDate() + dias);

            let nAno = dateObj.getFullYear();
            let nMes = String(dateObj.getMonth() + 1).padStart(2, '0');
            let nDia = String(dateObj.getDate()).padStart(2, '0');
            let newDeliveryDate = `${nAno}-${nMes}-${nDia}`;

            const btn = document.querySelector('#prazoModal .btn-warning');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Solicitando...';
            btn.disabled = true;

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { prodData: updatedProdData, history: newHistory, data_entrega: newDeliveryDate });
                document.getElementById('prazoModal').style.display = 'none';
                Swal.fire({toast:true, position:'top-end', icon:'success', title:`Novo prazo estendido para ${nDia}/${nMes}/${nAno}!`, showConfirmButton:false, timer:4000});
                loadData();
            } catch(e) { Swal.fire('Erro Oracle', 'Falha ao pedir prazo: ' + e.message, 'error'); 
            } finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        function openActionModal(id, next, type) { 
            document.getElementById('modal-id').value = id; document.getElementById('modal-new-status').value = next; document.getElementById('modal-move-type').value = type;
            document.getElementById('modal-obs').value = ''; document.getElementById('modal-peso').value = ''; document.getElementById('modal-volume').value = '';
            
            const reasonSelect = document.getElementById('modal-reason-select'); reasonSelect.innerHTML = '<option value="">Selecione o motivo da movimentação...</option>';
            let availableReasons = [];
            if (configData.movementReasons && configData.movementReasons[MY_ROLE]) {
                const direction = type === 'next' ? 'forward' : 'backward';
                availableReasons = configData.movementReasons[MY_ROLE][direction] || [];
            }
            if (availableReasons.length === 0) availableReasons = ['Finalizado na Máquina'];
            availableReasons.forEach(r => { reasonSelect.innerHTML += `<option value="${r}">${r}</option>`; });

            const t = document.getElementById('modal-title'); const d = document.getElementById('modal-desc'); const b = document.getElementById('btn-confirm-action'); 
            const shipInfo = document.getElementById('modal-shipping-info');

            if(type === 'next'){
                t.innerHTML='<i class="ph-fill ph-check-double" style="color:var(--cor-sucesso)"></i> Pronto p/ Faturamento'; 
                d.innerHTML=`Tudo certo com a peça? O projeto será enviado para a <b>${next}</b>.`; 
                b.className='btn btn-success'; b.innerHTML = '<i class="ph-bold ph-check"></i> Enviar p/ Expedição';
                shipInfo.classList.remove('hidden');
            } else {
                t.innerHTML='<i class="ph-fill ph-arrow-u-up-left" style="color:var(--cor-erro)"></i> Devolver ao PCP'; 
                d.innerHTML=`Erro de ficheiro ou material? O projeto será retornado para <b>${next}</b>.`; 
                b.className='btn btn-danger'; b.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> Devolver Pedido';
                shipInfo.classList.add('hidden');
            } 
            document.getElementById('actionModal').style.display = 'flex'; 
        }
        
        async function confirmAction() { 
            const id = document.getElementById('modal-id').value; 
            const next = document.getElementById('modal-new-status').value; 
            const type = document.getElementById('modal-move-type').value;
            const reason = document.getElementById('modal-reason-select').value;
            const obsText = document.getElementById('modal-obs').value; 
            const peso = document.getElementById('modal-peso').value;
            const volume = document.getElementById('modal-volume').value;
            
            if (!reason) return Swal.fire("Atenção", "Selecione um motivo na lista.", "warning");

            const btn = document.getElementById('btn-confirm-action'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...'; btn.disabled = true;

            const o = ordersData.find(x => x.id == id); 
            const isReturn = type === 'back'; 
            const nomeOperador = currentUser || 'Produção';
            
            let finalObs = obsText;
            if (!isReturn) {
                let infoExpedicao = [];
                if (peso) infoExpedicao.push(`Peso: ${peso}kg`);
                if (volume) infoExpedicao.push(`Volumes: ${volume}`);
                if (infoExpedicao.length > 0) finalObs = `[Expedição: ${infoExpedicao.join(' | ')}]\n${finalObs}`.trim();
            }

            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry(isReturn ? 'Retorno Produção' : 'Produção Finalizada', next, nomeOperador, reason, finalObs)]; 
            let updatePayload = { status: next, history: newHistory, ...SinalizaCore.gerarTimestamps(o.status, next) };

            if (!isReturn) {
                let currentProdData = o.prodData || {};
                updatePayload.prodData = { ...currentProdData, pesoExpedicao: peso, volumeExpedicao: volume };
            }

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', updatePayload);
                document.getElementById('actionModal').style.display='none'; 
                Swal.fire({toast:true, position:'top-end', icon:'success', title:isReturn ? 'Devolvido ao PCP' : 'Enviado para Expedição!', showConfirmButton:false, timer:3000});
                loadData(); 
            } catch(e) { Swal.fire('Erro Técnico', e.message, 'error'); } 
            finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        function closeModal() { document.getElementById('actionModal').style.display='none'; }
        async function abrirPreview(id) { openFilesModal(id); }

        async function openFilesModal(id) {
            document.getElementById('modal-order-id').innerText = '#' + id;
            document.getElementById('filesModal').style.display = 'flex';
            const list = document.getElementById('file-list-container');
            const preview = document.getElementById('preview-container');
            
            list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--cor-texto-mutado);"><i class="ph-bold ph-spinner ph-spin" style="font-size:3rem; margin-bottom:15px; color:var(--cor-primaria);"></i><br><strong style="font-size:1.1rem;">Acessando Rede...</strong></div>';
            preview.innerHTML = '<div style="color:var(--cor-texto-mutado); display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; font-weight:600;"><i class="ph-fill ph-image" style="font-size:5rem; margin-bottom:20px; opacity:0.2;"></i> Selecione um arquivo para imprimir/cortar</div>';

            try {
                const arquivosBrutos = await SinalizaCore.fetchFilesFromVPN(id);
                const arquivosFiltrados = (arquivosBrutos || []).filter(f => {
                    const n = f.name.toLowerCase();
                    const p = f.folder.toLowerCase();
                    return n.includes('lote') || p.includes('lote'); 
                });

                if(arquivosFiltrados.length === 0) { 
                    list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--cor-texto-mutado);"><i class="ph-fill ph-empty" style="font-size:3rem; margin-bottom:15px;"></i><br><strong>Nenhum arquivo de Lote de Produção encontrado.</strong><br><span style="font-size:0.8rem; margin-top:10px; display:block;">O PCP ainda não gerou o lote ou a pasta está vazia.</span></div>'; 
                    return; 
                }

                list.innerHTML = '';
                arquivosFiltrados.forEach(f => {
                    const item = document.createElement('div'); item.className = 'file-item';
                    let icon = 'ph-file';
                    if(f.ext === 'pdf') icon = 'ph-file-pdf'; else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) icon = 'ph-image'; else if(['xls','xlsx','csv'].includes(f.ext)) icon = 'ph-file-xls';
                    const badge = f.folder.toLowerCase().replace(/[\u0300-\u036f]/g, "");
                    
                    item.innerHTML = `<div style="display:flex; align-items:center; gap:10px; overflow:hidden;"><i class="ph-fill ${icon}" style="font-size:1.4rem; color:var(--cor-texto-mutado);"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.name}">${f.name}</span></div><span class="file-chip chip-${badge}">${f.folder}</span>`;
                    
                    item.onclick = () => {
                        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active')); item.classList.add('active');
                        const url = `${SinalizaCore.VPN_URL}${f.url}`;
                        preview.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><i class="ph-bold ph-spinner ph-spin" style="font-size:4rem; color:var(--cor-primaria);"></i></div>';
                        setTimeout(() => {
                            if(['pdf','html','txt'].includes(f.ext)) { preview.innerHTML = `<iframe src="${url}" class="preview-iframe"></iframe>`; } 
                            else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) { preview.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; object-fit:contain; border-radius: 12px; box-shadow: var(--sombra-md);">`; } 
                            else { preview.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--cor-texto);"><div style="background:var(--cor-card-bg); padding:40px; border-radius:20px; border:1px solid var(--cor-borda); text-align:center; box-shadow:var(--sombra-sm);"><i class="ph-fill ph-download-simple" style="font-size:4rem; margin-bottom:15px; color:var(--cor-primaria);"></i><p style="margin-bottom:20px; font-weight:800; font-size:1rem;">Pronto para download.</p><a href="${url}" target="_blank" class="btn btn-primary" style="text-decoration:none;">Baixar Arquivo</a></div></div>`; }
                        }, 100);
                    };
                    list.appendChild(item);
                });
            } catch(e) { list.innerHTML = `<div style="padding:40px; text-align:center; color:var(--cor-erro);"><i class="ph-fill ph-warning-circle" style="font-size:3rem; margin-bottom:15px;"></i><br><b>Erro de VPN. O Agente local parece estar offline.</b></div>`; }
        }
        function closeFilesModal() { document.getElementById('filesModal').style.display = 'none'; document.getElementById('preview-container').innerHTML = ''; }

        function openHistoryModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id)); if(!o) return; document.getElementById('hist-order-id').innerText = '#' + id; const container = document.getElementById('history-container'); container.innerHTML = '';
            if (!o.history || o.history.length === 0) { container.innerHTML = '<div style="text-align:center; padding: 50px 20px; color:var(--cor-texto-mutado);"><i class="ph-fill ph-ghost" style="font-size:4rem; margin-bottom:15px; opacity:0.3;"></i><br><strong style="font-size:0.95rem;">Sem Histórico!</strong></div>'; } 
            else {
                const histRev = [...o.history].reverse();
                histRev.forEach((h, index) => {
                    const dateObj = new Date(h.date); const dateStr = dateObj.toLocaleDateString('pt-BR') + ' às ' + dateObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                    let actionBadge = ''; 
                    if(h.action.includes('Iniciad') || h.action.includes('Produção Finalizada')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else if(h.action.includes('Admin') || h.action.includes('Bypass') || h.action.includes('Massa')) { actionBadge = `<span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } 
                    else if(h.action.includes('Reprovação') || h.action.includes('Retorno')) { actionBadge = `<span style="background:var(--danger-bg); color:var(--cor-erro); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else { actionBadge = `<span style="background:#D1FAE5; color:var(--cor-sucesso); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">MOVIMENTAÇÃO</span>`; }
                    
                    let obsHtml = h.obs ? `<div style="font-size: 0.9rem; color: var(--cor-texto); margin-top: 8px; background: var(--cor-panel-bg); padding: 12px; border-radius: 10px; border-left: 3px solid var(--cor-primaria); font-weight: 600;">${h.obs.replace(/\n/g, '<br>')}</div>` : ''; let isCurrent = index === 0 ? `<span style="color:white; font-size:0.65rem; background:var(--cor-primaria); padding:2px 6px; border-radius:4px; margin-left:auto; font-weight:700;">ETAPA ATUAL</span>` : '';
                    container.innerHTML += `<div style="padding: 15px 0; border-bottom: 1px dashed var(--cor-borda);"><div style="font-size: 0.75rem; color: var(--cor-texto-mutado); margin-bottom: 6px; display:flex; align-items:center; gap:5px; font-weight: 800; text-transform: uppercase;"><i class="ph-bold ph-calendar-blank"></i> ${dateStr} ${isCurrent}</div><div style="font-weight: 900; font-size: 1.05rem; color: var(--cor-texto); display:flex; align-items:center; flex-wrap:wrap; gap:8px;"><i class="ph-fill ph-user-circle" style="font-size:1.5rem; color:var(--cor-texto-mutado);"></i> <span style="font-weight:900; font-size:1rem;">${h.user || 'Sistema'}</span> <i class="ph-bold ph-arrow-right" style="color:var(--cor-texto-mutado)"></i> <span style="text-decoration: underline; text-decoration-color: var(--cor-primaria); text-decoration-thickness: 2px;">${h.to}</span> ${actionBadge}</div>${obsHtml}</div>`;
                });
            } document.getElementById('historyModal').style.display = 'flex';
        }
        function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }

        // ==============================================================
        // LÃƒâ€œGICA DE SLA DA FÁBRICA E BACKTRACKING BLINDADO
        // ==============================================================
        function renderRanking() { 
            const rankingGrid = document.getElementById('ranking-grid'); 
            const activeGrid = document.getElementById('active-projects-grid'); 
            const distDiv = document.getElementById('designer-distribution'); 
            const returnsList = document.getElementById('production-returns-list');
            const delaysList = document.getElementById('production-delays-list');
            const returnOrdersList = document.getElementById('production-orders-list');
            const funnelGrid = document.getElementById('micro-funnel-grid');

            if (!rankingGrid) return;

            const stats = {}; 
            const activeProjectsList = []; 
            const extensionStats = { byReason: {} };
            const returnStats = { byReason: {}, byOperator: {}, byOrder: {} };
            
            const myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name)); 
            if(myStages.length === 0) myStages.push('produção');

            let totalFilaMins = 0; let countFila = 0;
            let totalProdMins = 0; let countProd = 0;
            let completedDates = [];

            function normalizarNome(nome) {
                if(!nome || String(nome).trim().toLowerCase() === 'sistema') return producaoTeam[0] || 'Anderson';
                const n = String(nome).trim();
                return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
            }

            function normalizarBusca(val) {
                return String(val || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            }

            function isLogDaProdução(h) {
                const action = normalizarBusca(h.action);
                const to = getSafeStatus(h.to);
                const user = normalizarBusca(h.user);
                const team = producaoTeam.map(normalizarBusca);
                return myStages.includes(to) ||
                       action.includes('produc') ||
                       team.includes(user);
            }

            function isLogRetornoProdução(h) {
                const action = normalizarBusca(h.action);
                const obs = normalizarBusca(h.obs);
                const texto = `${action} ${obs}`;
                const ehRetornoFeitoPelaProdução = action.includes('retorno') && action.includes('produc');
                const ehReprovacaoFeitaPelaProdução = action.includes('reprov') && action.includes('produc');
                const obsIndicaProduçãoRetornou = texto.includes('produção reprovou') || texto.includes('produção retornou');
                return ehRetornoFeitoPelaProdução || ehReprovacaoFeitaPelaProdução || obsIndicaProduçãoRetornou;
            }
            function extrairMotivoRetorno(h) {
                const obs = String(h.obs || '').trim();
                const match = obs.match(/\[Motivo:\s*([^\]]+)\]/i) || obs.match(/Motivo:\s*([^.]+)/i);
                if (match && match[1]) return match[1].trim();
                if (obs) return obs.replace(/\[Motivo:/i, 'Motivo:').replace(/\]/g, '').split('\n')[0].trim();
                return String(h.action || '').trim() || 'Motivo nao informado';
            }

            const mainUser = normalizarNome(producaoTeam.length > 0 ? producaoTeam[0] : 'Anderson');
            stats[mainUser] = { count: 0, totalMins: 0 };

            ordersData.forEach(o => { 
                const logs = o.history || [];

                const logsAtraso = logs.filter(h => (h.action === 'Prazo Estendido' || h.action === 'Justificativa Registrada') && isLogDaProdução(h));
                logsAtraso.forEach(log => {
                    const match = String(log.obs).match(/Motivo:\s*([^.]+)/i);
                    const reason = match && match[1] ? match[1].trim() : 'Problema de Maquina / Insumo';
                    extensionStats.byReason[reason] = (extensionStats.byReason[reason] || 0) + 1;
                });

                logs.filter(isLogRetornoProdução).forEach(log => {
                    const reason = extrairMotivoRetorno(log);
                    const operator = normalizarNome(log.user);
                    returnStats.byReason[reason] = (returnStats.byReason[reason] || 0) + 1;
                    returnStats.byOperator[operator] = (returnStats.byOperator[operator] || 0) + 1;
                    if (!returnStats.byOrder[o.id]) returnStats.byOrder[o.id] = { count: 0, client: o.client || 'N/D' };
                    returnStats.byOrder[o.id].count++;
                });

                const entryLog = logs.find(h => myStages.includes(getSafeStatus(h.to)));
                if (!entryLog) return; 

                let entryTime = new Date(entryLog.date);
                if (isNaN(entryTime.getTime())) return;

                const isActive = myStages.includes(getSafeStatus(o.status));

                const assumeLog = [...logs].reverse().find(h => {
                    const act = String(h.action || '').toLowerCase();
                    const isProdStage = myStages.includes(getSafeStatus(h.from)) || myStages.includes(getSafeStatus(h.to));
                    return isProdStage && (act.includes('iniciad') || act.includes('início') || act.includes('inicio'));
                });
                
                let assumeTime = null;
                let workerName = mainUser; 
                
                if (assumeLog && !isNaN(new Date(assumeLog.date).getTime())) {
                    assumeTime = new Date(assumeLog.date);
                    if(assumeLog.user && String(assumeLog.user).toLowerCase() !== 'sistema') {
                        workerName = normalizarNome(assumeLog.user);
                    }
                    if (assumeTime >= entryTime) {
                        const filaMins = (assumeTime - entryTime) / 60000;
                        if (filaMins >= 0 && filaMins < 43200) { totalFilaMins += filaMins; countFila++; }
                    }
                } else if (isActive) {
                    const filaMins = (new Date() - entryTime) / 60000;
                    if (filaMins >= 0 && filaMins < 43200) { totalFilaMins += filaMins; countFila++; }
                }

                const exitLog = [...logs].reverse().find(h => {
                    const hDate = new Date(h.date);
                    if (hDate < entryTime) return false;
                    const act = String(h.action || '').toLowerCase();
                    const toStatus = getSafeStatus(h.to);
                    if (act.includes('produção finalizada') || act.includes('pronto') || act.includes('expediÃƒÂ§ÃƒÂ£o')) return true;
                    if (toStatus !== '' && !myStages.includes(toStatus) && !act.includes('retorno') && !act.includes('reprov')) return true;
                    return false;
                });

                if (isActive) {
                    if (assumeTime) {
                        const minsInProd = (new Date() - assumeTime) / 60000;
                        activeProjectsList.push({ id: o.id, client: o.client, timeMins: minsInProd, user: workerName });
                    }
                } else {
                    if (exitLog) {
                        const exitTime = new Date(exitLog.date);
                        completedDates.push(exitTime);

                        if (assumeTime && exitTime >= assumeTime) {
                            const prodMins = (exitTime - assumeTime) / 60000;
                            if (prodMins >= 0 && prodMins < 43200) { totalProdMins += prodMins; countProd++; }
                        } else if (!assumeTime && exitTime >= entryTime) {
                            const prodMins = (exitTime - entryTime) / 60000;
                            if (prodMins >= 0 && prodMins < 43200) { totalProdMins += prodMins; countProd++; }
                        }

                        if (!stats[workerName]) stats[workerName] = { count: 0, totalMins: 0 };
                        
                        stats[workerName].count++;
                        const fullTime = (exitTime - entryTime) / 60000;
                        if (fullTime >= 0 && fullTime < 43200) stats[workerName].totalMins += fullTime;
                    }
                }
            });

            let mediaPorDia = 0;
            let mediaPorMes = 0;
            if (completedDates.length > 0) {
                completedDates.sort((a,b) => a - b);
                const firstDate = completedDates[0];
                const lastDate = completedDates[completedDates.length - 1];
                let diffDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
                if (diffDays < 1) diffDays = 1; 
                
                mediaPorDia = completedDates.length / diffDays;
                mediaPorMes = mediaPorDia * 30;
            }

            if (funnelGrid) {
                function formatCompactFunnel(mins) {
                    if (!mins || mins < 1) return '0m';
                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                    return `${Math.round(mins)}m`;
                }

                const avgFila = countFila > 0 ? (totalFilaMins / countFila) : 0;
                const avgProd = countProd > 0 ? (totalProdMins / countProd) : 0;

                funnelGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(250px, 1fr))";
                funnelGrid.innerHTML = `
                <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:15px; box-shadow:var(--sombra-sm); border-top: 4px solid var(--cor-texto-mutado);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">Tempo na Fila</div>
                        <div style="background:var(--cor-panel-bg); color:var(--cor-texto-mutado); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ph-clock"></i></div>
                    </div>
                    <div style="font-size:1.5rem; font-weight:800; color:var(--cor-texto);">${formatCompactFunnel(avgFila)}</div>
                    <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase; margin-top:4px;">Média aguardando entrada</div>
                </div>
                <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:15px; box-shadow:var(--sombra-sm); border-top: 4px solid var(--cor-primaria);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">Tempo de Execução</div>
                        <div style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ph-hammer"></i></div>
                    </div>
                    <div style="font-size:1.5rem; font-weight:800; color:var(--cor-texto);">${formatCompactFunnel(avgProd)}</div>
                    <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase; margin-top:4px;">Média em execução</div>
                </div>
                <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:15px; box-shadow:var(--sombra-sm); border-top: 4px solid var(--cor-sucesso);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">Entregas finalizadas</div>
                        <div style="background:#D1FAE5; color:var(--cor-sucesso); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ph-check-circle"></i></div>
                    </div>
                    <div style="display:flex; gap: 20px;">
                        <div>
                            <div style="font-size:1.3rem; font-weight:800; color:var(--cor-texto);">${mediaPorDia.toFixed(1)}</div>
                            <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Por Dia</div>
                        </div>
                        <div>
                            <div style="font-size:1.3rem; font-weight:800; color:var(--cor-texto);">${mediaPorMes.toFixed(0)}</div>
                            <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Por Mês</div>
                        </div>
                    </div>
                </div>`;
            }

            let distHTML = ''; 
            for (const [name, d] of Object.entries(stats)) {
                if (d.count > 0 || name === mainUser) {
                    distHTML += `<span class="designer-pill" style="border-color:var(--cor-primaria);">${name} <span class="designer-count" style="background:var(--cor-primaria);">${d.count}</span></span>`; 
                }
            }
            if (distDiv) distDiv.innerHTML = distHTML; 

            activeGrid.innerHTML = ''; 
            if(activeProjectsList.length === 0) { 
                activeGrid.innerHTML = `
                    <div class="production-empty-state">
                        <i class="ph-fill ph-check-circle"></i>
                        <strong>Nenhum item em produção agora</strong>
                        <span>A produção em tempo real aparecerá aqui quando algum operador assumir um pedido.</span>
                    </div>
                `; 
            } else { 
                function formatCompactBreakdown(mins) {
                    if (!mins || mins < 1) return '0m';
                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                    return `${Math.round(mins)}m`;
                }

                const sortedActive = activeProjectsList.sort((a, b) => b.timeMins - a.timeMins);

                activeGrid.innerHTML = sortedActive.map(p => {
                    const tTotal = formatCompactBreakdown(p.timeMins);
                    const safeClient = String(p.client || 'Cliente não informado').substring(0, 48);

                    return `
                        <div class="production-live-row">
                            <div class="production-live-id">
                                <span>#${p.id}</span>
                                <small>Pedido</small>
                            </div>

                            <div class="production-live-main">
                                <strong>${safeClient}</strong>
                                <span>Operador/Bancada: ${p.user}</span>
                            </div>

                            <div class="production-live-time">
                                <i class="ph-fill ph-clock"></i>
                                <div>
                                    <strong>${tTotal}</strong>
                                    <span>em produção</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            } 

            if (rankingGrid) {
                rankingGrid.innerHTML = ''; 
                const sorted = Object.keys(stats).sort((a,b) => stats[b].count - stats[a].count); 
                
                const champion = sorted[0]; 
                sorted.forEach((user, index) => { 
                    const data = stats[user]; 
                    if(data.count === 0) return;

                    const avgMins = data.count > 0 ? (data.totalMins / data.count) : 0; 
                    
                    let avgStr = '';
                    if (avgMins >= 1440) {
                        avgStr = `${(avgMins / 1440).toFixed(1)} dias`;
                    } else if (avgMins >= 60) {
                        avgStr = `${(avgMins / 60).toFixed(1)} h`;
                    } else {
                        avgStr = `${Math.round(avgMins)} min`;
                    }

                    const level = Math.floor(data.count/5)+1; 
                    const progress = ((data.count%5)/5)*100; 
                    const rank = index + 1;
                    const rankMeta = {
                        1: { cls: 'rank-1', icon: 'ph-fill ph-trophy', label: '1º lugar', short: 'TOP 1' },
                        2: { cls: 'rank-2', icon: 'ph-fill ph-medal', label: '2º lugar', short: 'TOP 2' },
                        3: { cls: 'rank-3', icon: 'ph-fill ph-award', label: '3º lugar', short: 'TOP 3' }
                    }[rank] || { cls: 'rank-3', icon: 'ph-fill ph-award', label: `${rank}º lugar`, short: `TOP ${rank}` };
                    
                    rankingGrid.innerHTML += `
                    <div class="gamer-card fame-card ${user === champion ? 'is-champion' : ''}">
                        <div class="gamer-header">
                            <div class="avatar-circle">${user.charAt(0).toUpperCase()}</div>
                            <div class="fame-user-name">${user}</div>
                            <div class="fame-level">NÍVEL ${level}</div>
                            <div class="gamer-rank-badge ${rankMeta.cls}" title="${rankMeta.label}">
                                <i class="${rankMeta.icon}"></i>
                                <div class="gamer-rank-meta">
                                    <strong>${rankMeta.label}</strong>
                                    <span>${rankMeta.short}</span>
                                </div>
                            </div>
                        </div>
                        <div class="gamer-body">
                            <div class="stat-row"><span>Itens Concluídos</span><span>${data.count}</span></div>
                            <div class="stat-row"><span>SLA (Fila + Execução)</span><span>${avgStr}</span></div>
                            <div class="xp-bar-container"><div class="xp-bar-fill" style="width:${progress}%"></div></div>
                        </div>
                    </div>`; 
                }); 
            }

            const sortedRetornos = Object.entries(returnStats.byReason).sort((a,b) => b[1] - a[1]);
            const sortedOperadoresRetorno = Object.entries(returnStats.byOperator).sort((a,b) => b[1] - a[1]);
            const sortedPedidosRetorno = Object.entries(returnStats.byOrder).sort((a,b) => b[1].count - a[1].count);
            const sortedMotivosAtraso = Object.entries(extensionStats.byReason).sort((a,b) => b[1] - a[1]);

            const emptyHTML = (text) => `<div style="color:var(--cor-texto-mutado); font-size:0.95rem; font-weight:600; padding:10px 0; display:flex; align-items:center; gap:8px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem; color:var(--cor-sucesso);"></i> ${text}</div>`;
            const metricRow = (name, count, label, tone) => `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-bottom:1px dashed var(--cor-borda); font-size:0.9rem;">
                    <span style="color:var(--cor-texto); font-weight:600; line-height:1.3;">${name}</span>
                    <span style="background:var(${tone === 'danger' ? '--danger-bg' : '--warning-bg'}); color:var(${tone === 'danger' ? '--cor-erro' : '--cor-alerta'}); padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.8rem; white-space:nowrap;">${count} ${label}</span>
                </div>`;

            if (returnsList) {
                let html = sortedRetornos.length
                    ? sortedRetornos.map(m => metricRow(m[0], m[1], 'retornos', 'danger')).join('')
                    : emptyHTML('Nenhum retorno da produção reportado.');

                if (sortedOperadoresRetorno.length > 0) {
                    html += '<div style="font-size:0.78rem; font-weight:800; color:var(--cor-texto-mutado); text-transform:uppercase; margin:14px 0 2px;">Por operador/maquina</div>';
                    html += sortedOperadoresRetorno.map(m => metricRow(m[0], m[1], 'vezes', 'danger')).join('');
                }
                returnsList.innerHTML = html;
            }

            if (delaysList) {
                delaysList.innerHTML = sortedMotivosAtraso.length
                    ? sortedMotivosAtraso.map(m => metricRow(m[0], m[1], 'ocorrências', 'warning')).join('')
                    : emptyHTML('Nenhum atraso da produção reportado.');
            }

            if (returnOrdersList) {
                returnOrdersList.innerHTML = sortedPedidosRetorno.length
                    ? sortedPedidosRetorno.slice(0, 6).map(m => metricRow(`#${m[0]} - ${String(m[1].client).substring(0, 28)}`, m[1].count, 'retornos', 'danger')).join('')
                    : emptyHTML('Nenhum pedido reincidente na produção.');
            }
        }

        function toggleTheme() { const b=document.body; const c=b.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; b.setAttribute('data-theme',n); localStorage.setItem('theme',n); updateThemeIcon(n); }
        function loadTheme() { const t=localStorage.getItem('theme')||'light'; document.body.setAttribute('data-theme',t); updateThemeIcon(t); }
        function updateThemeIcon(t) { const i=document.getElementById('theme-icon'); const txt = document.getElementById('theme-text'); if(t==='dark'){i.className='ph-fill ph-sun';txt.innerText='Modo Claro';}else{i.className='ph-fill ph-moon';txt.innerText='Modo Escuro';} }

        function verificarLockdownAtrasos() {
        // 1. Pega as etapas do setor atual (MY_ROLE)
        const myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name));
        
        // Se por acaso a variÃƒÂ¡vel nÃƒÂ£o existir, ignora (evita quebrar a tela)
        if (!myStages || myStages.length === 0) return;

        // 2. Filtra os pedidos que estÃƒÂ£o NO SEU SETOR
        let myOrders = ordersData.filter(o => myStages.includes(getStatusRealPedido(o)));

        // 3. Descobre quais estÃƒÂ£o "late" (Atrasados)
        let lateOrders = myOrders.filter(o => {
            let slaInfo = { status: 'normal' };
            try { 
                // Pega a funÃƒÂ§ÃƒÂ£o de SLA que vocÃƒÂª jÃƒÂ¡ tem
                slaInfo = SinalizaCore.calculateSLA(o, o.layoutData?.extensions || []) || slaInfo; 
            } catch(e){}
            return slaInfo.status === 'late';
        });

        const lockdownModal = document.getElementById('lockdownModal');
        const lockdownList = document.getElementById('lockdown-list');

        // 4. Se tiver atrasos, levanta a Cortina de Ferro!
        if (lateOrders.length > 0) {
            let html = '';
            lateOrders.forEach(o => {
                let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : 'N/D';
                html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding: 15px; border-bottom: 1px dashed var(--cor-borda); background: var(--cor-card-bg); margin-bottom: 8px; border-radius: 8px; border-left: 4px solid var(--cor-erro);">
                    <div>
                        <div style="font-weight: 800; font-size: 1.1rem; color: var(--cor-texto);">#${o.id}</div>
                        <div style="font-size: 0.85rem; color: var(--cor-texto-mutado); margin-top: 2px;">${safeClient.substring(0, 35)}</div>
                    </div>
                    <div>
                        <button class="btn btn-warning" style="box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);" onclick="openPrazoModal('${o.id}')">
                            <i class="ph-bold ph-calendar-plus"></i> Justificar Prazo
                        </button>
                    </div>
                </div>`;
            });

            lockdownList.innerHTML = html;
            lockdownModal.style.display = 'flex'; // Tranca a tela
        } else {
            // Se zerou os atrasos, abaixa a cortina
            lockdownModal.style.display = 'none'; 
        }
    }
