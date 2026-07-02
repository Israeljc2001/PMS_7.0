        const API_URL = '/api';
        const MY_ROLE = 'layout';

        let ordersData = [];
        let configData = { workflow: [], movementReasons: {} };
        let layoutTeam = []; 
        let currentFilter = 'all';
        let selectedFiles = [];
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


        function syncTopbarSearchToLayout(value) {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = value;
                toggleClearBtn();
                renderOrders();
            }
        }

        function syncLayoutSearchToTopbar(value) {
            const topbarInput = document.getElementById('topbar-search-input');
            if (topbarInput && topbarInput.value !== value) {
                topbarInput.value = value;
            }
        }

        function scrollToTop() {
            const mainContent = document.getElementById('main-content');
            if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        window.onload = async () => {
            loadTheme();
            if(currentUser) {
                const displayUser = currentUser.toUpperCase();
                const pageUser = document.getElementById('layout-page-user');
                if (pageUser) pageUser.innerText = displayUser;
            }
            await loadConfig();
            await loadTeam();
            await loadData();
            updateSidebarScoreboard();
            
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
                tipo_pedido: dbOrder.TIPO_PEDIDO || dbOrder.tipo_pedido,
                layoutData: safeParse(dbOrder.LAYOUT_DATA || dbOrder.layout_data) || null,
                prodData: safeParse(dbOrder.PROD_DATA || dbOrder.prod_data) || null
            };
        }

        function getDesignerStatus(o) {
            let myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name));
            if (myStages.length === 0) myStages = ['layout', 'em layout', 'criação'];

            if (!myStages.includes(getSafeStatus(o.status))) return { isAssumed: false };
            
            const logs = [...(o.history || [])].reverse();
            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                const obs = String(h.obs || '').toLowerCase();
                
                if (act === 'layout iniciado' || act === 'enviado ao cliente' || act === 'cliente reprovou' || act === 'cliente aprovou' || act.includes('projeto finalizado') || act.includes('layout finalizado') || act.includes('iniciad') || act.includes('assumido')) {
                    return { isAssumed: true, user: h.user, time: h.date };
                }
                if (act.includes('transfer')) {
                    const match = obs.match(/passado para (.*?)\./i);
                    return { isAssumed: true, user: match ? match[1].trim() : h.user, time: h.date };
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

        function getLayoutMicroStep(o) {
            const logs = [...(o.history || [])].reverse();
            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                if (act === 'cliente aprovou') return 3; 
                if (act === 'enviado ao cliente') return 2; 
                if (act === 'layout iniciado' || act === 'cliente reprovou' || act.includes('início') || act.includes('inicio')) return 1; 
            }
            const dInfo = getDesignerStatus(o);
            return dInfo.isAssumed ? 1 : 0; 
        }

        async function loadConfig() { 
            try { 
                const wf = await apiFetch('/config/workflow');
                if(wf && wf.dados) { 
                    let wData = wf.dados; 
                    if(typeof wData === 'string') wData = JSON.parse(wData); 
                    configData.workflow = wData.map(w => ({ 
                        name: w.name, 
                        role: w.role || w.sector || w.name, 
                        canReturn: w.canReturn 
                    })); 
                } 
                
                const mr = await apiFetch('/config/motivos');
                if(mr && mr.dados) { let mData = mr.dados; if(typeof mData === 'string') mData = JSON.parse(mData); configData.movementReasons = mData; }
            } catch(e){ console.warn("Usando workflow padrão de segurança."); } 
        }

        async function loadTeam() {
            try {
                const users = await apiFetch('/usuarios');
                let dbUsers = users.filter(u => getSafeStatus(u.ROLE || u.role) === MY_ROLE).map(u => String(u.USERNAME || u.username).trim());
                layoutTeam = dbUsers;
            } catch(e) { 
                layoutTeam = []; 
            }

            // Força a existência dos designers base caso o banco retorne vazio
            const fallbackNames = ['Chrys', 'Lucas', 'Ana'];
            fallbackNames.forEach(nome => {
                if (!layoutTeam.some(u => u.toLowerCase() === nome.toLowerCase())) {
                    layoutTeam.push(nome);
                }
            });

            layoutTeam = layoutTeam.filter(Boolean);
            layoutTeam = [...new Set(layoutTeam)];
            
            const desFilter = document.getElementById('filter-designer');
            if (desFilter) {
                desFilter.innerHTML = '<option value="all">🎨 Todos os Designers</option><option value="unassigned">⏳ Sem Responsável</option>';
                layoutTeam.forEach(name => {
                    // Formata a primeira letra maiúscula
                    const capName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
                    desFilter.innerHTML += `<option value="${capName}">${capName}</option>`;
                });
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
                    updateSidebarScoreboard();
                    if(currentTab !== 'reports') renderOrders();
                    else renderRanking(); 
                    
                    verificarLockdownAtrasos();
                    checkUrgentOrders();
                    
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
                    
                    updateSidebarScoreboard();
                                        if (!isUserInteracting()) {
                        if(currentTab === 'ranking') renderRankingPage();
                        else if(currentTab === 'reports') renderRanking();
                        else renderOrders(); 
                    }
                } 
            } catch(e) {
                console.error("Falha ao atualizar em segundo plano", e);
            }
        }

        function switchTab(tab) { 
            currentTab = tab;
            document.getElementById('view-dash').classList.add('hidden'); document.getElementById('view-reports').classList.add('hidden'); const rankingView = document.getElementById('view-ranking'); if (rankingView) rankingView.classList.add('hidden'); 
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active')); 
            document.getElementById('btn-'+tab).classList.add('active'); 

            if(tab === 'ranking') {
                const rankingView = document.getElementById('view-ranking');
                if (rankingView) rankingView.classList.remove('hidden');
                document.getElementById('page-title').innerText = "Ranking";
                document.getElementById('page-subtitle').innerText = "Pódio, pontuação e regras de classificação do Layout.";
                renderRankingPage();
            } else if(tab === 'reports') {
                document.getElementById('view-reports').classList.remove('hidden'); 
                document.getElementById('page-title').innerText = "Relatórios";
                document.getElementById('page-subtitle').innerText = "Métricas operacionais do setor de Layout.";
                renderRanking();
            } else {
                document.getElementById('view-dash').classList.remove('hidden'); 
                if(tab === 'returns') {
                    document.getElementById('page-title').innerText = "Fila de Retornos";
                    document.getElementById('page-subtitle').innerText = "Projetos devolvidos que exigem correção urgente.";
                } else {
                    document.getElementById('page-title').innerText = "Fila de Criação";
                    document.getElementById('page-subtitle').innerText = "Desenvolvimento e aprovação de layouts.";
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

        // ⏱️ Conversor Mágico para Dias, Horas e Minutos
        function formatTimeHelper(diffMins) {
            if (!diffMins || isNaN(diffMins) || diffMins < 0) return '0 min';
            if (diffMins >= 1440) {
                const dias = Math.floor(diffMins / 1440);
                const horas = Math.floor((diffMins % 1440) / 60);
                return horas > 0 ? `${dias}d ${horas}h` : `${dias} dia${dias > 1 ? 's' : ''}`;
            } else if (diffMins >= 60) {
                const horas = Math.floor(diffMins / 60);
                const mins = Math.floor(diffMins % 60);
                return mins > 0 ? `${horas}h ${mins}m` : `${horas}h`;
            } else {
                return `${Math.round(diffMins)} min`;
            }
        }

        function formatCompact(mins) {
            if (!mins || mins < 1) return '0m';
            if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
            if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
            return `${Math.round(mins)}m`;
        }

        function renderOrders() {
            try {
                const container = document.getElementById('orders-container');
                const kpiContainer = document.getElementById('kpi-container');
                const searchTerm = document.getElementById('search-input').value.toLowerCase();
                const sortValue = document.getElementById('sort-select').value;
                const typeFilter = document.getElementById('filter-type').value; 
                const designerFilter = document.getElementById('filter-designer').value; 
                
                let myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name));
                if (myStages.length === 0) myStages = ['layout', 'em layout', 'criação'];

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

                if (designerFilter !== 'all') {
                    activeOrders = activeOrders.filter(o => {
                        const dInfo = getDesignerStatus(o);
                        if (designerFilter === 'unassigned') return !dInfo.isAssumed;
                        return dInfo.isAssumed && String(dInfo.user).trim().toLowerCase() === String(designerFilter).trim().toLowerCase();
                    });
                }

                if (searchTerm) { activeOrders = activeOrders.filter(o => String(o.id).includes(searchTerm) || (o.client && o.client.toLowerCase().includes(searchTerm))); }

                if (typeFilter !== 'all') {
                    activeOrders = activeOrders.filter(o => {
                        const tp = getTipoPedido(o);
                        if (typeFilter === 'normal') return tp === 'normal' || tp === 'convencional' || tp === '';
                        return tp === typeFilter;
                    });
                }

                const waiting = activeOrders.filter(o => !getDesignerStatus(o).isAssumed).length;
                const inProgress = activeOrders.filter(o => getDesignerStatus(o).isAssumed).length;

                kpiContainer.innerHTML = `
                    <div class="kpi-card kpi-filter-card ${currentFilter==='all'?'is-selected':''}" data-filter="all" onclick="currentFilter='all'; renderOrders()">
                        <div class="kpi-content-line">
                            <div class="kpi-icon"><i class="ph-fill ph-list-dashes"></i></div>
                            <div>
                                <span class="kpi-label">Fila Total (${currentTab==='returns'?'Retornos':'Novos'})</span>
                                <div class="kpi-val">${activeOrders.length}</div>
                            </div>
                        </div>
                    </div>

                    <div class="kpi-card kpi-filter-card ${currentFilter==='waiting'?'is-selected':''}" data-filter="waiting" onclick="currentFilter='waiting'; renderOrders()">
                        <div class="kpi-content-line">
                            <div class="kpi-icon"><i class="ph-fill ph-clock"></i></div>
                            <div>
                                <span class="kpi-label">Aguardando</span>
                                <div class="kpi-val">${waiting}</div>
                            </div>
                        </div>
                    </div>

                    <div class="kpi-card kpi-filter-card ${currentFilter==='progress'?'is-selected':''}" data-filter="progress" onclick="currentFilter='progress'; renderOrders()">
                        <div class="kpi-content-line">
                            <div class="kpi-icon"><i class="ph-fill ph-paint-brush"></i></div>
                            <div>
                                <span class="kpi-label">Em Execução</span>
                                <div class="kpi-val">${inProgress}</div>
                            </div>
                        </div>
                    </div>
                `;

                let filtered = activeOrders;
                if(currentFilter === 'waiting') filtered = activeOrders.filter(o => !getDesignerStatus(o).isAssumed);
                if(currentFilter === 'progress') filtered = activeOrders.filter(o => getDesignerStatus(o).isAssumed);

                if(filtered.length === 0) { 
                    if (currentTab === 'returns') {
                        container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; opacity:0.3; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Sem Retornos Pendentes!</strong></div>';
                    } else {
                        container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; opacity:0.3; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Fila Limpa!</strong></div>'; 
                    }
                    return; 
                }

                filtered.sort((a,b) => {
                    const aStarted = getDesignerStatus(a).isAssumed ? 1 : 0; 
                    const bStarted = getDesignerStatus(b).isAssumed ? 1 : 0;
                    if (aStarted !== bStarted) return aStarted - bStarted; 

                    let sA = { dateStr: '9999-12-31' }, sB = { dateStr: '9999-12-31' };
                    try { sA = SinalizaCore.calculateSLA(a, a.layoutData?.extensions||[]) || sA; } catch(e){}
                    try { sB = SinalizaCore.calculateSLA(b, b.layoutData?.extensions||[]) || sB; } catch(e){}

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
            } catch (err) {
                console.error("Erro ao renderizar:", err);
                document.getElementById('orders-container').innerHTML = `<div style="text-align:center; padding:60px; color:var(--cor-erro);"><i class="ph-fill ph-warning-circle" style="font-size:4rem;"></i><br>Erro interno ao carregar fila. Veja o console.</div>`;
            }
        }

        function createRowHTML(o, ehRetorno = false) {
            let slaInfo = { status: 'normal', displayDate: 'N/D', dateStr: '9999-12-31' };
            try { slaInfo = SinalizaCore.calculateSLA(o, o.layoutData?.extensions||[]) || slaInfo; } catch(e){}
            
            const isLate = slaInfo.status === 'late';
            const isWarning = slaInfo.status === 'warning';
            
            const designerInfo = getDesignerStatus(o);
            const isAssumed = designerInfo.isAssumed;

            const microStep = getLayoutMicroStep(o); 

            const layoutInternalSteps = ['Na Fila', 'Iniciado', 'No Cliente', 'Aprovado', 'Finalizado'];
            const stepperHTML = layoutInternalSteps.map((stepName, i) => { 
                let cls = '', ico = '';
                
                if (i < microStep) { 
                    cls = 'done'; 
                    ico = '<i class="ph-bold ph-check"></i>'; 
                } else if (i === microStep) { 
                    ico = '<i class="ph-bold ph-spinner-gap stepper-spinner"></i>';
                    if (isLate) cls = 'active late';
                    else if (isWarning) cls = 'active warning'; 
                    else cls = 'active'; 
                } 
                const hasLine = i < layoutInternalSteps.length - 1;
                
                return `<div class="stepper-item ${cls}"><div class="stepper-circle">${ico}</div><span class="stepper-label">${stepName}</span>${hasLine ? '<div class="stepper-line"></div>' : ''}</div>`; 
            }).join('');

            let rowClass = "list-row";
            if(isLate) rowClass += " late";
            else if(isWarning) rowClass += " warning"; 
            if(ehRetorno) rowClass += " is-retorno";

            let mainAction = '';
            
            // 👇 AQUI ESTÁ A CORREÇÃO: O botão de transferir agora faz parte do btnExt padrão, 
            // aparecendo ao lado do botão de prazo independente do microStep.
            let btnExt = `
                <button class="btn btn-warning btn-icon-only" style="height:32px; width:32px; border-radius:6px;" onclick="event.stopPropagation(); openPrazoModal('${o.id}')" title="Justificar Atraso ou Pedir Prazo"><i class="ph-bold ph-calendar-plus" style="font-size:1.1rem;"></i></button>
                <button class="btn btn-secondary btn-icon-only" style="height:32px; width:32px; border-radius:6px; color:var(--cor-primaria); border-color:var(--cor-primaria);" onclick="event.stopPropagation(); openTransferModal('${o.id}')" title="Transferir Responsabilidade"><i class="ph-bold ph-arrows-left-right" style="font-size:1rem;"></i></button>
            `;
            
            let prevStep = null; let nextStep = null;
            try { prevStep = SinalizaCore.getPrevStep(o.status, configData.workflow); nextStep = SinalizaCore.getNextStep(o.status, configData.workflow); } catch(e){}

            if (microStep === 0) {
                if (!isAssumed) {
                    mainAction = `<button class="btn btn-primary" style="height:32px; border-radius:6px; padding:0 14px;" onclick="event.stopPropagation(); confirmAssume('${o.id}')"><i class="ph-bold ph-play"></i> Iniciar Produção</button>`;
                } else {
                    mainAction = `<button class="btn btn-primary" style="height:32px; border-radius:6px; padding:0 14px;" onclick="event.stopPropagation(); advanceMicroStep('${o.id}', 1, 'Layout Iniciado', 'Layout em produção')"><i class="ph-bold ph-play"></i> Iniciar Produção</button>`;
                }
            } else if (microStep === 1) {
                mainAction = `<button class="btn btn-primary" style="height:32px; border-radius:6px; padding:0 14px; background: var(--cor-alerta);" onclick="event.stopPropagation(); advanceMicroStep('${o.id}', 2, 'Enviado ao Cliente', 'Aguardando aprovação externa')"><i class="ph-bold ph-paper-plane-right"></i> Enviar p/ Cliente</button>`;
                // O botão de transferência foi removido daqui
            } else if (microStep === 2) {
                mainAction = `<button class="btn btn-success" style="height:32px; border-radius:6px; padding:0 14px; font-size: 0.85rem;" onclick="event.stopPropagation(); askRevisionsAndApprove('${o.id}')"><i class="ph-bold ph-thumbs-up"></i> Aprovado</button>`;
            } else if (microStep === 3) {
                mainAction = `<button class="btn btn-success" style="height:32px; border-radius:6px; padding:0 14px; font-size: 0.85rem;" onclick="event.stopPropagation(); openActionModal('${o.id}', '${nextStep}', 'next')"><i class="ph-bold ph-check-square-offset"></i> Concluir e Enviar</button>`;
            }

            let btnReturn = prevStep ? `<button class="btn btn-danger btn-icon-only" style="height:32px; width:32px; border-radius:6px;" onclick="event.stopPropagation(); openActionModal('${o.id}', '${prevStep}', 'back')" title="Devolver ao Comercial / Setor Anterior"><i class="ph-bold ph-arrow-u-up-left" style="font-size:1rem;"></i></button>` : '';

            let telefoneLimpo = o.contact ? String(o.contact).replace(/\D/g, '') : '';
            let wppLink = telefoneLimpo ? `<a href="https://wa.me/${telefoneLimpo}" target="_blank" onclick="event.stopPropagation()" style="color:var(--cor-sucesso); font-weight:700; text-decoration:none;"><i class="ph-fill ph-whatsapp-logo"></i> ${String(o.contact)}</a>` : 'N/D';
            let emailDisplay = o.email ? `<a href="mailto:${o.email}" onclick="event.stopPropagation()" style="color:var(--cor-primaria); font-weight:700; text-decoration:none;"><i class="ph-fill ph-envelope-simple"></i> ${o.email}</a>` : 'N/D';

            let tipo = getTipoPedido(o);
            let tagPrioridade = '';
            if (tipo === 'urgente') tagPrioridade = `<div class="tag-urgente"><i class="ph-fill ph-fire"></i> URGENTE</div>`;
            else if (tipo === 'homologado') tagPrioridade = `<div class="tag-homologado"><i class="ph-fill ph-star"></i> HOMOL</div>`;
            else if (tipo === 'projeto') tagPrioridade = `<div class="tag-projeto"><i class="ph-fill ph-blueprint"></i> PROJ</div>`;
            else tagPrioridade = `<div class="tag-normal"><i class="ph-fill ph-package"></i> NORMAL</div>`;

            let tagRetornoBadge = ehRetorno ? `<div class="tag-retorno"><i class="ph-fill ph-warning-octagon"></i> RETORNO</div>` : '';

            let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : '';

            return `
            <div class="${rowClass}" id="row-${o.id}">
                <div class="row-header" onclick="toggleCard('${o.id}')">

                    <div class="col-info" style="display: flex; flex-direction: column; gap: 6px; flex: 1.5; min-width: 250px; color: var(--cor-texto) !important;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span class="row-id ${isLate ? 'late-id' : ''}" style="margin:0; font-size: 1rem;">#${o.id}</span>
                            <span style="color: var(--cor-texto-mutado); font-weight: 800;">-</span>
                            ${tagRetornoBadge} ${tagPrioridade}
                        </div>
                        <div class="row-client" title="${safeClient}" style="font-size: 1.05rem;">${safeClient || 'N/D'}</div>
                        <div class="info-praz" style="font-size: 0.85rem;"><i class="ph-bold ph-calendar-blank"></i> Praz: <strong>${slaInfo.displayDate}</strong></div>
                    </div>

                    <div class="col-stepper" style="flex: 2.5;">
                        ${microStep > 0 ? `<span class="info-status status-active" style="margin-bottom: 4px;"><i class="ph-fill ph-paint-brush"></i> ${designerInfo.user || currentUser}</span>` : `<span class="info-status status-waiting" style="margin-bottom: 4px;"><i class="ph-fill ph-clock"></i> Aguardando Designer</span>`}
                        <div class="stepper-wrapper">${stepperHTML}</div>
                    </div>

                    <div class="col-actions" style="width: auto;">
                        <div class="action-buttons">${btnReturn} ${btnExt} ${mainAction}</div>
                        <div class="btn-detalhes">Detalhes <i class="ph-bold ph-caret-down"></i></div>
                    </div>
                </div>

                <div class="card-details" onclick="event.stopPropagation()">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
                        <div class="obs-block">
                            <div style="font-size:0.8rem; font-weight:700; color:var(--cor-texto); text-transform:uppercase; margin-bottom:10px; border-bottom: 1px solid var(--cor-borda); padding-bottom:8px;">Comunicação</div>
                            <div style="display:flex; flex-direction:column; gap:8px; font-size:0.9rem;">
                                <div><strong style="color:var(--cor-texto-mutado);">Vend:</strong> <span style="color:var(--cor-texto); font-weight:500;">${o.sales || 'N/D'}</span></div>
                                <div><strong style="color:var(--cor-texto-mutado);">Wpp:</strong> ${wppLink}</div>
                                <div><strong style="color:var(--cor-texto-mutado);">E-mail:</strong> ${emailDisplay}</div>
                            </div>
                        </div>
                        <div class="obs-comercial">
                            <div style="font-size:0.8rem; font-weight:700; text-transform:uppercase; margin-bottom:10px;"><i class="ph-fill ph-chat-text"></i> Briefing do Comercial</div>
                            <div style="font-size:0.9rem; font-weight:500;">${o.obs ? String(o.obs).replace(/\n/g, '<br>') : 'Nenhum briefing preenchido.'}</div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-secondary" onclick="openFilesModal('${o.id}')"><i class="ph-fill ph-folder-open" style="font-size:1.1rem; color:var(--cor-primaria);"></i> Ficheiros</button>
                        <button class="btn btn-secondary" onclick="openHistoryModal('${o.id}')"><i class="ph-fill ph-clock-counter-clockwise" style="font-size:1.1rem; color:var(--cor-texto);"></i> Auditoria Completa</button>
                    </div>
                </div>
            </div>`;
        }

        async function confirmAssume(id) {
            const nomeOperador = currentUser || 'Layout';
            const o = ordersData.find(x => x.id == id);
            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry('Layout Iniciado', o.status, nomeOperador, '', 'Projeto assumido pelo designer.')];
            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { history: newHistory, ...SinalizaCore.gerarTimestamps(o.status, o.status) });
                Swal.fire({toast:true, position:'top-end', icon:'success', title:`Iniciado por ${nomeOperador}!`, showConfirmButton:false, timer:2000});
                loadData();
            } catch(e) { Swal.fire('Erro', 'Falha ao iniciar: ' + e.message, 'error'); }
        }

        async function advanceMicroStep(id, stepNumber, actionName, obsMessage) {
            const nomeOperador = currentUser || 'Layout';
            const o = ordersData.find(x => x.id == id);
            
            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry(actionName, o.status, nomeOperador, '', obsMessage)];
            
            Swal.fire({
                title: 'Atualizando...',
                text: 'Registrando etapa de produção.',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading() }
            });

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { 
                    history: newHistory,
                    ...SinalizaCore.gerarTimestamps(o.status, o.status) 
                });
                
                Swal.fire({toast:true, position:'top-end', icon:'success', title: actionName, showConfirmButton:false, timer:2000});
                loadData(); 
            } catch(e) { 
                Swal.fire('Erro', 'Falha ao avançar etapa: ' + e.message, 'error'); 
            }
        }

        function askRevisionsAndApprove(id) {
            Swal.fire({
                title: 'Layout Aprovado!',
                text: 'Quantas rodadas de alterações o cliente solicitou antes de aprovar?',
                icon: 'question',
                input: 'select',
                inputOptions: {
                    '0': 'Nenhuma (Aprovado de primeira)',
                    '1': '1 rodada de alteração',
                    '2': '2 rodadas de alterações',
                    '3': '3 rodadas de alterações',
                    '4+': '4 ou mais rodadas'
                },
                inputPlaceholder: 'Selecione a quantidade...',
                showCancelButton: true,
                confirmButtonColor: 'var(--cor-sucesso)',
                confirmButtonText: '<i class="ph-bold ph-thumbs-up"></i> Confirmar Aprovação',
                cancelButtonText: 'Cancelar',
                inputValidator: (value) => {
                    if (!value) {
                        return 'Você precisa informar a quantidade de alterações!';
                    }
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    const qtd = result.value;
                    const obsMsg = `Cliente aprovou o layout. Alterações solicitadas antes da aprovação: ${qtd}. Iniciando finalização.`;
                    advanceMicroStep(id, 3, 'Cliente Aprovou', obsMsg);
                }
            });
        }

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

            const nomeOperador = currentUser || 'Layout';
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

        function openTransferModal(id) { 
            document.getElementById('transfer-id').value = id; 
            document.getElementById('transfer-reason').value = ''; 
            const sel = document.getElementById('transfer-designer'); 
            sel.innerHTML = ''; 
            
            let adicionados = 0;
            layoutTeam.forEach(d => { 
                if(String(d).toLowerCase() !== String(currentUser).trim().toLowerCase()) {
                    sel.innerHTML += `<option value="${d}">${d}</option>`; 
                    adicionados++;
                }
            }); 
            
            if(adicionados === 0) sel.innerHTML = '<option value="">Sem outros designers ativos</option>';
            document.getElementById('transferModal').style.display = 'flex'; 
        }
        
        async function confirmTransfer() { 
            const id = document.getElementById('transfer-id').value; 
            const newOwner = document.getElementById('transfer-designer').value; 
            const reason = document.getElementById('transfer-reason').value; 
            if(!newOwner) return Swal.fire('Aviso','Nenhum designer selecionado.','warning');
            
            const o = ordersData.find(x => x.id == id); 
            const nomeOperador = currentUser || 'Layout';
            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry('Transferência', o.status, nomeOperador, '', `Passado para ${newOwner}. Motivo: ${reason}`)]; 
            
            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { history: newHistory });
                document.getElementById('transferModal').style.display = 'none'; 
                Swal.fire({toast:true, position:'top-end', icon:'success', title:'Projeto transferido.', showConfirmButton:false, timer:2000});
                loadData(); 
            } catch(e) { Swal.fire('Erro', e.message, 'error'); }
        }

        function openActionModal(id, next, type) { 
            if (type === 'back') {
                const finalStage = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[configData.workflow.length-1].name) : 'finalizado';
                if (getSafeStatus(next) === finalStage || !next) {
                    next = configData.workflow.length > 0 ? configData.workflow[0].name : 'Comercial'; 
                }
            }

            document.getElementById('modal-id').value = id; document.getElementById('modal-new-status').value = next; document.getElementById('modal-move-type').value = type;
            document.getElementById('modal-obs').value = ''; document.getElementById('modal-link').value = '';
            selectedFiles = []; document.getElementById('modal-file-preview').innerHTML = '';
            
            const reasonSelect = document.getElementById('modal-reason-select'); reasonSelect.innerHTML = '<option value="">Selecione o motivo da movimentação...</option>';
            let availableReasons = [];
            if (configData.movementReasons && configData.movementReasons['layout']) {
                const direction = type === 'next' ? 'forward' : 'backward';
                availableReasons = configData.movementReasons['layout'][direction] || [];
            }
            if (availableReasons.length === 0) availableReasons = ['Normal'];
            availableReasons.forEach(r => { reasonSelect.innerHTML += `<option value="${r}">${r}</option>`; });

            const t = document.getElementById('modal-title'); const d = document.getElementById('modal-desc'); const b = document.getElementById('btn-confirm-action'); 
            const finishArea = document.getElementById('finish-area');

            if(type === 'next'){
                t.innerHTML='<i class="ph-fill ph-check-circle" style="color:var(--cor-sucesso)"></i> Finalizar'; 
                d.innerHTML=`Enviar o projeto para aprovação ou fila do <b>${next}</b>?`; 
                b.className='btn btn-success'; b.innerHTML = '<i class="ph-bold ph-check"></i> Enviar';
                finishArea.classList.remove('hidden');
            } else {
                t.innerHTML='<i class="ph-fill ph-arrow-u-up-left" style="color:var(--cor-erro)"></i> Devolver Pedido'; 
                d.innerHTML=`O projeto será retornado para <b>${next}</b>. Justifique o motivo.`; 
                b.className='btn btn-danger'; b.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> Reenviar';
                finishArea.classList.add('hidden');
            } 
            document.getElementById('actionModal').style.display = 'flex'; 
        }

        function handleFileSelect(input) { 
            selectedFiles = [...selectedFiles, ...Array.from(input.files)]; 
            document.getElementById('modal-file-preview').innerHTML = selectedFiles.map((f, i) => `<div class="file-chip"><span>${f.name}</span><i class="ph-fill ph-x-circle" style="cursor:pointer; margin-left:4px; color:var(--cor-erro);" onclick="removeFile(${i}); event.stopPropagation();"></i></div>`).join(''); 
        }
        function removeFile(i) { 
            selectedFiles.splice(i, 1); 
            document.getElementById('modal-file-preview').innerHTML = selectedFiles.map((f, i) => `<div class="file-chip"><span>${f.name}</span><i class="ph-fill ph-x-circle" style="cursor:pointer; margin-left:4px; color:var(--cor-erro);" onclick="removeFile(${i}); event.stopPropagation();"></i></div>`).join(''); 
        }
        
        async function confirmAction() { 
            const id = document.getElementById('modal-id').value; 
            const next = document.getElementById('modal-new-status').value; 
            const type = document.getElementById('modal-move-type').value;
            const reason = document.getElementById('modal-reason-select').value;
            const obsText = document.getElementById('modal-obs').value; 
            const linkCanva = document.getElementById('modal-link').value;
            
            if (!reason) return Swal.fire("Atenção", "Selecione um motivo na lista.", "warning");

            const btn = document.getElementById('btn-confirm-action'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...'; btn.disabled = true;

            const o = ordersData.find(x => x.id == id); 
            const isReturn = type === 'back'; 
            const nomeOperador = currentUser || 'Layout';
            
            const finalObs = (!isReturn && linkCanva) ? `${obsText}\nLink Layout Final: ${linkCanva}` : obsText;

            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry(isReturn ? 'Retorno' : 'Projeto Finalizado', next, nomeOperador, reason, finalObs)]; 
            let updatePayload = { status: next, history: newHistory, ...SinalizaCore.gerarTimestamps(o.status, next) };

            try {
                if (!isReturn && selectedFiles.length > 0) {
                    const formData = new FormData(); formData.append('id', id); 
                    selectedFiles.forEach(f => formData.append('files', f));
                    try { await fetch(`${SinalizaCore.VPN_URL}/api/layout/update`, { method: 'POST', body: formData }); } 
                    catch(e) { console.warn("VPN indisponível no momento."); }
                }

                await apiFetch(`/pedidos/${id}`, 'PUT', updatePayload);
                document.getElementById('actionModal').style.display='none'; 
                Swal.fire({toast:true, position:'top-end', icon:'success', title:isReturn ? 'Devolvido com sucesso' : 'Enviado com sucesso!', showConfirmButton:false, timer:3000});
                loadData(); 
            } catch(e) { Swal.fire('Erro Técnico', e.message, 'error'); } 
            finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        function closeModal() { document.getElementById('actionModal').style.display='none'; }

        async function openFilesModal(id) {
            document.getElementById('modal-order-id').innerText = '#' + id;
            document.getElementById('filesModal').style.display = 'flex';
            
            const list = document.getElementById('file-list-container');
            const preview = document.getElementById('preview-container');
            
            list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--cor-texto-mutado);"><i class="ph-bold ph-spinner ph-spin" style="font-size:2.5rem; margin-bottom:10px; color:var(--cor-primaria);"></i><br><strong style="font-size:1.1rem;">Acessando Rede...</strong></div>';
            preview.innerHTML = '<div style="color:var(--cor-texto-mutado); display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; font-weight:600;"><i class="ph-fill ph-image" style="font-size:4rem; margin-bottom:15px; opacity:0.2;"></i> Selecione um arquivo</div>';

            try {
                const arquivosBrutos = await SinalizaCore.fetchFilesFromVPN(id);
                
                const arquivosFiltrados = (arquivosBrutos || []).filter(f => {
                    const n = f.name.toLowerCase();
                    const p = f.folder.toLowerCase();
                    return n.includes('layout') || n.includes('lote') || p.includes('layout') || p.includes('lote');
                });

                if(arquivosFiltrados.length === 0) { 
                    list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--cor-texto-mutado);"><i class="ph-fill ph-empty" style="font-size:2.5rem; margin-bottom:10px;"></i><br><strong>Nenhum arquivo de Layout ou Lote encontrado.</strong></div>'; 
                    return; 
                }

                list.innerHTML = '';
                arquivosFiltrados.forEach(f => {
                    const item = document.createElement('div'); item.className = 'file-item';
                    let icon = 'ph-file';
                    if(f.ext === 'pdf') icon = 'ph-file-pdf'; else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) icon = 'ph-image'; else if(['xls','xlsx','csv'].includes(f.ext)) icon = 'ph-file-xls';
                    const badge = f.folder.toLowerCase().replace(/[\u0300-\u036f]/g, "");
                    
                    item.innerHTML = `<div style="display:flex; align-items:center; gap:8px; overflow:hidden;"><i class="ph-fill ${icon}" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.name}">${f.name}</span></div><span class="file-item-badge chip-${badge}">${f.folder}</span>`;
                    
                    item.onclick = () => {
                        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active')); item.classList.add('active');
                        const url = `${SinalizaCore.VPN_URL}${f.url}`;
                        preview.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><i class="ph-bold ph-spinner ph-spin" style="font-size:4rem; color:var(--cor-primaria);"></i></div>';
                        setTimeout(() => {
                            if(['pdf','html','txt'].includes(f.ext)) { preview.innerHTML = `<iframe src="${url}" class="preview-iframe"></iframe>`; } 
                            else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) { preview.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; object-fit:contain; border-radius: 8px; box-shadow: var(--sombra-md);">`; } 
                            else { preview.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--cor-texto);"><div style="background:var(--cor-card-bg); padding:40px; border-radius:20px; border:1px solid var(--cor-borda); text-align:center; box-shadow:var(--sombra-sm);"><i class="ph-fill ph-download-simple" style="font-size:4rem; margin-bottom:15px; color:var(--cor-primaria);"></i><p style="margin-bottom:20px; font-weight:800; font-size:1rem;">Pronto para download.</p><a href="${url}" target="_blank" class="btn btn-primary" style="text-decoration:none;">Baixar Arquivo</a></div></div>`; }
                        }, 100);
                    };
                    list.appendChild(item);
                });
            } catch(e) { list.innerHTML = `<div style="padding:40px; text-align:center; color:var(--cor-erro);"><i class="ph-fill ph-warning-circle" style="font-size:2.5rem; margin-bottom:10px;"></i><br><b>Erro de VPN. O Agente local parece estar offline.</b></div>`; }
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
                    if(h.action.includes('Iniciad') || h.action.includes('Layout')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else if(h.action.includes('Admin') || h.action.includes('Bypass') || h.action.includes('Massa')) { actionBadge = `<span style="background:rgba(245, 158, 11, 0.15); color:var(--cor-alerta); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } 
                    else if(h.action.includes('Ajuste') || h.action.includes('Prazo') || h.action.includes('Justificativa')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } 
                    else if(h.action.includes('Reprovação') || h.action.includes('Retorno')) { actionBadge = `<span style="background:rgba(239, 68, 68, 0.15); color:var(--cor-erro); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else { actionBadge = `<span style="background:rgba(16, 185, 129, 0.15); color:var(--cor-sucesso); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">MOVIMENTAÇÃO</span>`; }
                    
                    let obsHtml = h.obs ? `<div style="font-size: 0.9rem; color: var(--cor-texto); margin-top: 8px; background: var(--cor-panel-bg); padding: 12px; border-radius: 8px; border-left: 3px solid var(--cor-primaria); font-weight: 500;">${String(h.obs).replace(/\n/g, '<br>')}</div>` : ''; let isCurrent = index === 0 ? `<span style="color:white; font-size:0.65rem; background:var(--cor-primaria); padding:2px 6px; border-radius:4px; margin-left:auto; font-weight:700;">ETAPA ATUAL</span>` : '';
                    container.innerHTML += `<div class="history-item"><div class="history-date"><i class="ph-bold ph-calendar-blank"></i> ${dateStr} ${isCurrent}</div><div class="history-title"><i class="ph-fill ph-user-circle" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="font-weight:700; font-size:0.95rem;">${h.user || 'Sistema'}</span> <i class="ph-bold ph-arrow-right" style="color:var(--cor-texto-mutado)"></i> <span style="text-decoration: underline; text-decoration-color: var(--cor-primaria); text-decoration-thickness: 2px;">${h.to}</span> ${actionBadge}</div>${obsHtml}</div>`;
                });
            } document.getElementById('historyModal').style.display = 'flex';
        }
        function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }

        // ==============================================================
        // 🛡️ CORREÇÃO DEFINITIVA DO CONTADOR E TEMPOS MÉDIOS
        // ==============================================================

        // ====================================================
        // SCORE DO DESIGNER — Sidebar e Hall da Fama
        // ====================================================
        function normalizeLayoutDesignerName(nome) {
            if (!nome) return '';
            const n = String(nome).trim();
            if (!n) return '';
            return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
        }

        function getLayoutStagesSafe() {
            let layoutStages = configData.workflow
                .filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE))
                .map(s => getSafeStatus(s.name));

            if (layoutStages.length === 0) layoutStages = ['layout', 'em layout', 'criação'];
            return layoutStages;
        }

        function calculateLayoutDesignerStats() {
            const stats = {};
            const layoutStages = getLayoutStagesSafe();

            layoutTeam.forEach(name => {
                const capName = normalizeLayoutDesignerName(name);
                if (capName) stats[capName] = { count: 0, totalMinutes: 0 };
            });

            if (currentUser) {
                const currentCap = normalizeLayoutDesignerName(currentUser);
                if (currentCap && !stats[currentCap]) stats[currentCap] = { count: 0, totalMinutes: 0 };
            }

            ordersData.forEach(o => {
                const logs = o.history || [];

                let entryTime = new Date(o.created_at || o.issue_date);
                if (isNaN(entryTime.getTime())) entryTime = new Date();

                const entryLog = logs.find(h => layoutStages.includes(getSafeStatus(h.to)));
                if (entryLog && !isNaN(new Date(entryLog.date).getTime())) {
                    entryTime = new Date(entryLog.date);
                }

                let buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
                let currentBucket = 0;
                let lastEventTime = entryTime;

                logs.forEach(h => {
                    const hDate = new Date(h.date);
                    if (isNaN(hDate.getTime()) || hDate < entryTime) return;

                    const act = String(h.action || '').toLowerCase();
                    const toStatus = getSafeStatus(h.to);
                    let nextState = currentBucket;

                    if (act.includes('iniciad') || act.includes('início') || act.includes('inicio') || act === 'cliente reprovou') {
                        nextState = 1;
                    } else if (act === 'enviado ao cliente') {
                        nextState = 2;
                    } else if (act === 'cliente aprovou') {
                        nextState = 3;
                    } else if (toStatus && !layoutStages.includes(toStatus)) {
                        nextState = -1;
                    }

                    if (nextState !== currentBucket) {
                        const diffMins = (hDate - lastEventTime) / 60000;
                        if (diffMins > 0 && currentBucket >= 0 && currentBucket <= 3) {
                            buckets[currentBucket] += diffMins;
                        }

                        lastEventTime = hDate;
                        currentBucket = nextState;
                    }
                });

                const isActive = layoutStages.includes(getSafeStatus(o.status));
                if (isActive) return;

                const outLog = [...logs].reverse().find(h => {
                    const hUser = String(h.user || '').trim();
                    const isLayoutUser = layoutTeam.some(u => u.toLowerCase() === hUser.toLowerCase());

                    const toStatus = getSafeStatus(h.to);
                    const act = String(h.action || '').toLowerCase();

                    const isFinishing = act.includes('finalizad') || act.includes('layout finalizado') || act.includes('concluid');
                    const isMovingOut = toStatus !== '' && !layoutStages.includes(toStatus);
                    const isReturn = act.includes('retorno') || act.includes('reprov');

                    return isLayoutUser && (isFinishing || isMovingOut) && !isReturn;
                });

                if (outLog && outLog.user) {
                    const designerFinalizou = normalizeLayoutDesignerName(outLog.user);
                    if (!designerFinalizou) return;

                    if (!stats[designerFinalizou]) stats[designerFinalizou] = { count: 0, totalMinutes: 0 };

                    stats[designerFinalizou].count++;

                    const timeWorked = buckets[1] + buckets[3];
                    if (timeWorked > 0) {
                        stats[designerFinalizou].totalMinutes += timeWorked;
                    } else {
                        const assumiuLog = logs.find(h => {
                            const actAssumiu = String(h.action || '').toLowerCase();
                            return (actAssumiu.includes('iniciad') || actAssumiu.includes('início') || actAssumiu.includes('inicio')) && normalizeLayoutDesignerName(h.user) === designerFinalizou;
                        });

                        if (assumiuLog) {
                            const fallbackMins = (new Date(outLog.date) - new Date(assumiuLog.date)) / (1000 * 60);
                            if (fallbackMins > 0) stats[designerFinalizou].totalMinutes += fallbackMins;
                        }
                    }
                }
            });

            return stats;
        }

        function formatDesignerAverage(mins) {
            if (!mins || mins < 1) return '0m';
            if (mins >= 1440) return `${(mins / 1440).toFixed(1)} dias`;
            if (mins >= 60) return `${(mins / 60).toFixed(1)} h`;
            return `${Math.round(mins)} min`;
        }

        function updateSidebarScoreboard(statsOverride = null) {
            const card = document.getElementById('sidebar-score-card');
            if (!card) return;

            const stats = statsOverride || calculateLayoutDesignerStats();
            const current = normalizeLayoutDesignerName(currentUser || '');
            const designerKey = Object.keys(stats).find(k => k.toLowerCase() === current.toLowerCase()) || current || Object.keys(stats)[0] || 'Designer';
            const data = stats[designerKey] || { count: 0, totalMinutes: 0 };

            const count = Number(data.count || 0);
            const level = Math.floor(count / 5) + 1;
            const progressRaw = ((count % 5) / 5) * 100;
            const progress = count > 0 && progressRaw === 0 ? 100 : progressRaw;
            const nextCount = count % 5 === 0 && count > 0 ? 5 : count % 5;
            const avg = count > 0 ? formatDesignerAverage((data.totalMinutes || 0) / count) : '0m';

            const sorted = Object.keys(stats).sort((a, b) => (stats[b].count || 0) - (stats[a].count || 0));
            const rankIndex = sorted.findIndex(k => k.toLowerCase() === designerKey.toLowerCase());
            const rankLabel = count > 0 && rankIndex >= 0 ? `#${rankIndex + 1}` : '--';

            const elName = document.getElementById('sidebar-score-name');
            const elLevel = document.getElementById('sidebar-score-level');
            const elCount = document.getElementById('sidebar-score-count');
            const elAvg = document.getElementById('sidebar-score-avg');
            const elRank = document.getElementById('sidebar-score-rank');
            const elFill = document.getElementById('sidebar-score-progress-fill');
            const elCaption = document.getElementById('sidebar-score-caption');
            const elRing = document.getElementById('sidebar-score-ring');

            if (elName) elName.innerText = designerKey.toUpperCase();
            if (elLevel) elLevel.innerText = `N${level}`;
            if (elCount) elCount.innerText = `${count} layout${count === 1 ? '' : 's'}`;
            if (elAvg) elAvg.innerText = `Média: ${avg}`;
            if (elRank) elRank.innerText = `Ranking: ${rankLabel}`;
            if (elCaption) elCaption.innerText = `${nextCount}/5 para o próximo nível`;

            if (elFill) elFill.style.width = `${progress}%`;
            if (elRing) elRing.style.setProperty('--score-percent', progress);
        }



        // ====================================================
        // ABA RANKING — PÓDIO E REGRAS
        // ====================================================
        function renderRankingPage() {
            const podium = document.getElementById('ranking-podium');
            const fullList = document.getElementById('ranking-full-list');
            if (!podium || !fullList) return;

            const stats = calculateLayoutDesignerStats();
            const sorted = Object.keys(stats)
                .filter(user => (stats[user]?.count || 0) > 0)
                .sort((a, b) => {
                    const countDiff = (stats[b].count || 0) - (stats[a].count || 0);
                    if (countDiff !== 0) return countDiff;
                    const avgA = stats[a].count > 0 ? (stats[a].totalMinutes || 0) / stats[a].count : 999999;
                    const avgB = stats[b].count > 0 ? (stats[b].totalMinutes || 0) / stats[b].count : 999999;
                    return avgA - avgB;
                });

            updateSidebarScoreboard(stats);

            if (sorted.length === 0) {
                podium.innerHTML = `
                    <div class="ranking-empty-state">
                        <i class="ph-fill ph-trophy"></i>
                        <strong>Nenhum designer pontuou ainda</strong>
                        <span>Assim que houver layouts finalizados, o pódio será montado automaticamente.</span>
                    </div>
                `;
                fullList.innerHTML = '';
                return;
            }

            const podiumOrder = [
                { rank: 2, user: sorted[1] || null },
                { rank: 1, user: sorted[0] || null },
                { rank: 3, user: sorted[2] || null }
            ];

            const trophyIcons = {
                1: 'ph-fill ph-trophy',
                2: 'ph-fill ph-medal',
                3: 'ph-fill ph-medal'
            };

            const rankLabels = {
                1: '1º lugar',
                2: '2º lugar',
                3: '3º lugar'
            };

            podium.innerHTML = podiumOrder.map(item => {
                if (!item.user) {
                    return `
                        <div class="podium-card podium-empty rank-${item.rank}">
                            <div class="podium-trophy rank-${item.rank}">
                                <i class="${trophyIcons[item.rank]}"></i>
                                <span>${item.rank}º</span>
                            </div>
                            <strong>Aguardando</strong>
                            <p>Sem pontuação</p>
                        </div>
                    `;
                }

                const data = stats[item.user];
                const count = Number(data.count || 0);
                const level = Math.floor(count / 5) + 1;
                const progressRaw = ((count % 5) / 5) * 100;
                const progress = count > 0 && progressRaw === 0 ? 100 : progressRaw;
                const avgMins = count > 0 ? (data.totalMinutes || 0) / count : 0;
                const avgStr = formatDesignerAverage(avgMins);

                return `
                    <div class="podium-card rank-${item.rank}">
                        <div class="podium-trophy rank-${item.rank}">
                            <div class="trophy-shine"></div>
                            <i class="${trophyIcons[item.rank]}"></i>
                            <span>${item.rank}º</span>
                        </div>

                        <div class="podium-position">${rankLabels[item.rank]}</div>
                        <h3>${item.user}</h3>
                        <div class="podium-level">Nível ${level}</div>

                        <div class="podium-stats">
                            <div>
                                <strong>${count}</strong>
                                <span>layouts</span>
                            </div>
                            <div>
                                <strong>${avgStr}</strong>
                                <span>média</span>
                            </div>
                        </div>

                        <div class="podium-xp">
                            <span style="width:${progress}%"></span>
                        </div>
                    </div>
                `;
            }).join('');

            fullList.innerHTML = sorted.map((user, index) => {
                const data = stats[user];
                const rank = index + 1;
                const count = Number(data.count || 0);
                const level = Math.floor(count / 5) + 1;
                const avgMins = count > 0 ? (data.totalMinutes || 0) / count : 0;
                const avgStr = formatDesignerAverage(avgMins);
                const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-default';

                return `
                    <div class="ranking-row ${rankClass}">
                        <div class="ranking-row-position">
                            <span>${rank}º</span>
                        </div>

                        <div class="ranking-row-user">
                            <strong>${user}</strong>
                            <span>Nível ${level}</span>
                        </div>

                        <div class="ranking-row-metric">
                            <strong>${count}</strong>
                            <span>layouts</span>
                        </div>

                        <div class="ranking-row-metric">
                            <strong>${avgStr}</strong>
                            <span>média</span>
                        </div>
                    </div>
                `;
            }).join('');
        }



        function renderRanking() { 
            const rankingGrid = document.getElementById('ranking-grid'); 
            const activeGrid = document.getElementById('active-projects-grid'); 
            const distDiv = document.getElementById('designer-distribution'); 
            const motivosList = document.getElementById('motivos-list');
            const extDesignerList = document.getElementById('ext-designer-list');

            const stats = {}; 
            const activeProjects = {}; 
            const extensionStats = { byReason: {}, byDesigner: {} };
            
            let layoutStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name)); 
            if (layoutStages.length === 0) layoutStages = ['layout', 'em layout', 'criação'];

            const microStepStats = {
                0: { name: 'Na Fila', count: 0, totalMins: 0, calcCount: 0, icon: 'ph-clock', color: '#6B7280' },
                1: { name: 'Em Produção', count: 0, totalMins: 0, calcCount: 0, icon: 'ph-paint-brush', color: '#9333EA' },
                2: { name: 'No Cliente', count: 0, totalMins: 0, calcCount: 0, icon: 'ph-paper-plane-right', color: '#F59E0B' },
                3: { name: 'Aprovado', count: 0, totalMins: 0, calcCount: 0, icon: 'ph-thumbs-up', color: '#10B981' }
            };

            function normalizarNome(nome) {
                if(!nome) return null;
                const n = String(nome).trim();
                return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
            }

            // Inicia todos os designers do time com zero, para não sumirem da tela de distribuição
            layoutTeam.forEach(name => {
                const capName = normalizarNome(name);
                if (capName) {
                    stats[capName] = { count: 0, totalMinutes: 0 };
                    activeProjects[capName] = [];
                }
            });

            ordersData.forEach(o => { 
                const logs = o.history || [];

                // --- Lógica de Atrasos e Extensões ---
                const logsAtraso = logs.filter(h => h.action === 'Justificativa Registrada' || h.action === 'Prazo Estendido');
                logsAtraso.forEach(log => {
                    const match = String(log.obs).match(/Motivo:\s*([^.]+)/i);
                    const reason = match && match[1] ? match[1].trim() : 'Outro';
                    const designerExt = normalizarNome(log.user);
                    const diasMatch = String(log.obs).match(/\+(\d+)\s*dia/i);
                    const diasNum = diasMatch ? parseInt(diasMatch[1]) : 0;

                    if (designerExt && layoutTeam.some(u => u.toLowerCase() === designerExt.toLowerCase())) {
                        extensionStats.byReason[reason] = (extensionStats.byReason[reason] || 0) + 1;
                        if (!extensionStats.byDesigner[designerExt]) extensionStats.byDesigner[designerExt] = { count: 0, daysAdded: 0 };
                        extensionStats.byDesigner[designerExt].count += 1;
                        extensionStats.byDesigner[designerExt].daysAdded += diasNum;
                    }
                });

                const dInfo = getDesignerStatus(o);
                const isActive = layoutStages.includes(getSafeStatus(o.status)); 
                const mStep = getLayoutMicroStep(o);

                if (isActive && mStep >= 0 && mStep <= 3) {
                    microStepStats[mStep].count++;
                }

                // --- SISTEMA BLINDADO DE BALDES DE TEMPO ---
                let entryTime = new Date(o.created_at || o.issue_date);
                if (isNaN(entryTime.getTime())) entryTime = new Date();
                
                const entryLog = logs.find(h => layoutStages.includes(getSafeStatus(h.to)));
                if (entryLog && !isNaN(new Date(entryLog.date).getTime())) {
                    entryTime = new Date(entryLog.date);
                }

                let buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
                let currentBucket = 0; // Começa na fila
                let lastEventTime = entryTime;

                logs.forEach(h => {
                    const hDate = new Date(h.date);
                    if (isNaN(hDate.getTime()) || hDate < entryTime) return;

                    // Analisa a ação para pular de balde
                    const act = String(h.action || '').toLowerCase();
                    const toStatus = getSafeStatus(h.to);

                    let nextState = currentBucket;

                    if (act.includes('iniciad') || act.includes('início') || act.includes('inicio') || act === 'cliente reprovou') {
                        nextState = 1; // Em Produção
                    } else if (act === 'enviado ao cliente') {
                        nextState = 2; // No Cliente
                    } else if (act === 'cliente aprovou') {
                        nextState = 3; // Aprovado
                    } else if (toStatus && !layoutStages.includes(toStatus)) {
                        nextState = -1; // Saiu do Setor
                    }

                    if (nextState !== currentBucket) {
                        const diffMins = (hDate - lastEventTime) / 60000;
                        if (diffMins > 0 && currentBucket >= 0 && currentBucket <= 3) {
                            buckets[currentBucket] += diffMins;
                        }
                        lastEventTime = hDate;
                        currentBucket = nextState;
                    }
                });

                // Se o projeto ainda está ativo, soma os minutos de agora
                if (isActive && currentBucket >= 0 && currentBucket <= 3) { 
                    const diffMins = (new Date() - lastEventTime) / 60000;
                    if (diffMins > 0 && diffMins < 43200) buckets[currentBucket] += diffMins;
                }

                // Acumula corretamente o tempo de todos os pedidos no Funil Geral
                for (let i = 0; i <= 3; i++) {
                    if (buckets[i] > 0) {
                        microStepStats[i].totalMins += buckets[i];
                        microStepStats[i].calcCount++;
                    }
                }

                // Separação entre ativos e finalizados
                if (isActive) { 
                    if (dInfo.isAssumed) {
                        const designerAtivo = normalizarNome(dInfo.user);
                        
                        if (designerAtivo && layoutTeam.some(u => u.toLowerCase() === designerAtivo.toLowerCase())) {
                            const totalActiveMins = buckets[0] + buckets[1] + buckets[2] + buckets[3];
                            if(!activeProjects[designerAtivo]) activeProjects[designerAtivo] = [];
                            
                            activeProjects[designerAtivo].push({ 
                                id: o.id, 
                                client: o.client, 
                                totalMins: totalActiveMins,
                                buckets: buckets
                            });
                        }
                    }
                } else { 
                    // ==============================================================
                    // PROJETO FINALIZADO (Correção do "Roubo de Entregas")
                    // ==============================================================
                    const outLog = [...logs].reverse().find(h => {
                        const hUser = String(h.user || '').trim();
                        // O SEGREDO ESTÁ AQUI: Força a validação de usuário DENTRO da busca
                        const isLayoutUser = layoutTeam.some(u => u.toLowerCase() === hUser.toLowerCase());
                        
                        const toStatus = getSafeStatus(h.to);
                        const act = String(h.action || '').toLowerCase();
                        
                        const isFinishing = act.includes('finalizad') || act.includes('layout finalizado') || act.includes('concluid');
                        const isMovingOut = toStatus !== '' && !layoutStages.includes(toStatus);
                        const isReturn = act.includes('retorno') || act.includes('reprov');

                        // Só para a busca no histórico quando acha a ação feita pelo seu designer
                        return isLayoutUser && (isFinishing || isMovingOut) && !isReturn;
                    });

                    if (outLog && outLog.user) {
                        const designerFinalizou = normalizarNome(outLog.user);
                        
                        if (designerFinalizou && stats[designerFinalizou]) {
                            stats[designerFinalizou].count++; 
                            
                            // Soma para a média APENAS os tempos de trabalho real do designer
                            const timeWorked = buckets[1] + buckets[3];
                            if (timeWorked > 0) {
                                stats[designerFinalizou].totalMinutes += timeWorked;
                            } else {
                                // Fallback para pedidos antigos
                                const assumiuLog = logs.find(h => {
                                    const actAssumiu = String(h.action).toLowerCase();
                                    return (actAssumiu.includes('iniciad') || actAssumiu.includes('início') || actAssumiu.includes('inicio')) && normalizarNome(h.user) === designerFinalizou;
                                });
                                if (assumiuLog) {
                                    const fallbackMins = (new Date(outLog.date) - new Date(assumiuLog.date)) / (1000 * 60); 
                                    if(fallbackMins > 0) stats[designerFinalizou].totalMinutes += fallbackMins; 
                                }
                            }
                        }
                    }
                } 
            }); 

            // RENDERIZAÇÃO DO HTML
            const funnelGrid = document.getElementById('micro-funnel-grid');
            if (funnelGrid) {
                let funnelHTML = '';
                
                function formatCompactFunnel(mins) {
                    if (!mins || mins < 1) return '0m';
                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                    return `${Math.round(mins)}m`;
                }

                [0, 1, 2, 3].forEach(step => {
                    const data = microStepStats[step];
                    const avgMins = data.calcCount > 0 ? (data.totalMins / data.calcCount) : 0;
                    let timeStr = formatCompactFunnel(avgMins);

                    funnelHTML += `
                    <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:15px; box-shadow:var(--sombra-sm); border-top: 4px solid ${data.color};">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">${data.name}</div>
                            <div style="background:${data.color}20; color:${data.color}; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ${data.icon}"></i></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                            <div>
                                <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Volume Atual</div>
                                <div style="font-size:1.5rem; font-weight:800; color:var(--cor-texto); line-height:1;">${data.count}</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:0.7rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Tempo Médio</div>
                                <div style="font-size:1.1rem; font-weight:800; color:${data.color}; line-height:1.2;">${timeStr}</div>
                            </div>
                        </div>
                    </div>`;
                });
                funnelGrid.innerHTML = funnelHTML;
            }

            let distHTML = ''; 
            for (const [name, d] of Object.entries(stats)) {
                distHTML += `<span class="designer-pill">${name} <span class="designer-count">${d.count}</span></span>`; 
            }
            distDiv.innerHTML = distHTML || '<span style="color:var(--cor-texto-mutado); font-size:0.9rem; font-weight:700;">Sem entregas registradas.</span>'; 

            activeGrid.innerHTML = ''; 
            const activeDesigners = Object.keys(activeProjects).filter(u => activeProjects[u].length > 0 || stats[u].count > 0); 
            
            if(activeDesigners.length === 0) { 
                activeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--cor-texto-mutado); padding:20px; background:var(--cor-card-bg); border-radius:16px; border:1px solid var(--cor-borda); font-weight:700;">Nenhum projeto em andamento.</div>'; 
            } else { 
                activeDesigners.forEach(user => { 
                    const projects = activeProjects[user] || []; let listHTML = ''; 
                    
                    function formatCompactBreakdown(mins) {
                        if (!mins || mins < 1) return '0m';
                        if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                        if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                        return `${Math.round(mins)}m`;
                    }

                    projects.forEach(p => { 
                        const tTotal = formatCompactBreakdown(p.totalMins);
                        const tFila = formatCompactBreakdown(p.buckets[0]);
                        const tProd = formatCompactBreakdown(p.buckets[1]);
                        const tAprov = formatCompactBreakdown(p.buckets[2]);
                        const tFin = formatCompactBreakdown(p.buckets[3]);

                        const breakdownHtml = `
                            <div style="font-size: 0.75rem; color: var(--cor-texto-mutado); margin-top: 8px; display: flex; gap: 10px; flex-wrap: wrap; line-height: 1.2; background: var(--cor-panel-bg); border: 1px solid var(--cor-borda); padding: 8px; border-radius: 6px;">
                                <span title="Na Fila" style="display:flex; align-items:center; gap:3px;"><i class="ph-fill ph-clock" style="color:#64748B;"></i> ${tFila}</span>
                                <span title="Em Produção" style="display:flex; align-items:center; gap:3px;"><i class="ph-fill ph-paint-brush" style="color:#8B5CF6;"></i> ${tProd}</span>
                                <span title="Em Aprovação" style="display:flex; align-items:center; gap:3px;"><i class="ph-fill ph-paper-plane-right" style="color:#F59E0B;"></i> ${tAprov}</span>
                                <span title="Finalização" style="display:flex; align-items:center; gap:3px;"><i class="ph-fill ph-thumbs-up" style="color:#10B981;"></i> ${tFin}</span>
                            </div>
                        `;

                        listHTML += `
                        <div style="display:flex; flex-direction:column; border-bottom:1px dashed var(--cor-borda); padding:12px 0;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div>
                                    <div style="font-weight:700; font-size:0.95rem; color:var(--cor-texto);">#${p.id}</div>
                                    <div style="font-size:0.8rem; color:var(--cor-texto-mutado); font-weight:500;">${p.client.substring(0,30)}</div>
                                </div>
                                <div style="font-size:0.9rem; font-weight:800; color:var(--cor-primaria); display:flex; align-items:center; gap:5px; background:var(--cor-primaria-soft-bg); padding:4px 8px; border-radius:6px;">
                                    <i class="ph-bold ph-clock"></i> Total: ${tTotal}
                                </div>
                            </div>
                            ${breakdownHtml}
                        </div>`;
                    }); 
                    
                    activeGrid.innerHTML += `<div class="gamer-card" style="border-top:4px solid var(--cor-primaria);"><div style="padding:15px 20px; background:var(--cor-primaria-soft-bg); display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--cor-borda);"><div style="font-weight:700; color:var(--cor-primaria); text-transform:uppercase;">${user}</div><div style="background:var(--cor-primaria); color:white; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;">${projects.length} Ativos</div></div><div class="gamer-body" style="padding:15px 20px;">${listHTML || '<div style="text-align:center; color:var(--cor-texto-mutado); font-size:0.85rem; padding:10px;"><i class="ph-bold ph-coffee" style="font-size: 1.5rem; margin-bottom: 5px;"></i><br>Livre</div>'}</div></div>`; 
                }); 
            } 

            rankingGrid.innerHTML = ''; 
            const sorted = Object.keys(stats).sort((a,b) => stats[b].count - stats[a].count); 
            
            const champion = sorted[0]; 
            sorted.forEach((user, index) => { 
                const data = stats[user]; 
                
                // Só desenha o card no Hall da Fama se o designer finalizou ao menos 1 projeto
                if(data.count === 0) return;

                const avgMins = data.count > 0 ? (data.totalMinutes / data.count) : 0; 
                
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
                            <div class="stat-row">
                                <span>Layout Finalizado</span>
                                <span>${data.count}</span>
                            </div>
                            <div class="stat-row">
                                <span>Média/Layout</span>
                                <span>${avgStr}</span>
                            </div>
                            <div class="xp-bar-container">
                                <div class="xp-bar-fill" style="width:${progress}%"></div>
                            </div>
                        </div>
                    </div>
                `; 
            }); 

            updateSidebarScoreboard(stats);

            if (motivosList && extDesignerList) {
                const sortedMotivos = Object.entries(extensionStats.byReason).sort((a,b) => b[1] - a[1]);
                if(sortedMotivos.length === 0) {
                    motivosList.innerHTML = '<div style="color:var(--cor-sucesso); font-size:0.95rem; font-weight:600; padding:10px 0; display:flex; align-items:center; gap:8px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem;"></i> Nenhum atraso ou justificativa.</div>';
                } else {
                    motivosList.innerHTML = sortedMotivos.map(m => `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--cor-borda); font-size:0.9rem;"><span style="color:var(--cor-texto); font-weight:600;">${m[0]}</span><span style="background:rgba(245, 158, 11, 0.15); color:var(--cor-alerta); padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.8rem;">${m[1]} ocorrências</span></div>`).join('');
                }

                const sortedExtDesigners = Object.entries(extensionStats.byDesigner).sort((a,b) => b[1].count - a[1].count);
                if(sortedExtDesigners.length === 0) {
                    extDesignerList.innerHTML = '<div style="color:var(--cor-sucesso); font-size:0.95rem; font-weight:600; padding:10px 0; display:flex; align-items:center; gap:8px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem;"></i> Equipe 100% no SLA.</div>';
                } else {
                    extDesignerList.innerHTML = sortedExtDesigners.map(d => `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--cor-borda); font-size:0.9rem;"><span style="color:var(--cor-texto); font-weight:700; display:flex; align-items:center; gap:6px;"><i class="ph-fill ph-user-circle" style="color:var(--cor-primaria); font-size:1.2rem;"></i> ${d[0]}</span><div style="text-align:right;"><div style="font-weight:700; color:var(--cor-erro);">${d[1].count} pedidos ext.</div><div style="font-size:0.75rem; color:var(--cor-texto-mutado); font-weight:500;">Adicionou +${d[1].daysAdded} dias</div></div></div>`).join('');
                }
            }
        }

        // ALERTA GIGANTE DE ATRASOS
        function checkUrgentOrders() {
            if (sessionStorage.getItem('alerta_urgente_mostrado') === 'true') return;

            const myStages = configData.workflow.filter(s => getSafeStatus(s.role) === MY_ROLE).map(s => getSafeStatus(s.name));
            const myOrders = ordersData.filter(o => myStages.includes(getSafeStatus(o.status)));

            let urgentHtml = '';
            let urgentCount = 0;

            myOrders.forEach(o => {
                let slaInfo = { status: 'normal', displayDate: 'N/D' };
                try { slaInfo = SinalizaCore.calculateSLA(o, o.layoutData?.extensions || o.prodData?.extensions || []); } catch(e){}

                if (slaInfo.status === 'warning' || slaInfo.status === 'late') {
                    urgentCount++;
                    let cor = slaInfo.status === 'late' ? 'var(--cor-erro)' : 'var(--cor-alerta)';
                    let icon = slaInfo.status === 'late' ? 'ph-warning-octagon' : 'ph-warning';
                    let label = slaInfo.status === 'late' ? 'ATRASADO' : 'VENCE EM BREVE';
                    
                    urgentHtml += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding: 15px; border-bottom: 1px dashed var(--cor-borda); background: var(--cor-card-bg); margin-bottom: 8px; border-radius: 8px; border-left: 4px solid ${cor};">
                        <div>
                            <div style="font-weight: 800; font-size: 1.1rem; color: var(--cor-texto);">#${o.id} - ${o.client}</div>
                            <div style="font-size: 0.85rem; color: var(--cor-texto-mutado); margin-top: 4px;"><i class="ph-fill ph-user"></i> Vendedor: ${o.sales || 'N/D'}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="color: ${cor}; font-weight: 900; font-size: 1.1rem;"><i class="ph-fill ${icon}"></i> Praz: ${slaInfo.displayDate}</div>
                            <div style="font-size: 0.7rem; font-weight: 800; background: ${cor}20; color: ${cor}; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 6px;">${label}</div>
                        </div>
                    </div>`;
                }
            });

            if (urgentCount > 0) {
                document.getElementById('urgentAlertList').innerHTML = urgentHtml;
                document.getElementById('urgentAlertModal').style.display = 'flex';
                sessionStorage.setItem('alerta_urgente_mostrado', 'true'); 
            }
        }

        function closeUrgentAlert() {
            document.getElementById('urgentAlertModal').style.display = 'none';
        }

        // --- MODO ESCURO ---
        function toggleTheme() { 
            const b = document.body; 
            const c = b.getAttribute('data-theme'); 
            const n = c === 'dark' ? 'light' : 'dark'; 
            b.setAttribute('data-theme', n); 
            localStorage.setItem('theme', n); 
            updateThemeIcon(n); 
        }
        function loadTheme() { 
            const t = localStorage.getItem('theme') || 'light'; 
            document.body.setAttribute('data-theme', t); 
            updateThemeIcon(t); 
        }
        function updateThemeIcon(t) { 
            const i = document.getElementById('theme-icon'); 
            const txt = document.getElementById('theme-text'); 
            if(i && txt) {
                if(t === 'dark'){ i.className='ph-fill ph-sun'; txt.innerText='Modo Claro'; }
                else { i.className='ph-fill ph-moon'; txt.innerText='Modo Escuro'; }
            }
        }

        function verificarLockdownAtrasos() {
    // 1. Pega as etapas do setor atual (MY_ROLE)
    const myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name));
    
    // Se por acaso a variável não existir, ignora (evita quebrar a tela)
    if (!myStages || myStages.length === 0) return;

    // 2. Filtra os pedidos que estão NO SEU SETOR
    let myOrders = ordersData.filter(o => myStages.includes(getSafeStatus(o.status)));

    // 3. Descobre quais estão "late" (Atrasados)
    let lateOrders = myOrders.filter(o => {
        let slaInfo = { status: 'normal' };
        try { 
            // Pega a função de SLA que você já tem
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
