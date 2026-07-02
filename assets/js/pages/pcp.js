        const API_URL = '/api';
        const MY_ROLE = 'pcp';

        let ordersData = [];
        let configData = { workflow: [], movementReasons: {} };
        let pcpTeam = []; 
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

        function logout() { localStorage.removeItem('sinaliza_sessao'); window.location.href = 'index.html'; }

        // --- FUNÇÕES DA BARRA DE BUSCA ---
        function toggleClearBtn() {
            const input = document.getElementById('search-input');
            const btn = document.getElementById('clear-search-btn');
            if (input && btn) {
                btn.style.display = input.value.length > 0 ? 'block' : 'none';
            }
        }

        function clearSearch() {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = '';
                toggleClearBtn();
                renderOrders(); 
            }
        }

        function scrollToTop() {
            const mainContent = document.getElementById('main-content');
            if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        async function apiFetch(endpoint, method = 'GET', body = null) {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            const res = await fetch(`${API_URL}${endpoint}`, options);
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || err.message || `Erro HTTP: ${res.status}`); }
            return res.json();
        }

        function safeParse(val) { if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return val; } } return val; }
        function getSafeStatus(val) { return String(val || '').trim().toLowerCase(); }

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
                issue_date: dbOrder.DATA_EMISSAO || dbOrder.issue_date,
                history: safeParse(dbOrder.HISTORY || dbOrder.history) || [],
                created_at: dbOrder.DATA_EMISSAO || dbOrder.created_at, 
                tipo_pedido: dbOrder.TIPO_PEDIDO || dbOrder.tipo_pedido
            };
        }

        function getDesignerStatus(o) {
            const logs = [...(o.history || [])].reverse();
            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                const obs = String(h.obs || '').toLowerCase();
                if (act.includes('finalizad') || act.includes('iniciad') || act.includes('início') || act.includes('inicio') || obs.includes('assumido')) {
                    return { user: h.user };
                }
            }
            return { user: 'Não Identificado' };
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
                pcpTeam = [...new Set(dbUsers.filter(Boolean))];
            } catch(e) { 
                pcpTeam = []; 
            }
            // Força a inclusão do Breno caso não venha da API
            if (!pcpTeam.some(u => u.toLowerCase() === 'breno')) {
                pcpTeam.push('Breno');
            }
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

                    // O GATILHO DA CORTINA DE FERRO
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
            for (let m of modals) {
                if (m.style.display === 'flex' || window.getComputedStyle(m).display === 'flex') return true;
            }
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

                        // O GATILHO DA CORTINA DE FERRO EM SEGUNDO PLANO
                        verificarLockdownAtrasos();
                    }
                } 
            } catch(e) {
                console.error("Falha ao atualizar em segundo plano", e);
            }
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
                document.getElementById('page-subtitle').innerText = "Métricas operacionais, liberações e reprovações do PCP.";
                renderRanking();
            } else {
                if(viewDash) viewDash.classList.remove('hidden'); 
                if(tab === 'returns') {
                    document.getElementById('page-title').innerText = "Fila de Retornos de Produção";
                    document.getElementById('page-subtitle').innerText = "Projetos que foram barrados na fábrica e precisam de ajuste urgente.";
                } else {
                    document.getElementById('page-title').innerText = "Fila de Revisão";
                    document.getElementById('page-subtitle').innerText = "Validação técnica, conferência de ficheiros e liberação para a fábrica.";
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
            const searchTerm = document.getElementById('search-input').value.toLowerCase();
            const sortValue = document.getElementById('sort-select').value;
            const typeFilter = document.getElementById('filter-type').value; 
            
            const myStages = configData.workflow.filter(s => getSafeStatus(s.role) === MY_ROLE).map(s => getSafeStatus(s.name));
            let myOrders = ordersData.filter(o => myStages.includes(getSafeStatus(o.status)));

            const returnedOrders = myOrders.filter(o => isRetorno(o));
            const normalOrders = myOrders.filter(o => !isRetorno(o));

            const badge = document.getElementById('badge-returns');
            if(returnedOrders.length > 0) {
                badge.innerText = returnedOrders.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
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

            kpiContainer.innerHTML = `
                <div class="kpi-card" onclick="switchTab('dash')" style="${currentTab==='dash'?'border-color:var(--cor-primaria)':''}">
                    <div style="display:flex; align-items:center; gap:15px;">
                        <div class="kpi-icon" style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria);"><i class="ph-fill ph-check-square-offset"></i></div>
                        <div><span class="kpi-label">Fila Normal (Novos)</span><div class="kpi-val">${normalOrders.length}</div></div>
                    </div>
                </div>
                <div class="kpi-card" onclick="switchTab('returns')" style="${currentTab==='returns'?'border-color:var(--cor-erro)':''}">
                    <div style="display:flex; align-items:center; gap:15px;">
                        <div class="kpi-icon" style="background:var(--danger-bg); color:var(--cor-erro);"><i class="ph-fill ph-warning-octagon"></i></div>
                        <div><span class="kpi-label">Retornos Pendentes</span><div class="kpi-val" style="color:var(--cor-erro)">${returnedOrders.length}</div></div>
                    </div>
                </div>
            `;

            if(activeOrders.length === 0) { 
                if (currentTab === 'returns') {
                    container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Sem Retornos!</strong><br><span style="font-size:0.9rem;">Tudo certo com a produção no momento.</span></div>'; 
                } else {
                    container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Fila Limpa!</strong><br><span style="font-size:0.9rem;">Todos os pedidos novos foram validados.</span></div>'; 
                }
                return; 
            }

            activeOrders.sort((a,b) => {
                let sA = { dateStr: '9999-12-31' }, sB = { dateStr: '9999-12-31' };
                try { sA = SinalizaCore.calculateSLA(a) || sA; } catch(e){}
                try { sB = SinalizaCore.calculateSLA(b) || sB; } catch(e){}

                if (sortValue === 'recent') return new Date(b.created_at) - new Date(a.created_at);
                else if (sortValue === 'late') return new Date(sA.dateStr) - new Date(sB.dateStr);
                else return new Date(a.created_at) - new Date(b.created_at); 
            });

            container.innerHTML = activeOrders.map(o => createRowHTML(o, currentTab === 'returns')).join('');
        }

        function createRowHTML(o, ehRetorno = false) {
            const stepsSafe = configData.workflow.map(x => getSafeStatus(x.name)); 
            const oStatusSafe = getSafeStatus(o.status);
            let idx = stepsSafe.indexOf(oStatusSafe); if(idx === -1) idx = 0; 
            
            let slaInfo = { status: 'normal', displayDate: 'N/D', dateStr: '9999-12-31' };
            try { slaInfo = SinalizaCore.calculateSLA(o) || slaInfo; } catch(e){}
            const isLate = slaInfo.status === 'late';
            
            const designerInfo = getDesignerStatus(o);

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
                else if (realIdx === idx) { cls = isLate ? 'active late' : 'active'; } 
                const hasLine = i < displaySteps.length - 1;
                
                return `<div class="stepper-item ${cls}"><span class="stepper-date">${stepDate}</span><div class="stepper-circle">${ico}</div><span class="stepper-label">${String(stepName).substring(0, 15)}</span>${hasLine ? '<div class="stepper-line"></div>' : ''}</div>`; 
            }).join('');

            let rowClass = "list-row";
            if(isLate) rowClass += " late";
            if(ehRetorno) rowClass += " is-retorno";

            let prevStep = null; let nextStep = null;
            try { prevStep = SinalizaCore.getPrevStep(o.status, configData.workflow); nextStep = SinalizaCore.getNextStep(o.status, configData.workflow); } catch(e){}

            let btnReturn = prevStep && configData.workflow[idx] && configData.workflow[idx].canReturn ? `<button class="btn btn-danger" style="height:36px; border-radius:6px; padding:0 14px;" onclick="event.stopPropagation(); openActionModal('${o.id}', '${prevStep}', 'back')" title="Devolver Pedido"><i class="ph-bold ph-arrow-u-up-left"></i> Retornar</button>` : '';
            let mainAction = nextStep ? `<button class="btn btn-success" style="height:36px; border-radius:6px; padding:0 14px;" onclick="event.stopPropagation(); openActionModal('${o.id}', '${nextStep}', 'next')"><i class="ph-bold ph-check"></i> Liberar Produção</button>` : '';

            // BOTÃO DE JUSTIFICAR (Aparece se estiver atrasado)
            let btnPrazo = isLate ? `<button class="btn btn-warning btn-icon-only" style="height:36px; width:36px; border-radius:6px;" onclick="event.stopPropagation(); openPrazoModal('${o.id}')" title="Justificar Atraso ou Pedir Prazo"><i class="ph-bold ph-calendar-plus" style="font-size:1.1rem;"></i></button>` : '';

            let tipo = getTipoPedido(o);
            let tagPrioridade = '';
            if (tipo === 'urgente') {
                tagPrioridade = `<div class="tag-urgente"><i class="ph-fill ph-fire"></i> URGENTE</div>`;
            } else if (tipo === 'homologado') {
                tagPrioridade = `<div class="tag-homologado"><i class="ph-fill ph-star"></i> HOMOL</div>`;
            } else if (tipo === 'projeto') {
                tagPrioridade = `<div class="tag-projeto"><i class="ph-fill ph-blueprint"></i> PROJ</div>`;
            } else {
                tagPrioridade = `<div class="tag-normal"><i class="ph-fill ph-package"></i> NORMAL</div>`;
            }

            let tagRetornoBadge = ehRetorno ? `<div class="tag-retorno"><i class="ph-fill ph-warning-octagon"></i> RETORNO DA PRODUÇÃO</div>` : '';

            let obsComercial = ''; let obsLayout = ''; let obsProducao = '';
            if(o.obs) { obsComercial = `<div class="obs-comercial"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-briefcase"></i> Briefing Comercial</div>${o.obs.replace(/\n/g, '<br>')}</div>`; }
            
            if(Array.isArray(o.history)) {
                const layoutHist = [...o.history].reverse().find(h => h.action.includes('Layout Finalizado') || h.action.includes('Arte Finalizada') || h.action.includes('Projeto Finalizado'));
                if(layoutHist && layoutHist.obs) {
                    obsLayout = `<div class="obs-layout"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-paint-brush"></i> Notas do Designer (${designerInfo.user})</div>${layoutHist.obs.replace(/\n/g, '<br>')}</div>`;
                }

                const prodHist = [...o.history].reverse().find(h => h.action.includes('Reprovação') || (h.action.includes('Retorno') && String(h.to).includes('PCP')));
                if(prodHist && prodHist.obs) {
                    obsProducao = `<div class="obs-producao"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-warning-octagon"></i> Motivo da Reprovação (${prodHist.user})</div>${prodHist.obs.replace(/\n/g, '<br>')}</div>`;
                }
            }

            let blocoInteligenteObs = obsProducao + obsLayout + obsComercial;
            if(!blocoInteligenteObs) blocoInteligenteObs = '<div style="color:var(--cor-texto-mutado); font-style:italic; text-align:center; padding:20px;">Nenhuma observação técnica registrada nas etapas anteriores.</div>';

            let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : '';

            return `
            <div class="${rowClass}" id="row-${o.id}">
                <div class="row-header" onclick="toggleCard('${o.id}')">
                    
                    <div class="col-id">
                        <div class="row-id ${isLate ? 'late-id' : ''}">#${o.id}</div>
                        ${tagRetornoBadge} ${tagPrioridade}
                    </div>
                    
                    <div class="col-client">
                        <div class="row-client" title="${safeClient}">${safeClient || 'N/D'}</div>
                        <div class="info-praz"><i class="ph-bold ph-calendar-blank"></i> Praz: <strong>${slaInfo.displayDate}</strong></div>
                    </div>
                    
                    <div class="col-stepper">
                        <span class="info-status status-waiting"><i class="ph-fill ph-paint-brush"></i> Layout por: ${designerInfo.user}</span>
                        <div class="stepper-wrapper">${stepperHTML}</div>
                    </div>
                    
                    <div class="col-actions">
                        <div class="action-buttons">${btnPrazo} ${btnReturn} ${mainAction}</div>
                        <div class="btn-detalhes">Validar Informações <i class="ph-bold ph-caret-down"></i></div>
                    </div>

                </div>
                
                <div class="card-details" onclick="event.stopPropagation()">
                    <div style="display:grid; grid-template-columns: 1.5fr 1fr; gap:20px; margin-bottom:15px;">
                        <div class="obs-block">
                            <div style="font-size:0.8rem; font-weight:700; color:var(--cor-texto); text-transform:uppercase; margin-bottom:15px; border-bottom:1px solid var(--cor-borda); padding-bottom:8px;"><i class="ph-fill ph-list-checks"></i> Observações Técnicas das Etapas</div>
                            ${blocoInteligenteObs}
                        </div>
                        <div style="display: flex; flex-direction: column; justify-content: center; gap: 15px;">
                            <button class="btn btn-secondary" style="width: 100%; height: 50px; font-size: 0.95rem;" onclick="openFilesModal('${o.id}')">
                                <i class="ph-fill ph-folder-open" style="font-size:1.3rem; color:var(--cor-primaria);"></i> Ver Ficheiros de Layout (VPN)
                            </button>
                            <button class="btn btn-secondary" style="width: 100%; height: 50px; font-size: 0.95rem;" onclick="openHistoryModal('${o.id}')">
                                <i class="ph-fill ph-clock-counter-clockwise" style="font-size:1.3rem; color:var(--cor-texto);"></i> Ver Auditoria Completa
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        // =========================================================================
        // FUNÇÕES DO MODAL DE JUSTIFICATIVA (O QUE ESTAVA FALTANDO!)
        // =========================================================================
        function openPrazoModal(id) {
            document.getElementById('prazo-id').value = id;
            document.getElementById('prazo-dias').value = '1';
            document.getElementById('prazo-motivo').selectedIndex = 0;
            document.getElementById('prazo-detalhes').value = '';
            document.getElementById('prazoModal').style.display = 'flex';
        }

        async function confirmPrazo() {
            const id = document.getElementById('prazo-id').value;
            const dias = parseInt(document.getElementById('prazo-dias').value);
            const motivo = document.getElementById('prazo-motivo').value;
            const detalhes = document.getElementById('prazo-detalhes').value;
            const o = ordersData.find(x => x.id == id); if(!o) return;

            if (motivo === 'Outros' && detalhes.trim() === '') {
                return Swal.fire('Atenção', 'Por favor, descreva o motivo da justificativa nos detalhes.', 'warning');
            }

            const nomeOperador = currentUser || 'PCP';
            const actionName = dias > 0 ? 'Prazo Estendido' : 'Justificativa Registrada';
            const obsMsg = dias > 0 
                ? `Solicitado +${dias} dia(s). Motivo: ${motivo}.${detalhes ? ' Detalhes: ' + detalhes : ''}`
                : `Motivo: ${motivo}.${detalhes ? ' Detalhes: ' + detalhes : ''}`;

            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry(actionName, o.status, nomeOperador, '', obsMsg)];
            
            let updatePayload = { history: newHistory };

            if (dias > 0) {
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
                updatePayload.data_entrega = `${nAno}-${nMes}-${nDia}`;
            }

            const btn = document.querySelector('#prazoModal .btn-warning');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Registrando...';
            btn.disabled = true;

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', updatePayload);
                document.getElementById('prazoModal').style.display = 'none';
                
                const swalMsg = dias > 0 ? `Novo prazo estendido para ${updatePayload.data_entrega.split('-').reverse().join('/')}!` : `Justificativa registrada com sucesso!`;
                Swal.fire({toast:true, position:'top-end', icon:'success', title: swalMsg, showConfirmButton:false, timer:4000});
                
                loadData();
            } catch(e) { Swal.fire('Erro Oracle', 'Falha ao registrar: ' + e.message, 'error'); } 
            finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        // =========================================================================
        // A FUNÇÃO DA CORTINA DE FERRO
        // =========================================================================
        function verificarLockdownAtrasos() {
            const myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name));
            if (!myStages || myStages.length === 0) return;

            let myOrders = ordersData.filter(o => myStages.includes(getSafeStatus(o.status)));

            let lateOrders = myOrders.filter(o => {
                let slaInfo = { status: 'normal' };
                try { slaInfo = SinalizaCore.calculateSLA(o) || slaInfo; } catch(e){}
                return slaInfo.status === 'late';
            });

            const lockdownModal = document.getElementById('lockdownModal');
            const lockdownList = document.getElementById('lockdown-list');

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
                lockdownModal.style.display = 'flex'; 
            } else {
                lockdownModal.style.display = 'none'; 
            }
        }

        // =========================================================================

        function openActionModal(id, next, type) { 
            document.getElementById('modal-id').value = id; 
            document.getElementById('modal-new-status').value = next; 
            document.getElementById('modal-move-type').value = type;
            document.getElementById('modal-obs').value = ''; 
            
            const reasonSelect = document.getElementById('modal-reason-select'); reasonSelect.innerHTML = '<option value="">Selecione o motivo da movimentação...</option>';
            let availableReasons = [];
            if (configData.movementReasons && configData.movementReasons[MY_ROLE]) {
                const direction = type === 'next' ? 'forward' : 'backward';
                availableReasons = configData.movementReasons[MY_ROLE][direction] || [];
            }
            if (availableReasons.length === 0) availableReasons = ['Normal / Correção Técnica'];
            availableReasons.forEach(r => { reasonSelect.innerHTML += `<option value="${r}">${r}</option>`; });

            const t = document.getElementById('modal-title'); const d = document.getElementById('modal-desc'); const b = document.getElementById('btn-confirm-action'); 

            if(type === 'next'){
                t.innerHTML='<i class="ph-fill ph-check-circle" style="color:var(--cor-sucesso)"></i> Validação PCP Concluída'; 
                d.innerHTML=`Todos os requisitos técnicos conferem? O pedido será enviado para a <b>${next}</b>.`; 
                b.className='btn btn-success'; b.innerHTML = '<i class="ph-bold ph-check"></i> Confirmar Liberação';
            } else {
                t.innerHTML='<i class="ph-fill ph-arrow-u-up-left" style="color:var(--cor-erro)"></i> Reprovação Técnica (Devolver)'; 
                d.innerHTML=`O pedido será devolvido para <b>${next}</b> para correções. Especifique o problema técnico na observação.`; 
                b.className='btn btn-danger'; b.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> Devolver para Correção';
            } 
            document.getElementById('actionModal').style.display = 'flex'; 
        }

        async function confirmAction() { 
            const id = document.getElementById('modal-id').value; 
            const next = document.getElementById('modal-new-status').value; 
            const type = document.getElementById('modal-move-type').value;
            const reason = document.getElementById('modal-reason-select').value;
            const obsText = document.getElementById('modal-obs').value; 
            
            if (!reason) return Swal.fire("Atenção", "Selecione um motivo na lista.", "warning");
            if (type === 'back' && !obsText.trim()) return Swal.fire("Atenção", "A reprovação técnica exige o preenchimento da observação detalhando a correção necessária.", "warning");

            const btn = document.getElementById('btn-confirm-action'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...'; btn.disabled = true;

            const o = ordersData.find(x => x.id == id); 
            const isReturn = type === 'back'; 
            const nomeOperador = currentUser || 'PCP';
            
            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry(isReturn ? 'Retorno / Reprovação PCP' : 'Liberação PCP', next, nomeOperador, reason, obsText)]; 
            let updatePayload = { status: next, history: newHistory, ...SinalizaCore.gerarTimestamps(o.status, next) };

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', updatePayload);
                document.getElementById('actionModal').style.display='none'; 
                Swal.fire({toast:true, position:'top-end', icon:'success', title:isReturn ? 'Devolvido para Correção' : 'Liberado para Produção!', showConfirmButton:false, timer:3000});
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
            preview.innerHTML = '<div style="color:var(--cor-texto-mutado); display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; font-weight:600;"><i class="ph-fill ph-image" style="font-size:5rem; margin-bottom:20px; opacity:0.2;"></i> Selecione um arquivo para auditar</div>';

            try {
                const arquivosBrutos = await SinalizaCore.fetchFilesFromVPN(id);
                if(!arquivosBrutos || arquivosBrutos.length === 0) { list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--cor-texto-mutado);"><i class="ph-fill ph-empty" style="font-size:3rem; margin-bottom:15px;"></i><br><strong>Pasta física vazia.</strong></div>'; return; }

                list.innerHTML = '';
                arquivosBrutos.forEach(f => {
                    const item = document.createElement('div'); item.className = 'file-item';
                    let icon = 'ph-file';
                    if(f.ext === 'pdf') icon = 'ph-file-pdf'; else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) icon = 'ph-image'; else if(['xls','xlsx','csv'].includes(f.ext)) icon = 'ph-file-xls';
                    const badge = f.folder.toLowerCase().replace(/[\u0300-\u036f]/g, "");
                    
                    item.innerHTML = `<div style="display:flex; align-items:center; gap:8px; overflow:hidden;"><i class="ph-fill ${icon}" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.name}">${f.name}</span></div><span class="file-chip chip-${badge}">${f.folder}</span>`;
                    
                    item.onclick = () => {
                        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active')); item.classList.add('active');
                        const url = `${SinalizaCore.VPN_URL}${f.url}`;
                        preview.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><i class="ph-bold ph-spinner ph-spin" style="font-size:4rem; color:var(--cor-primaria);"></i></div>';
                        setTimeout(() => {
                            if(['pdf','html','txt'].includes(f.ext)) { preview.innerHTML = `<iframe src="${url}" class="preview-iframe"></iframe>`; } 
                            else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) { preview.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; object-fit:contain; border-radius: 12px; box-shadow: var(--sombra-md);">`; } 
                            else { preview.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--cor-texto);"><div style="background:var(--cor-card-bg); padding:40px; border-radius:20px; border:1px solid var(--cor-borda); text-align:center; box-shadow:var(--sombra-sm);"><i class="ph-fill ph-download-simple" style="font-size:4rem; margin-bottom:15px; color:var(--cor-primaria);"></i><p style="margin-bottom:20px; font-weight:700; font-size:1rem;">Pronto para download.</p><a href="${url}" target="_blank" class="btn btn-primary" style="text-decoration:none;">Baixar Arquivo</a></div></div>`; }
                        }, 100);
                    };
                    list.appendChild(item);
                });
            } catch(e) { list.innerHTML = `<div style="padding:40px; text-align:center; color:var(--cor-erro);"><i class="ph-fill ph-warning-circle" style="font-size:3rem; margin-bottom:15px;"></i><br><b>Erro de VPN. O Agente local parece estar offline.</b></div>`; }
        }
        function closeFilesModal() { document.getElementById('filesModal').style.display = 'none'; document.getElementById('preview-container').innerHTML = ''; }

        function openHistoryModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id)); if(!o) return; document.getElementById('hist-order-id').innerText = '#' + id; const container = document.getElementById('history-container'); container.innerHTML = '';
            if (!o.history || o.history.length === 0) { container.innerHTML = '<div style="text-align:center; padding: 60px 20px; color:var(--cor-texto-mutado);"><i class="ph-fill ph-ghost" style="font-size:4rem; margin-bottom:15px; opacity:0.3;"></i><br><strong style="font-size:1rem;">Sem Histórico!</strong></div>'; } 
            else {
                const histRev = [...o.history].reverse();
                histRev.forEach((h, index) => {
                    const dateObj = new Date(h.date); const dateStr = dateObj.toLocaleDateString('pt-BR') + ' às ' + dateObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                    
                    const actionDisplay = String(h.action || '').replace(/arte/gi, 'Layout');
                    let actionBadge = ''; 
                    if(h.action.includes('Iniciad') || h.action.includes('Layout') || h.action.includes('Arte')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${actionDisplay.toUpperCase()}</span>`; }
                    else if(h.action.includes('Admin') || h.action.includes('Bypass') || h.action.includes('Massa')) { actionBadge = `<span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${actionDisplay.toUpperCase()}</span>`; } 
                    else if(h.action.includes('PCP') || h.action.includes('Técnica')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${actionDisplay.toUpperCase()}</span>`; } 
                    else if(h.action.includes('Reprovação') || h.action.includes('Retorno')) { actionBadge = `<span style="background:var(--danger-bg); color:var(--cor-erro); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${actionDisplay.toUpperCase()}</span>`; }
                    else { actionBadge = `<span style="background:#D1FAE5; color:var(--cor-sucesso); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">MOVIMENTAÇÃO</span>`; }
                    
                    let obsHtml = h.obs ? `<div style="font-size: 0.9rem; color: var(--cor-texto); margin-top: 8px; background: var(--cor-panel-bg); padding: 12px; border-radius: 8px; border-left: 3px solid var(--cor-primaria); font-weight: 500;">${h.obs.replace(/\n/g, '<br>')}</div>` : ''; let isCurrent = index === 0 ? `<span style="color:white; font-size:0.65rem; background:var(--cor-primaria); padding:2px 6px; border-radius:4px; margin-left:auto; font-weight:700;">ETAPA ATUAL</span>` : '';
                    container.innerHTML += `<div class="history-item"><div class="history-date"><i class="ph-bold ph-calendar-blank"></i> ${dateStr} ${isCurrent}</div><div class="history-title"><i class="ph-fill ph-user-circle" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="font-weight:700; font-size:0.95rem;">${h.user || 'Sistema'}</span> <i class="ph-bold ph-arrow-right" style="color:var(--cor-texto-mutado)"></i> <span style="text-decoration: underline; text-decoration-color: var(--cor-primaria); text-decoration-thickness: 2px;">${h.to}</span> ${actionBadge}</div>${obsHtml}</div>`;
                });
            } document.getElementById('historyModal').style.display = 'flex';
        }
        function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }

        // ==============================================================
        // 🛡️ LÓGICA BLINDADA COM WHITELIST OBRIGATÓRIA (PCP TEAM)
        // ==============================================================
        function renderRanking() {
            const rankingGrid = document.getElementById('ranking-grid'); 
            const activeGrid = document.getElementById('active-projects-grid'); 
            const distDiv = document.getElementById('designer-distribution'); 
            const motivosList = document.getElementById('motivos-list'); 

            if (!rankingGrid) return; 

            const stats = {}; 
            const activeProjectsList = []; 
            const reprovStats = {}; 
            
            let pcpStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name)); 
            if (pcpStages.length === 0) pcpStages = ['pcp', 'produção técnica', 'revisão'];

            let slaTotalMins = 0;
            let slaCalcCount = 0;

            function normalizarNome(nome) {
                if(!nome) return 'Desconhecido';
                const n = String(nome).trim();
                return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
            }

            // INICIA APENAS A EQUIPE OFICIAL DO PCP (Whitelist)
            pcpTeam.forEach(name => {
                const capName = normalizarNome(name);
                if (capName) {
                    stats[capName] = { count: 0, totalMins: 0 };
                }
            });

            ordersData.forEach(o => { 
                const logs = o.history || [];
                
                // --- RASTREIO DE REPROVAÇÕES (Apenas time oficial) ---
                logs.forEach(h => {
                    const act = String(h.action || '').toLowerCase();
                    if (act.includes('reprov') || act.includes('retorno')) {
                        const hUser = String(h.user || '').trim();
                        // TRAVA DE SEGURANÇA: Só conta se o usuário for do PCP
                        if (pcpTeam.some(u => u.toLowerCase() === hUser.toLowerCase())) {
                            let reason = h.reason;
                            if (!reason && h.obs) {
                                const match = String(h.obs).match(/Motivo:\s*([^.]+)/i);
                                if (match && match[1]) reason = match[1].trim();
                            }
                            reason = reason || 'Correção Técnica (Geral)';
                            reprovStats[reason] = (reprovStats[reason] || 0) + 1;
                        }
                    }
                });
                
                // --- LÓGICA DE SLA DE TEMPO (Apenas para liberações da equipe) ---
                const entryLog = logs.find(h => pcpStages.includes(getSafeStatus(h.to)));
                if (!entryLog) return; 

                let entryTime = new Date(entryLog.date);
                if (isNaN(entryTime.getTime())) return;

                const isActive = pcpStages.includes(getSafeStatus(o.status));

                if (isActive) {
                    const minsInQueue = (new Date() - entryTime) / 60000;
                    activeProjectsList.push({ id: o.id, client: o.client, timeMins: minsInQueue });
                } else {
                    const exitLog = logs.find(h => {
                        const hDate = new Date(h.date);
                        if (hDate < entryTime) return false;
                        
                        const act = String(h.action || '').toLowerCase();
                        const toStatus = getSafeStatus(h.to);

                        if (act.includes('liberação') || act.includes('liberad')) return true;
                        if (toStatus !== '' && !pcpStages.includes(toStatus) && !act.includes('retorno') && !act.includes('reprov')) return true;
                        return false;
                    });

                    if (exitLog) {
                        const opFinalizou = normalizarNome(exitLog.user);
                        
                        // TRAVA DE SEGURANÇA: Só pontua no Hall da Fama se o usuário estiver no time do PCP!
                        if (pcpTeam.some(u => normalizarNome(u) === opFinalizou)) {
                            const exitTime = new Date(exitLog.date);
                            const diffMins = (exitTime - entryTime) / 60000;

                            if (diffMins >= 0 && diffMins < 43200) { 
                                slaTotalMins += diffMins;
                                slaCalcCount++;

                                if (!stats[opFinalizou]) stats[opFinalizou] = { count: 0, totalMins: 0 };
                                stats[opFinalizou].count++;
                                stats[opFinalizou].totalMins += diffMins;
                            }
                        }
                    }
                }
            });

            // RENDER: Funil Único de SLA
            const funnelGrid = document.getElementById('micro-funnel-grid');
            if (funnelGrid) {
                function formatCompactFunnel(mins) {
                    if (!mins || mins < 1) return '0m';
                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                    return `${Math.round(mins)}m`;
                }

                const avgMins = slaCalcCount > 0 ? (slaTotalMins / slaCalcCount) : 0;
                const timeStr = formatCompactFunnel(avgMins);

                funnelGrid.innerHTML = `
                <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:15px; box-shadow:var(--sombra-sm); border-top: 4px solid var(--cor-primaria); max-width: 400px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">SLA Médio de Liberação</div>
                        <div style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ph-magnifying-glass"></i></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                        <div>
                            <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Volume Liberado</div>
                            <div style="font-size:1.5rem; font-weight:800; color:var(--cor-texto); line-height:1;">${slaCalcCount}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Tempo Médio</div>
                            <div style="font-size:1.1rem; font-weight:800; color:var(--cor-primaria); line-height:1.2;">${timeStr}</div>
                        </div>
                    </div>
                </div>`;
            }

            // RENDER: Distribuição (Top pills)
            let distHTML = ''; 
            for (const [name, d] of Object.entries(stats)) {
                distHTML += `<span class="designer-pill" style="border-color:var(--cor-primaria);">${name} <span class="designer-count" style="background:var(--cor-primaria);">${d.count}</span></span>`; 
            }
            if (distDiv) distDiv.innerHTML = distHTML || '<span style="color:var(--cor-texto-mutado); font-size:0.9rem; font-weight:700;">Sem liberações registradas.</span>'; 

            // RENDER: Ativos (Fila única)
            activeGrid.innerHTML = ''; 
            if(activeProjectsList.length === 0) { 
                activeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--cor-texto-mutado); padding:20px; background:var(--cor-card-bg); border-radius:16px; border:1px solid var(--cor-borda); font-weight:700;">Nenhum projeto em validação técnica.</div>'; 
            } else { 
                let listHTML = ''; 
                function formatCompactBreakdown(mins) {
                    if (!mins || mins < 1) return '0m';
                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                    return `${Math.round(mins)}m`;
                }

                activeProjectsList.forEach(p => { 
                    const tTotal = formatCompactBreakdown(p.timeMins);
                    listHTML += `
                    <div style="display:flex; flex-direction:column; border-bottom:1px dashed var(--cor-borda); padding:12px 0;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <div style="font-weight:700; font-size:0.95rem; color:var(--cor-texto);">#${p.id}</div>
                                <div style="font-size:0.8rem; color:var(--cor-texto-mutado); font-weight:500;">${p.client.substring(0,30)}</div>
                            </div>
                            <div style="font-size:0.9rem; font-weight:800; color:var(--cor-primaria); display:flex; align-items:center; gap:5px; background:var(--cor-primaria-soft-bg); padding:4px 8px; border-radius:6px;">
                                <i class="ph-bold ph-clock"></i> Parado há: ${tTotal}
                            </div>
                        </div>
                    </div>`;
                }); 
                
                activeGrid.innerHTML = `
                <div class="gamer-card" style="border-top:4px solid var(--cor-primaria);">
                    <div style="padding:15px 20px; background:var(--cor-primaria-soft-bg); display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--cor-borda);">
                        <div style="font-weight:700; color:var(--cor-primaria); text-transform:uppercase;">Aguardando Equipe</div>
                        <div style="background:var(--cor-primaria); color:white; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;">${activeProjectsList.length} Ativos</div>
                    </div>
                    <div class="gamer-body" style="padding:15px 20px;">${listHTML}</div>
                </div>`; 
            } 

            // RENDER: Hall da Fama
            if (rankingGrid) {
                rankingGrid.innerHTML = ''; 
                const sorted = Object.keys(stats).sort((a,b) => stats[b].count - stats[a].count); 
                
                const champion = sorted[0]; 
                sorted.forEach(user => { 
                    const data = stats[user]; 
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
                    let badges = ''; 
                    if(user === champion && data.count > 0) badges += `<div style="color:var(--cor-alerta); font-size:2rem; text-align:center; margin-top:15px;" title="Inspetor Mestre"><i class="ph-fill ph-trophy"></i></div>`; 
                    
                    rankingGrid.innerHTML += `
                    <div class="gamer-card">
                        <div class="gamer-header">
                            <div class="avatar-circle">${user.charAt(0).toUpperCase()}</div>
                            <div style="font-weight:800; font-size:1.1rem;">${user}</div>
                            <div style="font-size:0.75rem; opacity:0.9; font-weight:600; margin-top:4px;">NÍVEL ${level}</div>
                        </div>
                        <div class="gamer-body">
                            <div class="stat-row"><span style="color:var(--cor-texto-mutado); font-size:0.85rem; font-weight:600;">Liberações Téc.</span><span style="font-weight:700; color:var(--cor-texto); font-size:1rem;">${data.count}</span></div>
                            <div class="stat-row"><span style="color:var(--cor-texto-mutado); font-size:0.85rem; font-weight:600;">Média de SLA</span><span style="font-weight:700; color:var(--cor-texto); font-size:1rem;">${avgStr}</span></div>
                            <div class="xp-bar-container"><div class="xp-bar-fill" style="width:${progress}%"></div></div>
                            ${badges}
                        </div>
                    </div>`; 
                }); 
            }

            // RENDER: Top Motivos de Reprovação
            if (motivosList) {
                const sortedMotivos = Object.entries(reprovStats).sort((a,b) => b[1] - a[1]);
                if(sortedMotivos.length === 0) {
                    motivosList.innerHTML = '<div style="color:var(--cor-sucesso); font-size:0.95rem; font-weight:600; padding:10px 0; display:flex; align-items:center; gap:8px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem;"></i> Nenhuma reprovação registrada no PCP.</div>';
                } else {
                    motivosList.innerHTML = sortedMotivos.map(m => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--cor-borda); font-size:0.9rem;">
                            <span style="color:var(--cor-texto); font-weight:600;">${m[0]}</span>
                            <span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.8rem;">${m[1]} ocorrências</span>
                        </div>
                    `).join('');
                }
            }
        }

        function toggleTheme() { const b=document.body; const c=b.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; b.setAttribute('data-theme',n); localStorage.setItem('theme',n); updateThemeIcon(n); }
        function loadTheme() { const t=localStorage.getItem('theme')||'light'; document.body.setAttribute('data-theme',t); updateThemeIcon(t); }
        function updateThemeIcon(t) { const i=document.getElementById('theme-icon'); const txt = document.getElementById('theme-text'); if(t==='dark'){i.className='ph-fill ph-sun';txt.innerText='Modo Claro';}else{i.className='ph-fill ph-moon';txt.innerText='Modo Escuro';} }
